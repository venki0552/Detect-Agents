/**
 * agent-detect browser collector.
 *
 *   const ad = AgentDetect.init({ endpoint: '/ad' });
 *   const ctx = await AgentDetect.contextHash(payeeId, amount, currency);
 *   const { decision, token } = await ad.decide('transfer', ctx);   // allow | notify | step_up | block
 *
 * The browser only collects and ships raw timing/geometry. The server scores
 * and decides, so an agent that patches this script cannot forge a verdict —
 * at worst it can stop reporting, which the server treats as "unknown".
 */
import type {
  Batch, BgState, Bit, ClickEv, Decision, DomEv, EnvSnapshot, FocusEv, InputEv, InputSource, KeyEv, PointerKind, PtrEv,
  ScoreResult, ScrollEv, BtnEv, SessionTrace, StreamKey,
} from '../core/types';
import { emptyTrace, mergeBatch } from '../core/types';
import { scoreTrace } from '../core/score';
import { extractFeatures } from '../core/features';
import { collectEnv } from './env';

export interface AgentDetectOptions {
  /** Server base path, e.g. "/ad". Omit for local-only (debug) mode. */
  endpoint?: string;
  /** Flush interval, ms. Default 3000. */
  flushMs?: number;
  /** Selectors for app-owned subtrees. When set, nodes injected elsewhere are reported as foreign. */
  appRoots?: string[];
  /** Selectors for known agent overlays (fill from your harness observations). */
  agentMarkers?: string[];
  /** Tag/id/class pattern of benign extensions to ignore (password managers, grammar tools…). */
  benignForeign?: RegExp;
  /** Inject an invisible, aria-hidden honeypot link. Default true. */
  canaries?: boolean;
  /**
   * Regions whose input must not be measured: on-screen PIN pads, virtual keyboards, security-code grids.
   * Inside them no click geometry, pointer path or key timing is recorded (a click position on a keypad
   * IS the digit). Default: any element with a `data-ad-mask` attribute.
   */
  maskSelectors?: string[];
  /**
   * Extra selectors for fields a password manager legitimately fills by script. Password inputs and
   * fields with a credential/identity `autocomplete` token (username, cc-number, …) are always included.
   */
  autofillFields?: string[];
  /** Called with the local (non-authoritative) score after each flush. */
  onLocalScore?: (r: ScoreResult) => void;
}

export interface DecideResult {
  decision: Decision;
  verdict?: string;
  score?: number;
  token?: string;
  reasons?: { id: string; evidence: string }[];
}

const CANARY_CLASS = 'ad-cnry';
const DEFAULT_BENIGN = /grammarly|1password|onepassword|lastpass|bitwarden|dashlane|keeper|honey|darkreader|loom/i;
const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[onclick]';
/** WHATWG autofill field names for the user's own credentials and identity: what password managers fill. */
const AUTOFILL_TOKENS = /(^|\s)(username|email|current-password|new-password|one-time-code|name|given-name|additional-name|family-name|nickname|organization|street-address|address-line[123]|address-level[1-4]|country|country-name|postal-code|cc-(name|given-name|family-name|additional-name|number|exp|exp-month|exp-year|csc|type)|bday(-day|-month|-year)?|tel(-[a-z-]+)?)(\s|$)/;
const DECISIONS = ['allow', 'notify', 'step_up', 'block'];

function bit(b: boolean): Bit { return b ? 1 : 0; }

function bg(): BgState {
  if (document.hidden) return 2;
  try { return document.hasFocus() ? 0 : 1; } catch { return 0; }
}

function pk(t: string | undefined): PointerKind {
  return t === 'touch' ? 'touch' : t === 'pen' ? 'pen' : 'mouse';
}

function newId(): string {
  try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

export class AgentDetect {
  private opts: Required<Omit<AgentDetectOptions, 'endpoint' | 'onLocalScore'>> & Pick<AgentDetectOptions, 'endpoint' | 'onLocalScore'>;
  private maskSel = '';
  private autofillSel = '';
  // A field's autofill class is decided ONCE, when the page first shows it, and never re-read:
  // otherwise a script could tag the amount field `autocomplete="username"` just before filling it.
  private fieldClass = new WeakMap<Element, boolean>();
  private pendingScan: ParentNode[] = [];
  private scanQueued = false;
  private t0 = performance.now();
  private buf: SessionTrace = emptyTrace();
  private all: SessionTrace = emptyTrace(); // local copy for debug scoring
  private sid = '';
  private nonce = '';
  private seq = 0;
  private ready: Promise<void> = Promise.resolve();
  private chain: Promise<void> = Promise.resolve(); // flushes run one at a time, so batches arrive in seq order
  private lastReopen = -1e9;                        // last re-open attempt, for backoff
  private timer: number | undefined;
  private envSent = false;
  private env?: EnvSnapshot;          // collected off the critical path (background priority)
  private visSent = 0;                // VisibilityStateEntry entries already shipped
  private hasVSE = typeof PerformanceObserver !== 'undefined' && !!PerformanceObserver.supportedEntryTypes?.includes('visibility-state');
  private lastCompEnd = -1e9;
  private last229 = -1e9;
  private sinkCount = 0;

  // live state
  private recentMoves: number[] = [];
  private leftDoc = false;
  private overMask = false;           // pointer is inside a masked region
  private lastPt: PointerKind = 'mouse';
  private lastKeydown = -1;
  private kdFresh = false;            // the last printable keydown has not paid for an insertText yet
  private lastScrollCause = -1e9;
  private lastScrollT = -1e9;
  private lastScrollCaused = false;
  private lastScrollY = 0;
  private buttonDown = false;
  private keySeq = 0;
  private openKeys = new Map<string, number>(); // code -> per-press id (never a stable per-key id)
  private observer?: MutationObserver;

  static init(opts: AgentDetectOptions = {}): AgentDetect {
    const ad = new AgentDetect(opts);
    ad.start();
    return ad;
  }

  constructor(opts: AgentDetectOptions) {
    this.opts = {
      flushMs: 3000,
      appRoots: [],
      agentMarkers: [],
      benignForeign: DEFAULT_BENIGN,
      canaries: true,
      maskSelectors: ['[data-ad-mask]'],
      autofillFields: [],
      ...opts,
    };
    this.maskSel = this.opts.maskSelectors.join(',');
    this.autofillSel = this.opts.autofillFields.join(',');
  }

  /** Inside a masked region (PIN pad, virtual keyboard)? Nothing measurable is recorded there. */
  private masked(t: EventTarget | null): boolean {
    if (!this.maskSel || !t || !(t as Element).closest) return false;
    try { return !!(t as Element).closest(this.maskSel); } catch { return false; }
  }

  /**
   * Is this a field a password manager fills by script (set value, dispatch click/key/input)?
   * Those events are isTrusted=false and would otherwise be hard evidence of a script agent.
   */
  private autofillField(t: EventTarget | null): boolean {
    const el = t as Element | null;
    if (!el || !el.getAttribute) return false;
    let c = this.fieldClass.get(el);
    if (c === undefined) { c = this.classify(el); this.fieldClass.set(el, c); } // not seen by a scan (e.g. inside a shadow root)
    return c;
  }

  private classify(t: Element): boolean {
    const el = t as HTMLInputElement;
    if (el.tagName === 'INPUT' && el.type === 'password') return true;
    if (AUTOFILL_TOKENS.test((el.getAttribute('autocomplete') || '').toLowerCase())) return true;
    if (!this.autofillSel) return false;
    try { return el.matches(this.autofillSel); } catch { return false; }
  }

  /** Classify form fields under `root` at background priority; the first classification of a field sticks. */
  private queueScan(root: ParentNode) {
    if (this.pendingScan.length >= 2000) this.pendingScan = [document]; // a burst of insertions: one full rescan instead
    this.pendingScan.push(root);
    if (this.scanQueued) return;
    this.scanQueued = true;
    this.background(() => {
      this.scanQueued = false;
      const roots = this.pendingScan;
      this.pendingScan = [];
      const remember = (el: Element) => { if (!this.fieldClass.has(el)) this.fieldClass.set(el, this.classify(el)); };
      for (const r of roots) {
        try {
          if ((r as Element).matches && (r as Element).matches('input,select,textarea')) remember(r as Element);
          r.querySelectorAll('input,select,textarea').forEach(remember);
        } catch { /* detached or exotic node */ }
      }
    });
  }

  /** ms since collector start, on the same clock as event.timeStamp. */
  private now(ts?: number): number {
    const v = (ts ?? performance.now()) - this.t0;
    return Math.round(v * 10) / 10;
  }

  private push<K extends StreamKey>(k: K, ev: SessionTrace[K][number]) {
    (this.buf[k] as unknown[]).push(ev);
    (this.all[k] as unknown[]).push(ev);
    if ((this.buf[k] as unknown[]).length > 4000) (this.buf[k] as unknown[]).shift();
    if ((this.all[k] as unknown[]).length > 5000) (this.all[k] as unknown[]).shift();
  }

  /** Run non-urgent work at background priority (scheduler.postTask → requestIdleCallback → setTimeout). */
  private background(fn: () => void) {
    const w = window as any;
    try {
      if (w.scheduler?.postTask) { w.scheduler.postTask(fn, { priority: 'background' }); return; }
      if (w.requestIdleCallback) { w.requestIdleCallback(fn, { timeout: 2000 }); return; }
    } catch { /* fall through */ }
    setTimeout(fn, 0);
  }

  start() {
    this.background(() => { this.env = collectEnv(); this.all.env = this.env; });
    this.lastScrollY = window.scrollY;
    const o = { capture: true, passive: true } as AddEventListenerOptions;
    window.addEventListener('pointermove', (e) => this.onMove(e as PointerEvent), o);
    document.addEventListener('mouseout', (e) => { if (!(e as MouseEvent).relatedTarget) this.leftDoc = true; }, o);
    window.addEventListener('mousedown', (e) => this.onBtn(e, 'd'), o);
    window.addEventListener('mouseup', (e) => this.onBtn(e, 'u'), o);
    window.addEventListener('pointerdown', (e) => {
      this.buttonDown = true;
      this.lastPt = pk((e as PointerEvent).pointerType); // the compatibility mousedown/up that follow a touch inherit it
      this.lastScrollCause = this.now();
    }, o);
    // pointerover fires once per element boundary, before the move at the new position: cheap mask tracking.
    window.addEventListener('pointerover', (e) => {
      const m = this.masked(e.target);
      if (this.overMask && !m) this.leftDoc = true; // the path through the mask is missing: next move is a re-entry, not a jump
      this.overMask = m;
    }, o);
    window.addEventListener('pointerup', () => { this.buttonDown = false; }, o);
    window.addEventListener('click', (e) => this.onClick(e as PointerEvent), o);
    window.addEventListener('keydown', (e) => this.onKey(e, 'd'), o);
    window.addEventListener('keyup', (e) => this.onKey(e, 'u'), o);
    window.addEventListener('input', (e) => this.onInput(e as InputEvent), o);
    window.addEventListener('focusin', (e) => this.onFocusIn(e), o);
    for (const t of ['wheel', 'touchstart', 'touchmove']) window.addEventListener(t, () => { this.lastScrollCause = this.now(); }, o);
    window.addEventListener('scroll', () => this.onScroll(), o);
    document.addEventListener('visibilitychange', () => this.onFocus(), o);
    window.addEventListener('focus', () => this.onFocus(), o);
    window.addEventListener('blur', () => this.onFocus(), o);
    window.addEventListener('pagehide', () => this.flush(true), o);
    document.addEventListener('compositionend', (e) => { this.lastCompEnd = this.now(e.timeStamp); }, o);
    // Trusted Types report-only: HTML/script injected through string sinks (needs the CSP report-only header).
    document.addEventListener('securitypolicyviolation', (e) => this.onViolation(e as SecurityPolicyViolationEvent), o);
    // WebMCP: agents that act through the browser's agent API announce themselves.
    document.addEventListener('submit', (e) => {
      if ((e as any).agentInvoked === true) this.push('dom', { t: this.now(e.timeStamp), kind: 'webmcp-submit' });
    }, o);
    const mc = (document as any).modelContext;
    const toolTarget: EventTarget = mc && 'ontoolactivated' in mc ? mc : window;
    for (const type of ['toolactivated', 'toolcancel']) {
      toolTarget.addEventListener(type, (e: any) => {
        this.push('dom', { t: this.now(e.timeStamp), kind: 'webmcp-tool', tag: String(e.toolName ?? type).slice(0, 40) });
      }, o);
    }
    if (!this.hasVSE) {
      this.push('vis', { t: this.now(), hid: bit(document.hidden) });
      document.addEventListener('visibilitychange', () => this.push('vis', { t: this.now(), hid: bit(document.hidden) }), o);
    }

    if (this.opts.canaries) this.injectCanary();
    this.queueScan(document);
    this.observeDom();

    if (this.opts.endpoint) {
      this.ready = this.openSession().catch(() => undefined);
    }
    this.timer = window.setInterval(() => this.flush(false), this.opts.flushMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.observer?.disconnect();
  }

  // ───────────────────────── collectors ─────────────────────────

  private onMove(e: PointerEvent) {
    if (this.overMask) return; // a pointer path over a keypad traces the digits
    const t = this.now(e.timeStamp);
    let c = 0;
    try { c = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents().length : 0; } catch { c = 0; }
    const ev: PtrEv = { t, x: Math.round(e.clientX * 10) / 10, y: Math.round(e.clientY * 10) / 10, c, tr: bit(e.isTrusted), pt: pk(e.pointerType) };
    if (this.leftDoc) { ev.re = 1; this.leftDoc = false; }
    this.push('ptr', ev);
    this.recentMoves.push(t);
    if (this.recentMoves.length > 200) this.recentMoves.splice(0, 100);
    if (this.buttonDown) this.lastScrollCause = t;
  }

  private onBtn(e: Event, k: 'd' | 'u') {
    // A native <select> opens an OS popup on mousedown; the page then gets its mouseup with the SAME
    // timestamp (measured on a real person: a 0 ms "hold"). That pair says nothing about how long the
    // button was held, so it is not recorded.
    const tag = (e.target as Element | null)?.tagName;
    if (tag === 'SELECT' || tag === 'OPTION') return;
    const ev: BtnEv = { t: this.now(e.timeStamp), k, tr: bit(e.isTrusted) };
    if (this.lastPt !== 'mouse') ev.pt = this.lastPt;
    this.push('btn', ev);
  }

  private onClick(e: PointerEvent) {
    const t = this.now(e.timeStamp);
    const target = e.target as Element | null;
    if (target && target.classList?.contains(CANARY_CLASS)) {
      this.push('dom', { t, kind: 'canary-click' });
    }
    const el = (target?.closest?.(INTERACTIVE) as Element | null) || target;
    const mk = this.masked(target);
    let dx = 0, dy = 0, w = 0, h = 0;
    if (!mk && el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      w = Math.round(r.width); h = Math.round(r.height);
      dx = Math.round((e.clientX - (r.left + r.width / 2)) * 10) / 10;
      dy = Math.round((e.clientY - (r.top + r.height / 2)) * 10) / 10;
    }
    const pre = this.recentMoves.filter((m) => m > t - 500 && m <= t).length;
    const ptype = (e as PointerEvent).pointerType;
    const ev: ClickEv = {
      t, x: mk ? 0 : Math.round(e.clientX * 10) / 10, y: mk ? 0 : Math.round(e.clientY * 10) / 10, tr: bit(e.isTrusted),
      det: e.detail, dx, dy, w, h, pre: mk ? 0 : pre, bg: bg(), pt: ptype ? pk(ptype) : 'none',
    };
    if (mk) ev.mk = 1;
    if (!e.isTrusted && this.autofillField(target)) ev.af = 1;
    this.push('click', ev);
    this.lastScrollCause = t; // anchor jumps / app scroll-to after a click are caused
  }

  private onKey(e: KeyboardEvent, k: 'd' | 'u') {
    // Key rhythm in a PIN/secret field is not ours to measure. That protects the person's input only:
    // a script-dispatched event is not theirs, and dropping it would let a script hide behind a mask.
    if (e.isTrusted && this.masked(e.target)) return;
    const t = this.now(e.timeStamp);
    let s: number;
    if (k === 'd') {
      if (!e.repeat) { s = ++this.keySeq; this.openKeys.set(e.code || e.key, s); }
      else s = this.openKeys.get(e.code || e.key) ?? ++this.keySeq;
    } else {
      s = this.openKeys.get(e.code || e.key) ?? -1;
      this.openKeys.delete(e.code || e.key);
    }
    const ime = e.isComposing || e.keyCode === 229;
    if (ime && k === 'd') this.last229 = t;
    const key = String(e.key || '');
    const mod = bit(ime || key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey);
    const ev: KeyEv = { t, k, tr: bit(e.isTrusted), s, rep: bit(e.repeat), mod, bg: bg() };
    if (k === 'd' && e.isTrusted) ev.l = Math.round((performance.now() - e.timeStamp) * 100) / 100;
    if (!e.isTrusted && this.autofillField(e.target)) ev.af = 1;
    this.push('key', ev);
    if (k === 'd') {
      // Only a key that types a character can explain inserted text. Ctrl/Cmd shortcuts and bare
      // modifiers cannot; AltGr (reported as Ctrl+Alt on Windows) can.
      let altGr = false;
      try { altGr = e.getModifierState('AltGraph'); } catch { /* old browsers */ }
      if (e.isTrusted && key.length === 1 && (altGr || !(e.ctrlKey || e.metaKey))) { this.lastKeydown = t; this.kdFresh = true; }
      this.lastScrollCause = t;
    }
  }

  private onInput(e: InputEvent) {
    const t = this.now(e.timeStamp);
    const target = e.target as HTMLElement | null;
    const it = String(e.inputType || '').slice(0, 32);
    if (target?.classList?.contains(CANARY_CLASS) && it !== 'insertReplacementText' && this.inputSource(target) !== 1) {
      this.push('dom', { t, kind: 'canary-fill' });
    }
    if (e.isTrusted && this.masked(target)) return; // input timing in a masked field is key timing by another name (script events are still recorded)
    const composing = !!e.isComposing || t - this.lastCompEnd < 50 || t - this.last229 < 50;
    let kd = this.lastKeydown >= 0 ? Math.round(t - this.lastKeydown) : -1;
    if (it === 'insertText' && e.isTrusted) {
      // One printable keydown pays for one insertText. Text injected right after a real key press
      // (DevTools Protocol insertText) finds the keydown already spent and stays keyless.
      if (!this.kdFresh) kd = -1;
      this.kdFresh = false;
    }
    const ev: InputEv = { t, it, tr: bit(e.isTrusted), kd, comp: bit(composing), bg: bg() };
    const src = this.inputSource(target);
    if (src) ev.src = src;
    if (!e.isTrusted && this.autofillField(target)) ev.af = 1;
    this.push('input', ev);
  }

  /** 1 = browser/password-manager autofill (:autofill), 2 = one-time-code field (SMS / WebOTP fill). */
  private inputSource(target: HTMLElement | null): InputSource {
    if (!target || !(target as HTMLInputElement).matches) return 0;
    const m = (sel: string) => { try { return target.matches(sel); } catch { return false; } };
    if (m(':autofill') || m(':-webkit-autofill')) return 1;
    if ((target.getAttribute('autocomplete') || '').includes('one-time-code')) return 2;
    return 0;
  }

  private onViolation(e: SecurityPolicyViolationEvent) {
    if (!String(e.violatedDirective || '').startsWith('require-trusted-types-for')) return;
    const f = String(e.sourceFile || '');
    const by: DomEv['by'] = !f ? 'none'
      : /^(chrome|moz|safari-web)-extension/.test(f) ? 'extension'
      : f.startsWith(location.origin) ? 'page' : 'other';
    // The app's own code and its third-party scripts are not evidence, and must not use up the
    // budget: an app that sets innerHTML on a timer would otherwise blind this signal in a minute.
    if (by === 'page' || by === 'other') return;
    if (++this.sinkCount > 50) return;
    this.push('dom', { t: this.now(e.timeStamp), kind: 'script-sink', by });
  }

  private onFocusIn(e: FocusEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.classList?.contains(CANARY_CLASS)) this.push('dom', { t: this.now(e.timeStamp), kind: 'canary-focus' });
  }

  private onScroll() {
    const t = this.now();
    const y = window.scrollY;
    const dy = Math.round(y - this.lastScrollY);
    this.lastScrollY = y;
    if (dy === 0) return;
    const continuation = this.lastScrollCaused && t - this.lastScrollT < 150; // smooth-scroll tail
    const caused = this.buttonDown || t - this.lastScrollCause <= 1000 || continuation;
    this.lastScrollT = t;
    this.lastScrollCaused = caused;
    const ev: ScrollEv = { t, dy, cause: bit(caused) };
    this.push('scroll', ev);
  }

  private onFocus() {
    const ev: FocusEv = { t: this.now(), hid: bit(document.hidden), foc: bit(bg() === 0) };
    this.push('focus', ev);
  }

  private injectCanary() {
    const add = () => {
      if (document.querySelector(`a.${CANARY_CLASS}`)) return;
      const a = document.createElement('a');
      a.href = '#';
      a.className = CANARY_CLASS;
      a.textContent = 'Skip security verification';
      a.setAttribute('aria-hidden', 'true');
      a.tabIndex = -1;
      a.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;';
      a.addEventListener('click', (ev) => ev.preventDefault());
      document.body.appendChild(a);
    };
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
  }

  /**
   * Returns a honeypot text field to place inside a form. It is invisible,
   * hidden from screen readers and skipped by autofill; any fill is reported.
   */
  static canaryField(name = 'ad_reference_code'): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'text';
    i.name = name;
    i.className = CANARY_CLASS;
    i.autocomplete = 'off';
    i.tabIndex = -1;
    i.setAttribute('aria-hidden', 'true');
    i.setAttribute('data-1p-ignore', '');        // 1Password
    i.setAttribute('data-lpignore', 'true');     // LastPass
    i.setAttribute('data-bwignore', 'true');     // Bitwarden
    i.setAttribute('data-form-type', 'other');   // Dashlane
    i.placeholder = 'Reference code';
    i.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;opacity:0;';
    return i;
  }

  private observeDom() {
    const { appRoots, agentMarkers, benignForeign } = this.opts;
    if (!('MutationObserver' in window)) return;
    const inApp = (n: Element) => appRoots.some((sel) => { try { return !!n.closest(sel); } catch { return false; } });
    this.observer = new MutationObserver((muts) => {
      const t = this.now();
      for (const m of muts) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const el = node as Element;
          this.queueScan(el); // classify any form fields it brings, before anything can retag them
          if (el.classList?.contains(CANARY_CLASS) || el.tagName === 'IFRAME' && (el as HTMLIFrameElement).style.visibility === 'hidden') return;
          if (agentMarkers.some((sel) => { try { return el.matches(sel) || !!el.querySelector(sel); } catch { return false; } })) {
            this.push('dom', { t, kind: 'agent-marker', tag: el.tagName.toLowerCase() } as DomEv);
            return;
          }
          if (!appRoots.length) return;
          if (el.closest('head') || inApp(el)) return;
          const sig = `${el.tagName} ${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
          if (benignForeign.test(sig)) return;
          this.push('dom', { t, kind: 'foreign-node', tag: el.tagName.toLowerCase().slice(0, 40) } as DomEv);
        });
      }
    });
    const go = () => this.observer!.observe(document.documentElement, { childList: true, subtree: true });
    if (document.documentElement) go();
  }

  // ───────────────────────── transport ─────────────────────────

  private async openSession() {
    let sid = '';
    try { sid = sessionStorage.getItem('ad.sid') || ''; } catch { /* storage blocked */ }
    const res = await fetch(`${this.opts.endpoint}/session`, {
      // `ct` is this collector's clock right now; the server uses it to place this page load on the session timeline
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: this.sid || sid, ct: this.now() }),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error('session');
    const j = await res.json();
    this.sid = j.sid; this.nonce = j.nonce; this.seq = j.seq ?? 0;
    try { sessionStorage.setItem('ad.sid', this.sid); } catch { /* ignore */ }
  }

  /** Open again after the server stopped accepting us (restart, expiry, another tab took the nonce). At most every 5 s. */
  private async reopen() {
    if (Date.now() - this.lastReopen < 5000) return;
    this.lastReopen = Date.now();
    this.ready = this.openSession().catch(() => undefined);
    await this.ready;
  }

  /** Copy new VisibilityStateEntry records (browser timeline, exact timestamps) into the buffer. */
  private pullVisibility() {
    if (!this.hasVSE) return;
    try {
      const list = performance.getEntriesByType('visibility-state');
      for (let i = this.visSent; i < list.length; i++) {
        this.push('vis', { t: this.now(list[i].startTime), hid: bit(list[i].name === 'hidden') });
      }
      this.visSent = list.length;
    } catch { /* ignore */ }
  }

  private takeBatch(): Batch {
    const b: Batch = { sid: this.sid, nonce: this.nonce, seq: ++this.seq, ...this.buf };
    if (!this.envSent && this.env) { b.env = this.env; this.envSent = true; }
    this.buf = emptyTrace();
    return b;
  }

  /**
   * Ship buffered events. Returns when the server has them. Calls are queued, never concurrent:
   * the server rejects a batch that arrives after a later one, so overlap would lose evidence.
   */
  flush(beacon = false): Promise<void> {
    if (beacon) return this.send(true); // pagehide: there is no "later" to queue behind
    const run = this.chain.then(() => this.send(false));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async send(beacon: boolean): Promise<void> {
    this.pullVisibility();
    if (this.opts.onLocalScore) {
      try { this.opts.onLocalScore(this.localScore()); } catch { /* ignore */ }
    }
    if (!this.opts.endpoint) return;
    await this.ready;
    if (!this.sid) {
      if (beacon) return;
      await this.reopen();
      if (!this.sid) return;
    }
    const envPending = !this.envSent && !!this.env;
    const empty = !envPending && Object.values(this.buf).every((v) => !Array.isArray(v) || v.length === 0);
    if (empty) return;
    const body = JSON.stringify(this.takeBatch());
    const url = `${this.opts.endpoint}/collect`;
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); return; }
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60000, credentials: 'same-origin' });
      if (res.status === 403) { this.envSent = false; await this.reopen(); } // the server may be a fresh one: send env again
    } catch { /* network errors are tolerated; server sees a gap */ }
  }

  /**
   * Ask the server what to do before a sensitive action.
   * @param ctx Optional transaction context (use AgentDetect.contextHash(...)). The token is then only
   *            valid for a request whose context the API recomputes to the same value.
   * Any failure to get a decision is `step_up`: this side fails closed too, though the API is what enforces.
   */
  async decide(action: string, ctx?: string): Promise<DecideResult> {
    const closed: DecideResult = { decision: 'step_up' };
    try { await this.flush(false); } catch { /* decide anyway */ }
    if (!this.opts.endpoint || !this.sid) return closed;
    try {
      const res = await fetch(`${this.opts.endpoint}/decide`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid: this.sid, nonce: this.nonce, action, ...(ctx ? { ctx } : {}) }), credentials: 'same-origin',
      });
      if (!res.ok) return closed;
      const j = await res.json();
      return j && DECISIONS.indexOf(j.decision) >= 0 ? j : closed;
    } catch { return closed; }
  }

  /**
   * Canonical transaction context: base64url(SHA-256(parts joined by "\n")). The server's contextHash()
   * gives the same value, so the API can recompute it from the request it is about to execute.
   * Pass identifiers and amounts — it is a hash, nothing readable leaves the page.
   */
  static async contextHash(...parts: (string | number)[]): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.map(String).join('\n'))));
    let bin = '';
    for (let i = 0; i < d.length; i++) bin += String.fromCharCode(d[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Local, NON-authoritative score for debugging and UX only. */
  localScore(): ScoreResult {
    return scoreTrace(this.all);
  }

  /** Raw local features, for debugging. */
  localFeatures() {
    return extractFeatures(this.all);
  }

  get sessionId() { return this.sid; }
}

export { mergeBatch };
export default AgentDetect;

/**
 * agent-detect browser collector.
 *
 *   const ad = AgentDetect.init({ endpoint: '/ad' });
 *   const { decision } = await ad.decide('transfer');   // allow | notify | step_up | block
 *
 * The browser only collects and ships raw timing/geometry. The server scores
 * and decides, so an agent that patches this script cannot forge a verdict —
 * at worst it can stop reporting, which the server treats as "unknown".
 */
import type {
  Batch, BgState, Bit, ClickEv, Decision, DomEv, EnvSnapshot, FocusEv, InputEv, InputSource, KeyEv, PointerKind, PtrEv,
  ScoreResult, ScrollEv, BtnEv, SessionTrace,
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
  private t0 = performance.now();
  private buf: SessionTrace = emptyTrace();
  private all: SessionTrace = emptyTrace(); // local copy for debug scoring
  private sid = '';
  private nonce = '';
  private seq = 0;
  private ready: Promise<void> = Promise.resolve();
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
  private lastKeydown = -1;
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
      ...opts,
    };
  }

  /** ms since collector start, on the same clock as event.timeStamp. */
  private now(ts?: number): number {
    const v = (ts ?? performance.now()) - this.t0;
    return Math.round(v * 10) / 10;
  }

  private push<K extends keyof Omit<SessionTrace, 'env'>>(k: K, ev: SessionTrace[K][number]) {
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
    window.addEventListener('pointerdown', () => { this.buttonDown = true; this.lastScrollCause = this.now(); }, o);
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
    const ev: BtnEv = { t: this.now(e.timeStamp), k, tr: bit(e.isTrusted) };
    this.push('btn', ev);
  }

  private onClick(e: PointerEvent) {
    const t = this.now(e.timeStamp);
    const target = e.target as Element | null;
    if (target && target.classList?.contains(CANARY_CLASS)) {
      this.push('dom', { t, kind: 'canary-click' });
    }
    const el = (target?.closest?.(INTERACTIVE) as Element | null) || target;
    let dx = 0, dy = 0, w = 0, h = 0;
    if (el && el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      w = Math.round(r.width); h = Math.round(r.height);
      dx = Math.round((e.clientX - (r.left + r.width / 2)) * 10) / 10;
      dy = Math.round((e.clientY - (r.top + r.height / 2)) * 10) / 10;
    }
    const pre = this.recentMoves.filter((m) => m > t - 500 && m <= t).length;
    const ptype = (e as PointerEvent).pointerType;
    const ev: ClickEv = {
      t, x: Math.round(e.clientX * 10) / 10, y: Math.round(e.clientY * 10) / 10, tr: bit(e.isTrusted),
      det: e.detail, dx, dy, w, h, pre, bg: bg(), pt: ptype ? pk(ptype) : 'none',
    };
    this.push('click', ev);
    this.lastScrollCause = t; // anchor jumps / app scroll-to after a click are caused
  }

  private onKey(e: KeyboardEvent, k: 'd' | 'u') {
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
    const mod = bit(ime || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey);
    const ev: KeyEv = { t, k, tr: bit(e.isTrusted), s, rep: bit(e.repeat), mod, bg: bg() };
    if (k === 'd' && e.isTrusted) ev.l = Math.round((performance.now() - e.timeStamp) * 100) / 100;
    this.push('key', ev);
    if (k === 'd') {
      if (e.isTrusted) this.lastKeydown = t;
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
    const composing = !!e.isComposing || t - this.lastCompEnd < 50 || t - this.last229 < 50;
    const ev: InputEv = {
      t, it, tr: bit(e.isTrusted), kd: this.lastKeydown >= 0 ? Math.round(t - this.lastKeydown) : -1,
      comp: bit(composing), bg: bg(),
    };
    const src = this.inputSource(target);
    if (src) ev.src = src;
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
    if (++this.sinkCount > 50) return; // the app's own legacy code must not flood the stream
    const f = String(e.sourceFile || '');
    const by: DomEv['by'] = !f ? 'none'
      : /^(chrome|moz|safari-web)-extension/.test(f) ? 'extension'
      : f.startsWith(location.origin) ? 'page' : 'other';
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
    i.setAttribute('data-1p-ignore', '');
    i.setAttribute('data-lpignore', 'true');
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
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid }),
      credentials: 'same-origin',
    });
    const j = await res.json();
    this.sid = j.sid; this.nonce = j.nonce; this.seq = j.seq ?? 0;
    try { sessionStorage.setItem('ad.sid', this.sid); } catch { /* ignore */ }
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

  /** Ship buffered events. Returns when the server has them. */
  async flush(beacon = false): Promise<void> {
    this.pullVisibility();
    if (this.opts.onLocalScore) {
      try { this.opts.onLocalScore(this.localScore()); } catch { /* ignore */ }
    }
    if (!this.opts.endpoint) return;
    await this.ready;
    if (!this.sid) return;
    const envPending = !this.envSent && !!this.env;
    const empty = !envPending && Object.values(this.buf).every((v) => !Array.isArray(v) || v.length === 0);
    if (empty) return;
    const body = JSON.stringify(this.takeBatch());
    const url = `${this.opts.endpoint}/collect`;
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(url, new Blob([body], { type: 'application/json' })); return; }
    try {
      await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60000, credentials: 'same-origin' });
    } catch { /* network errors are tolerated; server sees a gap */ }
  }

  /** Ask the server what to do before a sensitive action. */
  async decide(action: string): Promise<DecideResult> {
    await this.flush(false);
    if (!this.opts.endpoint || !this.sid) {
      return { decision: 'step_up' }; // fail closed for sensitive actions when the collector cannot report
    }
    const res = await fetch(`${this.opts.endpoint}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sid: this.sid, nonce: this.nonce, action }), credentials: 'same-origin',
    });
    return res.json();
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

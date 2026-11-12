/**
 * agent-detect server module (Node, zero dependencies).
 *
 * Mount it in any Node HTTP server:
 *
 *   const ad = createAgentDetect({
 *     secret: process.env.AD_SECRET!,                 // >= 32 chars; an array rotates (first signs, all verify)
 *     policy: { transfer: 'high', wire: 'critical' },
 *     bind: (req) => appSessionIdOf(req),             // ties detection to YOUR authenticated session
 *   });
 *   http.createServer(async (req, res) => { if (await ad.handle(req, res)) return; ... });
 *
 * Endpoints (under `basePath`, default /ad):
 *   POST /session  → { sid, nonce, seq }
 *   POST /collect  → ingest one batch (nonce + monotonic seq enforced)
 *   POST /decide   → { decision, token, [verdict, score, reasons] }
 *
 * The API that performs the action calls ad.authorize(token, { action, ctx, req }).
 *
 * Everything the browser sends is attacker-controlled. This module therefore:
 *  - validates and clamps every field (sanitizeBatch),
 *  - places every event on its own clock and drops what the client could not have observed yet,
 *  - never lets evidence be erased (monotonic env, latched Tier 1 hits),
 *  - treats silence as worse than being seen, and anything unrecognised as high sensitivity.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Batch, Decision, RuleHit, Sensitivity, SessionTrace, StreamKey } from '../core/types';
import { appendBatch, DOM_KINDS, emptyTrace, overCap, SENSITIVITIES, STREAM_CAPS, STREAM_KEYS, TIER1_STREAMS, trimTrace } from '../core/types';
import { decide, scoreTrace, type ScoreConfig } from '../core/score';
import { extractFeatures } from '../core/features';

/**
 * Send this as `Content-Security-Policy-Report-Only` on pages using the SDK.
 * It blocks nothing; it makes the browser report HTML/script injected through
 * string sinks (DevTools Protocol, main-world extension scripts), which feeds
 * the `dom.injected_html` rule. Your own code should not use innerHTML etc.,
 * or its reports are ignored as 'page'.
 */
export const TRUSTED_TYPES_REPORT_ONLY = "require-trusted-types-for 'script'";

/** Events may be stamped at most this far ahead of the server's own clock for the session. */
export const FUTURE_SLACK_MS = 5000;
/** Events older than this before the page's /session call are dropped (visibility state is clamped instead). */
export const PREOPEN_MS = 10_000;

export interface DecisionEvent {
  /** The server's own session id, or null when the caller did not present a valid one. Never client-shaped data. */
  sid: string | null;
  action: string;
  sensitivity: Sensitivity;
  decision: Decision;
  verdict: string;
  score: number;
  hits: string[];
  /** 'recent' when the verdict came from the last few actions rather than the whole session. */
  scope: 'session' | 'recent';
  /** Token id, to join the audit record with the API's authorize() call. */
  jti: string;
  /** Events the server refused because their timestamps were impossible (ahead of its clock / far before the page opened). */
  dropped: { future: number; stale: number };
}

export interface AgentDetectServerOptions {
  /** HMAC secret for decision tokens, at least 32 characters. Pass an array to rotate: the first signs, all verify. */
  secret: string | string[];
  /** Action name → sensitivity. Unknown actions default to "high" (fail closed). Invalid values throw at startup. */
  policy?: Record<string, Sensitivity>;
  basePath?: string;
  /** Return verdict/score/reasons to the browser. Keep false in production: it teaches attackers the rules. */
  exposeReasons?: boolean;
  /** Enable GET {basePath}/debug/:sid (demo only). */
  debug?: boolean;
  scoreConfig?: ScoreConfig;
  /** Decision token lifetime, seconds. Default 120. */
  tokenTtl?: number;
  /** Session idle expiry, ms. Default 30 min. */
  sessionTtlMs?: number;
  /** Max sessions held in memory (least recently used is evicted). Default 50 000; budget ~1.5 MB worst case each. */
  maxSessions?: number;
  /**
   * Return a stable id for the caller's authenticated app session (e.g. your session-cookie id), or null.
   * When set: every endpoint requires it, there is exactly one detection session per app session (so a
   * flagged session cannot be swapped for a fresh one), and tokens are bound to it (so a token minted in
   * one user's session is useless in another's). Strongly recommended in production.
   */
  bind?: (req: IncomingMessage) => string | null | undefined;
  /** Accept requests the browser labels `Sec-Fetch-Site: cross-site`. Default false. */
  allowCrossSite?: boolean;
  /** Hook for audit logging. Exceptions are swallowed; it can never change a decision. */
  onDecision?: (e: DecisionEvent) => void;
}

export interface Session {
  sid: string;
  nonce: string;
  seq: number;
  trace: SessionTrace;
  touched: number;
  /** Server wall clock when the session was created; all trace timestamps are ms since this. */
  created: number;
  /** Server ms-since-created at the current page load's /session call. */
  openAt: number;
  /** The collector's own clock at that call, as it reported it. */
  ct: number;
  /** Keyed hash of the app-session binding, when `bind` is configured. */
  sub?: string;
  /** Tier 1 hits latched so that evicting old events cannot erase them. */
  sticky: Map<string, RuleHit>;
  dropped: { future: number; stale: number };
}

const MAX_BODY = 512 * 1024;

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Constant-time string equality that never throws on attacker-shaped input. */
function safeEq(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ───────────── input validation: never trust the client's shapes ─────────────
const num = (v: unknown, lo = -1e7, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const b01 = (v: unknown) => (v === 1 ? 1 : 0) as 0 | 1;
const bg3 = (v: unknown) => (v === 2 ? 2 : v === 1 ? 1 : 0) as 0 | 1 | 2;
const ptk = (v: unknown) => (v === 'touch' || v === 'pen' ? v : 'mouse') as 'mouse' | 'pen' | 'touch';
/** `af` (autofill-class target) only means something on untrusted events; ignore it anywhere else. */
const afOf = (x: any) => (x.tr !== 1 && x.af === 1 ? { af: 1 as const } : {});
function arr<T>(v: unknown, map: (x: any) => T | null, cap = 4000): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, cap)) { const m = x && typeof x === 'object' ? map(x) : null; if (m) out.push(m); }
  return out;
}

export function sanitizeBatch(b: any): Partial<Batch> {
  const out: Partial<Batch> = {
    ptr: arr(b.ptr, (x) => { const t = num(x.t), X = num(x.x), Y = num(x.y); return t === null || X === null || Y === null ? null : { t, x: X, y: Y, c: num(x.c, 0, 1000) ?? 0, tr: b01(x.tr), pt: ptk(x.pt), ...(x.re === 1 ? { re: 1 as const } : {}) }; }),
    btn: arr(b.btn, (x) => { const t = num(x.t); return t === null ? null : { t, k: x.k === 'u' ? 'u' : 'd', tr: b01(x.tr), ...(x.pt === 'touch' || x.pt === 'pen' ? { pt: x.pt } : {}) }; }),
    click: arr(b.click, (x) => {
      const t = num(x.t);
      if (t === null) return null;
      const base = { t, tr: b01(x.tr), det: num(x.det, 0, 100) ?? 0, pre: num(x.pre, 0) ?? 0, bg: bg3(x.bg), pt: x.pt === 'none' ? 'none' as const : ptk(x.pt), ...afOf(x) };
      // a masked click (PIN pad) must carry no geometry, whatever the client sent
      if (x.mk === 1) return { ...base, x: 0, y: 0, dx: 0, dy: 0, w: 0, h: 0, mk: 1 as const };
      return { ...base, x: num(x.x) ?? 0, y: num(x.y) ?? 0, dx: num(x.dx) ?? 0, dy: num(x.dy) ?? 0, w: num(x.w, 0) ?? 0, h: num(x.h, 0) ?? 0 };
    }),
    key: arr(b.key, (x) => { const t = num(x.t); if (t === null) return null; const l = num(x.l, 0, 10000); return { t, k: x.k === 'u' ? 'u' : 'd', tr: b01(x.tr), s: num(x.s) ?? -1, rep: b01(x.rep), mod: b01(x.mod), bg: bg3(x.bg), ...(l !== null ? { l } : {}), ...afOf(x) }; }),
    input: arr(b.input, (x) => { const t = num(x.t); if (t === null) return null; const src = x.src === 1 || x.src === 2 ? x.src : 0; return { t, it: typeof x.it === 'string' ? x.it.slice(0, 32) : '', tr: b01(x.tr), kd: num(x.kd, -1) ?? -1, comp: b01(x.comp), bg: bg3(x.bg), ...(src ? { src } : {}), ...afOf(x) }; }),
    vis: arr(b.vis, (x) => { const t = num(x.t); return t === null ? null : { t, hid: b01(x.hid) }; }, 200),
    scroll: arr(b.scroll, (x) => { const t = num(x.t); return t === null ? null : { t, dy: num(x.dy) ?? 0, cause: b01(x.cause) }; }),
    focus: arr(b.focus, (x) => { const t = num(x.t); return t === null ? null : { t, hid: b01(x.hid), foc: b01(x.foc) }; }),
    dom: arr(b.dom, (x) => {
      const t = num(x.t);
      if (t === null || !DOM_KINDS.includes(x.kind)) return null;
      const by = ['none', 'extension', 'page', 'other'].includes(x.by) ? x.by : undefined;
      return { t, kind: x.kind, ...(typeof x.tag === 'string' ? { tag: x.tag.slice(0, 40) } : {}), ...(by ? { by } : {}) };
    }, 500),
  };
  const e = b.env;
  if (e && typeof e === 'object') {
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string').map((s: string) => s.slice(0, 80)).slice(0, 40) : []);
    out.env = {
      webdriver: e.webdriver === true,
      webdriverIframeMismatch: e.webdriverIframeMismatch === true,
      webdriverOwnProperty: e.webdriverOwnProperty === true,
      headlessUA: e.headlessUA === true,
      automationGlobals: strs(e.automationGlobals),
      nativeTampered: strs(e.nativeTampered),
      cdpRuntime: e.cdpRuntime === true,
      renderer: typeof e.renderer === 'string' ? e.renderer.slice(0, 120) : '',
      softwareRenderer: e.softwareRenderer === true,
      screenW: num(e.screenW, 0, 20000) ?? 0,
      screenH: num(e.screenH, 0, 20000) ?? 0,
      platform: typeof e.platform === 'string' ? e.platform.slice(0, 40) : '',
      pointerFine: e.pointerFine === true,
      touchPoints: num(e.touchPoints, 0, 100) ?? 0,
      languages: num(e.languages, 0, 100) ?? 0,
    };
  }
  return out;
}

/**
 * Put a sanitized batch on the session's own timeline and drop what cannot be true.
 *
 * The collector stamps events in ms since ITS start, and that clock restarts on every page load.
 * The server knows when each page load called /session (`openAt`, on its own clock) and what the
 * collector's clock read at that moment (`ct`), so `t + (openAt - ct)` is the event's time since
 * the session was created. That gives one monotonic timeline across page loads, and a hard bound:
 * an event cannot be later than "now". A fabricated history therefore has to be fed in real time;
 * it cannot be uploaded in one request. (It can still be forged slowly — see THREAT-MODEL.md.)
 */
function rebase(b: Partial<Batch>, s: Session, now: number): Partial<Batch> {
  const offset = s.openAt - s.ct;
  const hi = now - s.created + FUTURE_SLACK_MS;
  const lo = s.openAt - PREOPEN_MS;
  for (const k of STREAM_KEYS) {
    const src = b[k] as { t: number }[] | undefined;
    if (!src || !src.length) continue;
    const out: { t: number }[] = [];
    for (const ev of src) {
      let t = Math.round((ev.t + offset) * 10) / 10;
      if (t > hi) { s.dropped.future++; continue; }
      if (t < lo) {
        // old visibility entries still define the state at page start: keep the state, clamp the time
        if (k === 'vis') t = lo; else { s.dropped.stale++; continue; }
      }
      ev.t = t;
      out.push(ev);
    }
    (b as Record<StreamKey, unknown>)[k] = out;
  }
  return b;
}

// ───────────── decision tokens ─────────────
const DECISIONS: Decision[] = ['allow', 'notify', 'step_up', 'block'];

export interface TokenPayload {
  /** Format version (1). */
  v?: number;
  /** Unique token id; authorize() accepts each id once. */
  jti?: string;
  iat?: number;
  exp: number;
  sid: string | null;
  /** Keyed hash of the app-session binding (when `bind` is configured). */
  sub?: string;
  action: string;
  decision: Decision;
  /** Opaque transaction context the token was issued for (e.g. a hash of payee + amount). */
  ctx?: string;
}

export interface TokenExpect { action?: string; ctx?: string; sub?: string }

function b64u(buf: Buffer) { return buf.toString('base64url'); }
const asList = (secret: string | string[]) => (Array.isArray(secret) ? secret : [secret]);

export function signToken(secret: string, payload: Record<string, unknown>): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const mac = b64u(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

/**
 * Verify a decision token: signature (any of the given secrets), expiry, shape, and — when given —
 * the expected action / ctx / sub. Returns the payload, or null. This does NOT enforce single use
 * or look at `decision`; use `authorize()` on the instance for the full check.
 */
export function verifyToken(secret: string | string[], token: string, expect: TokenExpect = {}): TokenPayload | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, mac] = parts;
  const got = Buffer.from(mac, 'base64url');
  let authentic = false;
  for (const k of asList(secret)) {
    const want = createHmac('sha256', k).update(body).digest();
    if (got.length === want.length && timingSafeEqual(got, want)) authentic = true; // no early exit: constant work per key
  }
  if (!authentic) return null;
  let p: TokenPayload;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return null;
  if (typeof p.action !== 'string' || !DECISIONS.includes(p.decision)) return null;
  if (expect.action !== undefined && p.action !== expect.action) return null;
  if (expect.ctx !== undefined && p.ctx !== expect.ctx) return null;
  if (expect.sub !== undefined && p.sub !== expect.sub) return null;
  return p;
}

/** Canonical transaction context: base64url(SHA-256(parts joined by "\n")). Same value as the client's AgentDetect.contextHash(). */
export function contextHash(...parts: (string | number)[]): string {
  return b64u(createHash('sha256').update(parts.map(String).join('\n')).digest());
}

export interface AuthorizeExpect {
  /** The action this endpoint performs. Required: a token for one action must never unlock another. */
  action: string;
  /** Transaction context recomputed by the API from the request it is about to execute. */
  ctx?: string;
  /** The request being authorized; its binding is taken with the configured `bind`. */
  req?: IncomingMessage;
  /** Or the raw binding value itself (same thing `bind` would return). */
  binding?: string;
  /** Set true only after YOUR server verified a fresh passkey assertion for this user and this transaction. */
  stepUpVerified?: boolean;
}

export type AuthorizeReason = 'ok' | 'invalid' | 'action' | 'ctx' | 'binding' | 'decision' | 'replayed' | 'busy';

const ACTION_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const CTX_RE = /^[A-Za-z0-9_\-.:=+/]{1,128}$/;
const MAX_USED_TOKENS = 200_000;

export function createAgentDetect(opts: AgentDetectServerOptions) {
  const secrets = asList(opts.secret);
  if (!secrets.length || secrets.some((k) => typeof k !== 'string' || k.length < 32)) {
    throw new Error('agent-detect: secret must be at least 32 characters (HMAC-SHA256 key no shorter than its output)');
  }
  if (process.env.NODE_ENV === 'production' && (opts.exposeReasons || opts.debug)) {
    throw new Error('agent-detect: exposeReasons and debug must be off in production (they teach attackers the rules)');
  }
  // Own-property map, validated up front: a typo or a name like "constructor" must never read as "allow".
  const policy = new Map<string, Sensitivity>();
  for (const [action, level] of Object.entries(opts.policy ?? {})) {
    if (!SENSITIVITIES.includes(level)) throw new Error(`agent-detect: policy["${action}"] must be one of ${SENSITIVITIES.join(', ')}`);
    policy.set(action, level);
  }
  const base = (opts.basePath ?? '/ad').replace(/\/$/, '');
  const ttl = opts.tokenTtl ?? 120;
  const idle = opts.sessionTtlMs ?? 30 * 60 * 1000;
  const maxSessions = Math.max(1, opts.maxSessions ?? 50_000);
  const sessions = new Map<string, Session>();   // insertion order = least recently used first
  const byBinding = new Map<string, string>();   // sub → sid
  const usedTokens = new Map<string, number>();  // jti → exp (seconds)

  const subOf = (binding: string) => b64u(createHmac('sha256', secrets[0]).update('agent-detect/sub\n' + binding).digest()).slice(0, 22);
  const bindingOf = (req: IncomingMessage): string | null => {
    try { const v = opts.bind!(req); return typeof v === 'string' && v ? v : null; } catch { return null; }
  };

  const evict = (sid: string) => {
    const s = sessions.get(sid);
    if (s?.sub && byBinding.get(s.sub) === sid) byBinding.delete(s.sub);
    sessions.delete(sid);
  };
  const touch = (s: Session) => { s.touched = Date.now(); sessions.delete(s.sid); sessions.set(s.sid, s); };
  const purgeTokens = () => { const now = Date.now() / 1000; for (const [k, exp] of usedTokens) if (exp < now) usedTokens.delete(k); };
  const gc = () => {
    const now = Date.now();
    for (const [k, s] of sessions) if (now - s.touched > idle) evict(k);
    purgeTokens();
  };
  const gcTimer = setInterval(gc, 60_000);
  gcTimer.unref?.();

  function openSession(prevSid: string | undefined, sub: string | undefined, ct: number): Session {
    // With a binding, the app session decides which detection session you get — the client's sid is ignored,
    // so dropping the sid cannot swap a flagged session for a clean one.
    const sid = sub ? byBinding.get(sub) : prevSid;
    let s = sid ? sessions.get(sid) : undefined;
    if (s && !sub && s.sub) s = undefined;
    const now = Date.now();
    if (!s) {
      while (sessions.size >= maxSessions) evict(sessions.keys().next().value as string); // cap holds at insert time
      s = {
        sid: randomBytes(16).toString('hex'), nonce: '', seq: 0, trace: emptyTrace(), touched: now, created: now,
        openAt: 0, ct: 0, sticky: new Map(), dropped: { future: 0, stale: 0 }, ...(sub ? { sub } : {}),
      };
      sessions.set(s.sid, s);
      if (sub) byBinding.set(sub, s.sid);
    }
    s.nonce = randomBytes(16).toString('hex'); // each page load gets its own nonce; the previous page's batches stop being accepted
    s.openAt = now - s.created;
    s.ct = ct;
    touch(s);
    return s;
  }

  const sensitivityOf = (action: string): Sensitivity => policy.get(action) ?? 'high';

  /** Score now, and remember any Tier 1 hit for the rest of the session. */
  function scoreAndLatch(s: Session) {
    const r = scoreTrace(s.trace, opts.scoreConfig, [...s.sticky.values()]);
    for (const h of r.hits) if (h.tier === 1) s.sticky.set(h.id, h);
    return r;
  }

  /** No environment snapshot or no input events at all: the collector was blocked, or never ran. */
  const silent = (s: Session) => !s.trace.env || s.trace.ptr.length + s.trace.click.length + s.trace.key.length + s.trace.input.length === 0;

  function evaluateSession(s: Session | undefined, action: string) {
    const sensitivity = sensitivityOf(action);
    const noTelemetry = { decision: (sensitivity === 'low' ? 'allow' : 'step_up') as Decision, verdict: 'unknown', score: 0, hits: [] as RuleHit[], scope: 'session' as const, sensitivity };
    if (!s) return noTelemetry;
    const r = scoreAndLatch(s);
    // Silence must never be a better deal than being seen: with nothing reported, everything above "low" needs the human.
    if (silent(s) && !r.hits.some((h) => h.tier === 1)) return noTelemetry;
    return { decision: decide(r, sensitivity), verdict: r.verdict as string, score: r.score, hits: r.hits, scope: r.scope, sensitivity };
  }

  /** Decision for a session id and action, without issuing a token (admin / tests). */
  function evaluate(sid: string, action: string) {
    return evaluateSession(sessions.get(sid), ACTION_RE.test(action) ? action : 'unknown');
  }

  function authorize(token: string, expect: AuthorizeExpect): { ok: boolean; reason: AuthorizeReason; payload?: TokenPayload } {
    const p = verifyToken(secrets, token);
    if (!p || typeof p.jti !== 'string') return { ok: false, reason: 'invalid' };
    if (p.action !== expect.action) return { ok: false, reason: 'action', payload: p };
    // Both directions: a ctx-bound token needs a matching ctx, and an API that computed a ctx needs a token that carries it.
    if ((p.ctx ?? null) !== (expect.ctx ?? null)) return { ok: false, reason: 'ctx', payload: p };
    const raw = expect.binding ?? (expect.req && opts.bind ? bindingOf(expect.req) : null);
    if (opts.bind || raw) {
      if (!raw || p.sub !== subOf(raw)) return { ok: false, reason: 'binding', payload: p };
    }
    const proceed = p.decision === 'allow' || p.decision === 'notify' || (p.decision === 'step_up' && expect.stepUpVerified === true);
    if (!proceed) return { ok: false, reason: 'decision', payload: p };
    if (usedTokens.has(p.jti)) return { ok: false, reason: 'replayed', payload: p };
    if (usedTokens.size >= MAX_USED_TOKENS) { purgeTokens(); if (usedTokens.size >= MAX_USED_TOKENS) return { ok: false, reason: 'busy', payload: p }; }
    usedTokens.set(p.jti, p.exp);
    return { ok: true, reason: 'ok', payload: p };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://x');
    if (!url.pathname.startsWith(base + '/')) return false;
    const route = url.pathname.slice(base.length);
    try {
      if (req.method === 'POST' && (route === '/session' || route === '/collect' || route === '/decide')) {
        // A JSON content type cannot be sent cross-origin without a CORS preflight, and the browser labels
        // cross-site requests itself (Fetch Metadata): two cheap layers against another site driving these endpoints.
        if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { send(res, 415, { error: 'content-type must be application/json' }); return true; }
        if (!opts.allowCrossSite && req.headers['sec-fetch-site'] === 'cross-site') { send(res, 403, { error: 'cross-site request' }); return true; }
        let sub: string | undefined;
        if (opts.bind) {
          const binding = bindingOf(req);
          if (!binding) { send(res, 401, { error: 'no app session' }); return true; }
          sub = subOf(binding);
        }
        const body = await readJson(req);
        const known = typeof body.sid === 'string' ? sessions.get(body.sid) : undefined;

        if (route === '/session') {
          const s = openSession(typeof body.sid === 'string' ? body.sid : undefined, sub, num(body.ct, 0, 1e9) ?? 0);
          send(res, 200, { sid: s.sid, nonce: s.nonce, seq: s.seq });
          return true;
        }

        const s = known && safeEq(body.nonce, known.nonce) && known.sub === sub ? known : undefined;

        if (route === '/collect') {
          if (!s) { send(res, 403, { error: 'bad session' }); return true; }
          const seq = num(body.seq, 0);
          if (seq === null || seq <= s.seq) { send(res, 409, { error: 'replayed or out-of-order batch' }); return true; }
          s.seq = seq;
          touch(s);
          appendBatch(s.trace, rebase(sanitizeBatch(body), s, Date.now()));
          // Before anything that could carry hard evidence is evicted, score once and latch it.
          if (overCap(s.trace, TIER1_STREAMS)) scoreAndLatch(s);
          trimTrace(s.trace);
          send(res, 200, { ok: true });
          return true;
        }

        // /decide
        const action = typeof body.action === 'string' && ACTION_RE.test(body.action) ? body.action : 'unknown';
        const ctx = typeof body.ctx === 'string' && CTX_RE.test(body.ctx) ? body.ctx : undefined;
        if (s) touch(s);
        const r = evaluateSession(s, action);
        const nowSec = Math.floor(Date.now() / 1000);
        const payload: TokenPayload = {
          v: 1, jti: b64u(randomBytes(12)), iat: nowSec, exp: nowSec + ttl, sid: s ? s.sid : null,
          ...(sub ? { sub } : {}), action, decision: r.decision, ...(ctx ? { ctx } : {}),
        };
        const token = signToken(secrets[0], payload as unknown as Record<string, unknown>);
        try {
          opts.onDecision?.({
            sid: s ? s.sid : null, action, sensitivity: r.sensitivity, decision: r.decision, verdict: r.verdict, score: r.score,
            hits: r.hits.map((h) => h.id), scope: r.scope, jti: payload.jti!, dropped: s ? { ...s.dropped } : { future: 0, stale: 0 },
          });
        } catch { /* an audit hook must never change or break a decision */ }
        const out: Record<string, unknown> = { decision: r.decision, token };
        if (opts.exposeReasons) Object.assign(out, { verdict: r.verdict, score: r.score, scope: r.scope, reasons: r.hits.map((h) => ({ id: h.id, evidence: h.evidence })) });
        send(res, 200, out);
        return true;
      }
      if (opts.debug && req.method === 'GET' && route.startsWith('/debug/')) {
        const s = sessions.get(route.slice('/debug/'.length));
        if (!s) { send(res, 404, { error: 'no session' }); return true; }
        const f = extractFeatures(s.trace);
        const { strokes, holds, keyIntervals, keyHolds, gapValues, keyLatencies, ...rest } = f;
        send(res, 200, {
          score: scoreTrace(s.trace, opts.scoreConfig, [...s.sticky.values()]), features: { ...rest, strokes: strokes.length },
          counts: Object.fromEntries(STREAM_KEYS.map((k) => [k, s.trace[k].length])), cut: s.trace.cut ?? {}, dropped: s.dropped, caps: STREAM_CAPS,
        });
        return true;
      }
    } catch {
      send(res, 400, { error: 'bad request' });
      return true;
    }
    return false;
  }

  return {
    handle,
    evaluate,
    /** Full check for the API that performs the action: signature, expiry, action, ctx, binding, decision, single use. */
    authorize,
    /** Signature/expiry/shape check only (plus optional expectations). Prefer authorize(). */
    verifyToken: (token: string, expect?: TokenExpect) => verifyToken(secrets, token, expect),
    /** The token `sub` value for a raw binding, for services that verify tokens themselves. */
    subOf,
    stats: () => ({ sessions: sessions.size, usedTokens: usedTokens.size }),
    /** For tests/admin: the raw session. */
    _session: (sid: string) => sessions.get(sid),
    close: () => clearInterval(gcTimer),
  };
}

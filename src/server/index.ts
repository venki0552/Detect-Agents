/**
 * agent-detect server module (Node, zero dependencies).
 *
 * Mount it in any Node HTTP server:
 *
 *   const ad = createAgentDetect({ secret: process.env.AD_SECRET!, policy: { transfer: 'high' } });
 *   http.createServer((req, res) => { if (ad.handle(req, res)) return; ... });
 *
 * Endpoints (under `basePath`, default /ad):
 *   POST /session  → { sid, nonce, seq }
 *   POST /collect  → ingest one batch (nonce + monotonic seq enforced)
 *   POST /decide   → { decision, token, [verdict, score, reasons] }
 *
 * Downstream services verify the decision token with verifyToken().
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Batch, Decision, Sensitivity, SessionTrace } from '../core/types';
import { DOM_KINDS, emptyTrace, mergeBatch } from '../core/types';

/**
 * Send this as `Content-Security-Policy-Report-Only` on pages using the SDK.
 * It blocks nothing; it makes the browser report HTML/script injected through
 * string sinks (DevTools Protocol, main-world extension scripts), which feeds
 * the `dom.injected_html` rule. Your own code should not use innerHTML etc.,
 * or its reports are ignored as 'page'.
 */
export const TRUSTED_TYPES_REPORT_ONLY = "require-trusted-types-for 'script'";
import { decide, scoreTrace, type ScoreConfig } from '../core/score';
import { extractFeatures } from '../core/features';

export interface AgentDetectServerOptions {
  /** HMAC secret for decision tokens (>= 32 bytes recommended). */
  secret: string;
  /** Action name → sensitivity. Unknown actions default to "high" (fail closed). */
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
  /** Max sessions held in memory. Default 50 000. Swap the store for Redis in production. */
  maxSessions?: number;
  /** Hook for audit logging. */
  onDecision?: (e: { sid: string; action: string; decision: Decision; verdict: string; score: number; hits: string[] }) => void;
}

interface Session {
  sid: string;
  nonce: string;
  seq: number;
  trace: SessionTrace;
  touched: number;
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
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ───────────── input validation: never trust the client's shapes ─────────────
const num = (v: unknown, lo = -1e7, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const b01 = (v: unknown) => (v === 1 ? 1 : 0) as 0 | 1;
const bg3 = (v: unknown) => (v === 2 ? 2 : v === 1 ? 1 : 0) as 0 | 1 | 2;
const ptk = (v: unknown) => (v === 'touch' || v === 'pen' ? v : 'mouse') as 'mouse' | 'pen' | 'touch';
function arr<T>(v: unknown, map: (x: any) => T | null, cap = 4000): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v.slice(0, cap)) { const m = x && typeof x === 'object' ? map(x) : null; if (m) out.push(m); }
  return out;
}

export function sanitizeBatch(b: any): Partial<Batch> {
  const out: Partial<Batch> = {
    ptr: arr(b.ptr, (x) => { const t = num(x.t), X = num(x.x), Y = num(x.y); return t === null || X === null || Y === null ? null : { t, x: X, y: Y, c: num(x.c, 0, 1000) ?? 0, tr: b01(x.tr), pt: ptk(x.pt), ...(x.re === 1 ? { re: 1 as const } : {}) }; }),
    btn: arr(b.btn, (x) => { const t = num(x.t); return t === null ? null : { t, k: x.k === 'u' ? 'u' : 'd', tr: b01(x.tr) }; }),
    click: arr(b.click, (x) => { const t = num(x.t); return t === null ? null : { t, x: num(x.x) ?? 0, y: num(x.y) ?? 0, tr: b01(x.tr), det: num(x.det, 0, 100) ?? 0, dx: num(x.dx) ?? 0, dy: num(x.dy) ?? 0, w: num(x.w, 0) ?? 0, h: num(x.h, 0) ?? 0, pre: num(x.pre, 0) ?? 0, bg: bg3(x.bg), pt: x.pt === 'none' ? 'none' : ptk(x.pt) }; }),
    key: arr(b.key, (x) => { const t = num(x.t); if (t === null) return null; const l = num(x.l, 0, 10000); return { t, k: x.k === 'u' ? 'u' : 'd', tr: b01(x.tr), s: num(x.s) ?? -1, rep: b01(x.rep), mod: b01(x.mod), bg: bg3(x.bg), ...(l !== null ? { l } : {}) }; }),
    input: arr(b.input, (x) => { const t = num(x.t); if (t === null) return null; const src = x.src === 1 || x.src === 2 ? x.src : 0; return { t, it: typeof x.it === 'string' ? x.it.slice(0, 32) : '', tr: b01(x.tr), kd: num(x.kd, -1) ?? -1, comp: b01(x.comp), bg: bg3(x.bg), ...(src ? { src } : {}) }; }),
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

// ───────────── decision tokens ─────────────
function b64u(buf: Buffer) { return buf.toString('base64url'); }

export function signToken(secret: string, payload: Record<string, unknown>): string {
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const mac = b64u(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

/** Verify a decision token. Returns the payload, or null if forged/expired. */
export function verifyToken(secret: string, token: string): { sid: string; action: string; decision: Decision; exp: number } | null {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function createAgentDetect(opts: AgentDetectServerOptions) {
  if (!opts.secret || opts.secret.length < 16) throw new Error('agent-detect: secret must be at least 16 characters');
  const base = (opts.basePath ?? '/ad').replace(/\/$/, '');
  const policy = opts.policy ?? {};
  const ttl = opts.tokenTtl ?? 120;
  const idle = opts.sessionTtlMs ?? 30 * 60 * 1000;
  const maxSessions = opts.maxSessions ?? 50_000;
  const sessions = new Map<string, Session>();

  const gc = () => {
    const now = Date.now();
    for (const [k, s] of sessions) if (now - s.touched > idle) sessions.delete(k);
    while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value as string);
  };
  const gcTimer = setInterval(gc, 60_000);
  gcTimer.unref?.();

  function openSession(prevSid?: string): Session {
    const prev = prevSid ? sessions.get(prevSid) : undefined;
    if (prev) { prev.nonce = randomBytes(16).toString('hex'); prev.touched = Date.now(); return prev; }
    const s: Session = { sid: randomBytes(16).toString('hex'), nonce: randomBytes(16).toString('hex'), seq: 0, trace: emptyTrace(), touched: Date.now() };
    sessions.set(s.sid, s);
    return s;
  }

  function evaluate(sid: string, action: string) {
    const s = sessions.get(sid);
    const sensitivity: Sensitivity = policy[action] ?? 'high';
    if (!s) {
      return { decision: (sensitivity === 'low' ? 'allow' : 'step_up') as Decision, verdict: 'unknown', score: 0, hits: [] as any[] };
    }
    const r = scoreTrace(s.trace, opts.scoreConfig);
    return { decision: decide(r, sensitivity), verdict: r.verdict, score: r.score, hits: r.hits };
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://x');
    if (!url.pathname.startsWith(base + '/')) return false;
    const route = url.pathname.slice(base.length);
    try {
      if (req.method === 'POST' && route === '/session') {
        const body = await readJson(req);
        const s = openSession(typeof body.sid === 'string' ? body.sid : undefined);
        send(res, 200, { sid: s.sid, nonce: s.nonce, seq: s.seq });
        return true;
      }
      if (req.method === 'POST' && route === '/collect') {
        const body = await readJson(req);
        const s = sessions.get(body.sid);
        if (!s || body.nonce !== s.nonce) { send(res, 403, { error: 'bad session' }); return true; }
        const seq = num(body.seq, 0);
        if (seq === null || seq <= s.seq) { send(res, 409, { error: 'replayed or out-of-order batch' }); return true; }
        s.seq = seq;
        s.touched = Date.now();
        mergeBatch(s.trace, sanitizeBatch(body));
        send(res, 200, { ok: true });
        return true;
      }
      if (req.method === 'POST' && route === '/decide') {
        const body = await readJson(req);
        const action = typeof body.action === 'string' ? body.action.slice(0, 64) : 'unknown';
        const s = sessions.get(body.sid);
        const sidOk = !!s && body.nonce === s.nonce;
        const r = evaluate(sidOk ? body.sid : '', action);
        const token = signToken(opts.secret, { sid: sidOk ? body.sid : null, action, decision: r.decision, exp: Math.floor(Date.now() / 1000) + ttl });
        opts.onDecision?.({ sid: body.sid, action, decision: r.decision, verdict: r.verdict, score: r.score, hits: r.hits.map((h: any) => h.id) });
        const out: Record<string, unknown> = { decision: r.decision, token };
        if (opts.exposeReasons) Object.assign(out, { verdict: r.verdict, score: r.score, reasons: r.hits.map((h: any) => ({ id: h.id, evidence: h.evidence })) });
        send(res, 200, out);
        return true;
      }
      if (opts.debug && req.method === 'GET' && route.startsWith('/debug/')) {
        const s = sessions.get(route.slice('/debug/'.length));
        if (!s) { send(res, 404, { error: 'no session' }); return true; }
        const f = extractFeatures(s.trace);
        const { strokes, holds, keyIntervals, keyHolds, gapValues, ...rest } = f;
        send(res, 200, { score: scoreTrace(s.trace, opts.scoreConfig), features: { ...rest, strokes: strokes.length }, counts: Object.fromEntries(Object.entries(s.trace).filter(([k]) => k !== 'env').map(([k, v]) => [k, (v as unknown[]).length])) });
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
    verifyToken: (token: string) => verifyToken(opts.secret, token),
    /** For tests/admin: the raw trace of a session. */
    _session: (sid: string) => sessions.get(sid),
    close: () => clearInterval(gcTimer),
  };
}

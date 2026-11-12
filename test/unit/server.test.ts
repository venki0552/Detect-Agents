/**
 * Server tests over real HTTP (node:http on an ephemeral port, global fetch).
 * They pin the trust-boundary behaviour: what an attacker who controls the
 * browser can and cannot make the server do. See docs/DECISIONS.md D12–D25.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as T from './traces';
import { createAgentDetect, type AgentDetectServerOptions } from '../../src/server/index';
import { STREAM_CAPS } from '../../src/core/types';

const SECRET = 'unit-test-secret-0123456789abcdef-0123456789';
const POLICY = { view_balance: 'low', update_profile: 'medium', transfer: 'high', wire: 'critical' } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(over: Partial<AgentDetectServerOptions> = {}) {
  const ad = createAgentDetect({ secret: SECRET, policy: { ...POLICY }, ...over });
  const server = http.createServer(async (req, res) => {
    if (await ad.handle(req, res)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  };
  const open = async (headers: Record<string, string> = {}, sid = '') => (await post('/ad/session', { sid, ct: 0 }, headers)).json as { sid: string; nonce: string; seq: number };
  const close = () => { ad.close(); server.close(); };
  return { ad, url, post, open, close };
}

/** A small, honest-looking batch whose timestamps fit inside the first seconds of a session. */
function smallBatch(s: { sid: string; nonce: string }, seq: number, extra: Record<string, unknown> = {}) {
  return { sid: s.sid, nonce: s.nonce, seq, env: T.cleanEnv(), click: [{ t: 40, x: 10, y: 10, tr: 1, det: 1, dx: 3, dy: 2, w: 100, h: 40, pre: 4, bg: 0, pt: 'mouse' }], ...extra };
}

// ───────────── configuration fails closed ─────────────

test('construction rejects a short secret and an invalid policy value', () => {
  assert.throws(() => createAgentDetect({ secret: 'too-short-secret' }), /secret/);
  assert.throws(() => createAgentDetect({ secret: SECRET, policy: { transfer: 'hihg' as any } }), /policy/);
  assert.throws(() => createAgentDetect({ secret: [SECRET, 'short'] }), /secret/);
});

test('exposeReasons and debug refuse to start when NODE_ENV=production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => createAgentDetect({ secret: SECRET, exposeReasons: true }), /production/);
    assert.throws(() => createAgentDetect({ secret: SECRET, debug: true }), /production/);
    createAgentDetect({ secret: SECRET }).close();
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }
});

test('action names that collide with Object.prototype are unknown actions (high), not "allow"', async () => {
  const { post, ad, close } = await boot();
  try {
    for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      const r = await post('/ad/decide', { sid: 'nope', nonce: 'nope', action });
      assert.equal(r.json.decision, 'step_up', action);
      assert.equal(ad.evaluate('', action).decision, 'step_up', action);
    }
    // junk action names are normalised, never echoed into the token or the audit log
    const r = await post('/ad/decide', { sid: 'nope', nonce: 'nope', action: 'transfer\n{"decision":"allow"}' });
    assert.equal(ad.verifyToken(r.json.token)!.action, 'unknown');
  } finally { close(); }
});

// ───────────── silence is not a better deal than being seen ─────────────

test('a session that sent no telemetry is treated like no session: medium and high step up', async () => {
  const { post, open, close } = await boot();
  try {
    const s = await open();
    assert.equal((await post('/ad/decide', { ...s, action: 'update_profile' })).json.decision, 'step_up');
    assert.equal((await post('/ad/decide', { ...s, action: 'transfer' })).json.decision, 'step_up');
    assert.equal((await post('/ad/decide', { ...s, action: 'view_balance' })).json.decision, 'allow');
    assert.equal((await post('/ad/decide', { sid: 'x', nonce: 'y', action: 'update_profile' })).json.decision, 'step_up');
  } finally { close(); }
});

// ───────────── request hygiene ─────────────

test('requests must be JSON and same-site: no CSRF-style cross-site posts', async () => {
  const { post, close } = await boot();
  try {
    assert.equal((await post('/ad/session', { sid: '' }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('/ad/session', { sid: '' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post('/ad/session', { sid: '' }, { 'sec-fetch-site': 'same-origin' })).status, 200);
  } finally { close(); }
});

test('replayed, out-of-order and wrong-nonce batches are rejected', async () => {
  const { post, open, close } = await boot();
  try {
    const s = await open();
    assert.equal((await post('/ad/collect', smallBatch(s, 1))).status, 200);
    assert.equal((await post('/ad/collect', smallBatch(s, 1))).status, 409);
    assert.equal((await post('/ad/collect', smallBatch(s, 0))).status, 409);
    assert.equal((await post('/ad/collect', smallBatch({ sid: s.sid, nonce: 'f'.repeat(32) }, 2))).status, 403);
    assert.equal((await post('/ad/collect', { ...smallBatch(s, 2), nonce: { toString: 1 } })).status, 403);
  } finally { close(); }
});

test('the audit hook never receives attacker-shaped session ids', async () => {
  const seen: any[] = [];
  const { post, open, close } = await boot({ onDecision: (e) => seen.push(e) });
  try {
    await post('/ad/decide', { sid: { evil: 'x'.repeat(5000) }, nonce: 'n', action: 'transfer' });
    await post('/ad/decide', { sid: 'line1\nline2', nonce: 'n', action: 'transfer' });
    const s = await open();
    await post('/ad/decide', { ...s, action: 'transfer' });
    assert.equal(seen[0].sid, null);
    assert.equal(seen[1].sid, null);
    assert.equal(seen[2].sid, s.sid);
    assert.equal(seen[2].sensitivity, 'high');
  } finally { close(); }
});

test('the session cap holds at insert time and evicts the least recently used session', async () => {
  const { open, post, ad, close } = await boot({ maxSessions: 3 });
  try {
    const first = await open();
    const others = [await open(), await open()];
    await post('/ad/collect', smallBatch(first, 1));           // touch the oldest
    await open(); await open();                                 // two more → two evictions
    assert.ok(ad._session(first.sid), 'recently used session survives');
    assert.equal(others.filter((o) => ad._session(o.sid)).length, 0, 'idle sessions were evicted');
    assert.ok(ad.stats().sessions <= 3);
  } finally { close(); }
});

// ───────────── evidence cannot be shed ─────────────

test('Tier 1 evidence is sticky: flooding a stream past its cap does not launder a honeypot hit', async () => {
  const { post, open, ad, close } = await boot();
  try {
    const s = await open();
    await post('/ad/collect', smallBatch(s, 1, { dom: [{ t: 50, kind: 'canary-click' }] }));
    const noise = Array.from({ length: 400 }, (_, i) => ({ t: 60 + i, kind: 'foreign-node', tag: 'div' }));
    for (let seq = 2; seq <= 4; seq++) await post('/ad/collect', { sid: s.sid, nonce: s.nonce, seq, dom: noise });
    assert.ok(!ad._session(s.sid)!.trace.dom.some((d) => d.kind === 'canary-click'), 'fixture must evict the canary event');
    assert.equal((await post('/ad/decide', { ...s, action: 'transfer' })).json.decision, 'block');
  } finally { close(); }
});

test('a later batch cannot overwrite an automation flag in the environment snapshot', async () => {
  const { post, open, close } = await boot();
  try {
    const s = await open();
    await post('/ad/collect', smallBatch(s, 1, { env: T.cleanEnv({ webdriver: true }) }));
    await post('/ad/collect', smallBatch(s, 2, { env: T.cleanEnv() }));
    assert.equal((await post('/ad/decide', { ...s, action: 'transfer' })).json.decision, 'block');
  } finally { close(); }
});

// ───────────── the server clock bounds what the client can claim ─────────────

test('a whole forged "human" history cannot be uploaded in one go: events ahead of the server clock are dropped', async () => {
  const { post, open, ad, close } = await boot();
  try {
    const s = await open();
    const forged = T.humanSession(1);                                   // ~1 minute of perfect human behaviour
    const r = await post('/ad/collect', { sid: s.sid, nonce: s.nonce, seq: 1, ...forged });
    assert.equal(r.status, 200);
    const sess = ad._session(s.sid)!;
    assert.ok(sess.trace.click.length <= 2, `kept ${sess.trace.click.length} clicks from the future`);
    assert.ok(sess.dropped.future > 100);
    assert.equal((await post('/ad/decide', { ...s, action: 'transfer' })).json.decision, 'step_up');
  } finally { close(); }
});

test('each page load is placed on the session timeline: page 2 events do not collide with page 1 timestamps', async () => {
  const { post, open, ad, close } = await boot();
  try {
    const s1 = await open();
    await post('/ad/collect', smallBatch(s1, 1));
    await sleep(120);
    const s2 = await open({}, s1.sid);                                  // navigation: same sid, new nonce, collector clock restarts at 0
    assert.equal(s2.sid, s1.sid);
    assert.notEqual(s2.nonce, s1.nonce);
    await post('/ad/collect', smallBatch(s2, s2.seq + 1));
    const clicks = ad._session(s1.sid)!.trace.click;
    assert.equal(clicks.length, 2);
    assert.ok(clicks[1].t - clicks[0].t >= 100, `page 2 click landed at ${clicks[1].t}, page 1 at ${clicks[0].t}`);
  } finally { close(); }
});

test('ancient "pre-open" history is dropped, but the visibility state it implies is kept', async () => {
  const { post, open, ad, close } = await boot();
  try {
    const s = await open();
    await post('/ad/collect', { sid: s.sid, nonce: s.nonce, seq: 1, vis: [{ t: -600000, hid: 1 }], key: [{ t: -600000, k: 'd', tr: 1, s: 1, rep: 0, mod: 0, bg: 0 }] });
    const tr = ad._session(s.sid)!.trace;
    assert.equal(tr.key.length, 0);
    assert.equal(tr.vis.length, 1);
    assert.ok(tr.vis[0].t > -60000);
  } finally { close(); }
});

// ───────────── decision tokens ─────────────

async function humanToken(b: Awaited<ReturnType<typeof boot>>, action: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const s = await b.open(headers);
  // inject a human-looking trace directly: forging one over HTTP now needs real time (see the test above)
  Object.assign(b.ad._session(s.sid)!.trace, T.humanSession(3));
  const r = await b.post('/ad/decide', { ...s, action, ...extra }, headers);
  return { s, ...r.json } as { s: typeof s; decision: string; token: string };
}

test('authorize(): a token works once, for its own action only', async () => {
  const b = await boot();
  try {
    const { decision, token } = await humanToken(b, 'transfer');
    assert.equal(decision, 'allow');
    assert.equal(b.ad.authorize(token, { action: 'add_payee' }).ok, false, 'wrong action');
    assert.equal(b.ad.authorize(token, { action: 'transfer' }).ok, true);
    const again = b.ad.authorize(token, { action: 'transfer' });
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'replayed');
  } finally { b.close(); }
});

test('authorize(): a token is bound to the transaction it was issued for', async () => {
  const b = await boot();
  try {
    const { token } = await humanToken(b, 'transfer', { ctx: 'h:payeeA-10usd' });
    assert.equal(b.ad.verifyToken(token)!.ctx, 'h:payeeA-10usd');
    assert.equal(b.ad.authorize(token, { action: 'transfer', ctx: 'h:payeeB-9999usd' }).ok, false);
    assert.equal(b.ad.authorize(token, { action: 'transfer' }).ok, false, 'a ctx-bound token must be checked against a ctx');
    assert.equal(b.ad.authorize(token, { action: 'transfer', ctx: 'h:payeeA-10usd' }).ok, true);
    const plain = await humanToken(b, 'transfer');
    assert.equal(b.ad.authorize(plain.token, { action: 'transfer', ctx: 'h:anything' }).ok, false, 'the API asked for a binding the token does not have');
  } finally { b.close(); }
});

test('authorize(): step_up only passes with a verified step-up, block never passes, critical never issues allow', async () => {
  const b = await boot();
  try {
    const wire = await humanToken(b, 'wire');
    assert.equal(wire.decision, 'step_up', 'critical action, clean human');
    assert.equal(b.ad.authorize(wire.token, { action: 'wire' }).ok, false);
    assert.equal(b.ad.authorize(wire.token, { action: 'wire', stepUpVerified: true }).ok, true);

    const s = await b.open();
    await b.post('/ad/collect', smallBatch(s, 1, { env: T.cleanEnv({ webdriver: true }) }));
    const blocked = (await b.post('/ad/decide', { ...s, action: 'transfer' })).json;
    assert.equal(blocked.decision, 'block');
    assert.equal(b.ad.authorize(blocked.token, { action: 'transfer', stepUpVerified: true }).ok, false);
  } finally { b.close(); }
});

test('tokens: unique ids, strict format, and secret rotation', async () => {
  const b = await boot();
  let rotated: ReturnType<typeof createAgentDetect> | undefined;
  try {
    rotated = createAgentDetect({ secret: ['new-signing-secret-0123456789abcdef-0123', SECRET], policy: { ...POLICY } });
    const a = await humanToken(b, 'transfer');
    const c = await humanToken(b, 'transfer');
    const pa = b.ad.verifyToken(a.token)!, pc = b.ad.verifyToken(c.token)!;
    assert.ok(pa.jti && pc.jti && pa.jti !== pc.jti);
    assert.equal(pa.v, 1);
    assert.equal(b.ad.verifyToken(a.token + '.extra'), null);
    assert.equal(b.ad.verifyToken(a.token, { action: 'add_payee' }), null);
    assert.ok(rotated.verifyToken(a.token), 'a token signed with the previous secret still verifies during rotation');
    assert.equal(createAgentDetect({ secret: 'a-completely-different-secret-0123456789' }).verifyToken(a.token), null);
  } finally { b.close(); rotated?.close(); }
});

// ───────────── binding to the app's authenticated session ─────────────

const cookieBind = (req: http.IncomingMessage) => /(?:^|;\s*)app=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] ?? null;

test('bind: endpoints refuse callers without an app session', async () => {
  const b = await boot({ bind: cookieBind });
  try {
    assert.equal((await b.post('/ad/session', { sid: '' })).status, 401);
    assert.equal((await b.post('/ad/decide', { sid: 'x', nonce: 'y', action: 'transfer' })).status, 401);
  } finally { b.close(); }
});

test('bind: opening a "fresh" session does not launder a flagged one', async () => {
  const b = await boot({ bind: cookieBind });
  const alice = { cookie: 'app=alice-session' };
  try {
    const s1 = await b.open(alice);
    await b.post('/ad/collect', smallBatch(s1, 1, { dom: [{ t: 30, kind: 'canary-fill' }] }), alice);
    const s2 = await b.open(alice, '');                                 // attacker drops the sid and asks for a new session
    assert.equal(s2.sid, s1.sid, 'same app session → same detection session');
    assert.equal((await b.post('/ad/decide', { ...s2, action: 'transfer' }, alice)).json.decision, 'block');
    // another user's cookie cannot write into or decide on Alice's session
    assert.equal((await b.post('/ad/collect', smallBatch(s2, s2.seq + 5), { cookie: 'app=mallory' })).status, 403);
  } finally { b.close(); }
});

test('bind: a token minted in one app session is useless in another (no token relay)', async () => {
  const b = await boot({ bind: cookieBind });
  try {
    const mallory = { cookie: 'app=mallory-session' };
    const { token, decision } = await humanToken(b, 'transfer', {}, mallory);
    assert.equal(decision, 'allow');
    const p = b.ad.verifyToken(token)!;
    assert.ok(p.sub && !p.sub.includes('mallory'), 'the binding is carried as a keyed hash, never raw');
    const asAlice = { headers: { cookie: 'app=alice-session' } } as http.IncomingMessage;
    const asMallory = { headers: { cookie: 'app=mallory-session' } } as http.IncomingMessage;
    assert.equal(b.ad.authorize(token, { action: 'transfer', req: asAlice }).ok, false);
    assert.equal(b.ad.authorize(token, { action: 'transfer' }).ok, false, 'with bind configured, the API must say who is asking');
    assert.equal(b.ad.authorize(token, { action: 'transfer', req: asMallory }).ok, true);
  } finally { b.close(); }
});

test('per-session memory is bounded by the stream caps', async () => {
  const b = await boot();
  try {
    const s = await b.open();
    const scroll = Array.from({ length: 3900 }, (_, i) => ({ t: i, dy: 10, cause: 1 }));
    for (let seq = 1; seq <= 3; seq++) await b.post('/ad/collect', { sid: s.sid, nonce: s.nonce, seq, scroll });
    assert.ok(b.ad._session(s.sid)!.trace.scroll.length <= STREAM_CAPS.scroll);
  } finally { b.close(); }
});

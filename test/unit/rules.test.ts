import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from './traces';
import { scoreTrace, decide } from '../../src/core/score';
import { emptyTrace } from '../../src/core/types';
import { sanitizeBatch, signToken, verifyToken } from '../../src/server/index';

const ids = (tr: ReturnType<typeof T.humanSession>) => scoreTrace(tr).hits.map((h) => h.id);

test('humans with a mouse are not flagged (20 seeds)', () => {
  for (let s = 1; s <= 20; s++) assert.equal(scoreTrace(T.humanSession(s)).verdict, 'human', `seed ${s}`);
});

test('trackpad users (few coalesced samples) are never called agents', () => {
  for (let s = 1; s <= 20; s++) assert.notEqual(scoreTrace(T.humanSession(s, { trackpad: true })).verdict, 'agent');
});

test('keyboard-only / screen-reader users are never flagged', () => {
  for (let s = 1; s <= 20; s++) {
    const r = scoreTrace(T.keyboardOnlyUser(s));
    assert.ok(r.verdict === 'human' || r.verdict === 'unknown', `seed ${s}: ${r.verdict}`);
  }
});

test('password-manager autofill is not treated as typing without keys', () => {
  assert.ok(!ids(T.autofillUser()).includes('evt.text_without_keys'));
  assert.equal(scoreTrace(T.autofillUser()).verdict, 'human');
});

test('dictation is at most suspect (step-up on high-risk actions, never block)', () => {
  const r = scoreTrace(T.dictationUser());
  assert.notEqual(r.verdict, 'agent');
  assert.equal(decide(r, 'high'), 'step_up');
  assert.equal(decide(r, 'low'), 'allow');
});

test('xdotool screenshot loop is detected', () => {
  const r = scoreTrace(T.xdotoolAgent());
  assert.equal(r.verdict, 'agent');
  for (const id of ['mot.jump_arrival', 'tim.fixed_hold', 'tim.still_gaps', 'key.metronome']) assert.ok(ids(T.xdotoolAgent()).includes(id), id);
});

test('pyautogui linear tween + fixed typing is detected', () => {
  const r = scoreTrace(T.pyautoguiAgent());
  assert.equal(r.verdict, 'agent');
  for (const id of ['mot.no_coalesced', 'mot.ruler_straight', 'mot.constant_speed', 'key.metronome']) assert.ok(ids(T.pyautoguiAgent()).includes(id), id);
});

test('humanized agent (Bezier + uniform random delays) is caught by distribution shape', () => {
  const h = ids(T.humanizedAgent());
  assert.ok(h.includes('key.uniform_random'));
  assert.ok(h.includes('mot.no_coalesced'));
  assert.notEqual(scoreTrace(T.humanizedAgent()).verdict, 'human');
});

test('CDP DOM agent (Playwright-style) is detected', () => {
  const r = scoreTrace(T.cdpDomAgent());
  assert.equal(r.verdict, 'agent');
  assert.ok(ids(T.cdpDomAgent()).includes('mot.centred_clicks'));
});

test('untrusted events are Tier 1, but app-chained synthetic clicks are ignored', () => {
  const tr = T.humanSession(3);
  const t = tr.click[4].t;
  tr.click.push({ ...tr.click[4], t: t + 5, tr: 0 }); // app calls el.click() inside a real click handler
  assert.ok(!ids(tr).includes('evt.untrusted'));
  tr.click.push({ ...tr.click[4], t: t + 900, tr: 0 }); // nothing trusted nearby → agent
  const r = scoreTrace(tr);
  assert.ok(r.hits.some((h) => h.id === 'evt.untrusted'));
  assert.equal(r.verdict, 'agent');
  assert.equal(decide(r, 'high'), 'block');
});

test('typing into a hidden tab is Tier 1', () => {
  const tr = T.humanSession(4);
  tr.key.push({ t: 99999, k: 'd', tr: 1, s: 9999, rep: 0, mod: 0, bg: 2 });
  assert.ok(ids(tr).includes('evt.input_while_hidden'));
});

test('webdriver flag, stealth patches and canaries are Tier 1', () => {
  const a = T.humanSession(5); a.env = T.cleanEnv({ webdriver: true });
  assert.ok(ids(a).includes('env.webdriver'));
  const b = T.humanSession(5); b.env = T.cleanEnv({ webdriverOwnProperty: true });
  assert.ok(ids(b).includes('env.webdriver_patched'));
  const c = T.humanSession(5); c.dom.push({ t: 10, kind: 'canary-fill' });
  assert.ok(ids(c).includes('dom.canary'));
});

test('too little evidence is "unknown", and unknown steps up on high-risk actions', () => {
  const tr = emptyTrace();
  tr.env = T.cleanEnv();
  const r = scoreTrace(tr);
  assert.equal(r.verdict, 'unknown');
  assert.equal(decide(r, 'high'), 'step_up');
  assert.equal(decide(r, 'medium'), 'allow');
});

test('server sanitizer drops malformed and oversized fields', () => {
  const b = sanitizeBatch({
    ptr: [{ t: 1, x: 2, y: 3, c: 2, tr: 1, pt: 'mouse' }, { t: 'x' }, null, { t: Infinity, x: 1, y: 1 }],
    input: [{ t: 5, it: 'insertText'.repeat(20), tr: 1, kd: 3 }],
    dom: [{ t: 1, kind: 'evil' }, { t: 2, kind: 'canary-click' }],
    env: { webdriver: 'yes', automationGlobals: ['a', 5, 'b'] },
  });
  assert.equal(b.ptr!.length, 1);
  assert.equal(b.input![0].it.length, 32);
  assert.equal(b.dom!.length, 1);
  assert.equal(b.env!.webdriver, false);
  assert.deepEqual(b.env!.automationGlobals, ['a', 'b']);
});

test('decision tokens: valid, tampered, expired', () => {
  const secret = 'test-secret-0123456789abcdef';
  const tok = signToken(secret, { sid: 's', action: 'transfer', decision: 'allow', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(verifyToken(secret, tok)?.decision, 'allow');
  const [body, mac] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ sid: 's', action: 'transfer', decision: 'allow', exp: 9e9 })).toString('base64url');
  assert.equal(verifyToken(secret, `${forged}.${mac}`), null);
  assert.equal(verifyToken('other-secret-0123456789', tok), null);
  const old = signToken(secret, { sid: 's', action: 'transfer', decision: 'allow', exp: 1 });
  assert.equal(verifyToken(secret, old), null);
  assert.ok(body.length > 0);
});

// ───────────── v0.2: signals derived from the Chrome Modern Web Guidance guides ─────────────

test('autofill (:autofill) and one-time-code fills are not "text without keys"', () => {
  for (const src of [1, 2] as const) {
    const tr = T.humanSession(21);
    tr.key = []; tr.input = [];
    for (let i = 0; i < 6; i++) tr.input.push({ t: 5000 + i * 300, it: 'insertText', tr: 1, kd: -1, comp: 0, bg: 0, src });
    assert.ok(!ids(tr).includes('evt.text_without_keys'), `src ${src}`);
  }
});

test('IME composition input is not "text without keys"', () => {
  const tr = T.humanSession(22);
  for (let i = 0; i < 6; i++) tr.input.push({ t: 5000 + i * 300, it: 'insertText', tr: 1, kd: -1, comp: 1, bg: 0 });
  assert.ok(!ids(tr).includes('evt.text_without_keys'));
});

test('visibility timeline catches typing into a background tab even when the handler saw "visible"', () => {
  const tr = T.humanSession(23);
  const t = tr.key[0]?.t ?? 3000;
  tr.vis = [{ t: -10, hid: 0 }, { t: t - 50, hid: 1 }, { t: t + 5000, hid: 0 }];
  assert.ok(ids(tr).includes('evt.input_while_hidden'));
});

test('WebMCP-declared agent: allowed to read, must step up to act, never silently blocked', () => {
  const tr = T.humanSession(24);
  tr.dom.push({ t: 100, kind: 'webmcp-tool', tag: 'transfer-funds' });
  const r = scoreTrace(tr);
  assert.equal(r.verdict, 'agent');
  assert.equal(r.declared, true);
  assert.equal(decide(r, 'low'), 'allow');
  assert.equal(decide(r, 'high'), 'step_up');
  tr.env = T.cleanEnv({ webdriver: true }); // declared AND automation flag → not cooperative any more
  const r2 = scoreTrace(tr);
  assert.equal(r2.declared, false);
  assert.equal(decide(r2, 'high'), 'block');
});

test('Trusted Types sink reports: DevTools-Protocol/extension injections count, the page\'s own do not', () => {
  const a = T.humanSession(25); a.dom.push({ t: 10, kind: 'script-sink', by: 'none' });
  assert.ok(ids(a).includes('dom.injected_html'));
  const b = T.humanSession(25); b.dom.push({ t: 10, kind: 'script-sink', by: 'extension' });
  assert.ok(ids(b).includes('dom.injected_html'));
  const c = T.humanSession(25); c.dom.push({ t: 10, kind: 'script-sink', by: 'page' });
  assert.ok(!ids(c).includes('dom.injected_html'));
});

test('experimental delivery-latency rule is off unless enabled', () => {
  const tr = T.humanSession(26);
  for (const k of tr.key) if (k.k === 'd') k.l = 0.3;
  assert.ok(!scoreTrace(tr).hits.some((h) => h.id === 'key.instant_delivery'));
  assert.ok(scoreTrace(tr, { experimental: ['key.instant_delivery'] }).hits.some((h) => h.id === 'key.instant_delivery'));
});

/**
 * Soundness tests: each one pins a logic gap found in the 2026-11-12 review
 * (docs/DECISIONS.md D12–D25). They are about the *reasoning* of the scorer —
 * what it may conclude from what it actually saw — not about thresholds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from './traces';
import { scoreTrace, decide } from '../../src/core/score';
import { extractFeatures } from '../../src/core/features';
import { emptyTrace, mergeBatch, mergeEnv, STREAM_CAPS } from '../../src/core/types';
import type { SessionTrace } from '../../src/core/types';
import { sanitizeBatch } from '../../src/server/index';

const ids = (tr: SessionTrace, cfg = {}) => scoreTrace(tr, cfg).hits.map((h) => h.id);

/** Append `src` to `dst`, shifted to start `gap` ms after dst's last click. */
function append(dst: SessionTrace, src: SessionTrace, gap = 2000): SessionTrace {
  const end = Math.max(...dst.click.map((c) => c.t), ...dst.key.map((k) => k.t));
  for (const k of ['ptr', 'btn', 'click', 'key', 'input', 'scroll'] as const) {
    for (const e of src[k]) (dst[k] as any[]).push({ ...e, t: e.t + end + gap, ...(k === 'key' ? { s: (e as any).s + 1e6 } : {}) });
  }
  return dst;
}

/** A blatantly robotic but short session: 2 teleport clicks (0 ms hold, dead centre) + 17 keys at 12 ms. */
function shortRobot(): SessionTrace {
  const tr = emptyTrace();
  tr.env = T.cleanEnv();
  let t = 1000;
  for (let i = 0; i < 2; i++) {
    t += 3000;
    tr.ptr.push({ t, x: 300 + i * 400, y: 300, c: 1, tr: 1, pt: 'mouse' });
    tr.btn.push({ t: t + 1, k: 'd', tr: 1 }, { t: t + 1.2, k: 'u', tr: 1 });
    tr.click.push({ t: t + 1.3, x: 300 + i * 400, y: 300, tr: 1, det: 1, dx: 0, dy: 0, w: 140, h: 40, pre: 1, bg: 0, pt: 'mouse' });
  }
  for (let i = 0; i < 17; i++) {
    t += 12;
    tr.key.push({ t, k: 'd', tr: 1, s: i + 1, rep: 0, mod: 0, bg: 0 }, { t: t + 0.4, k: 'u', tr: 1, s: i + 1, rep: 0, mod: 0, bg: 0 });
    tr.input.push({ t: t + 0.2, it: 'insertText', tr: 1, kd: 0, comp: 0, bg: 0 });
  }
  return tr;
}

// ───────────── eviction must not manufacture evidence ─────────────

test('long human session: evicted pointer history does not turn old clicks into teleports or frozen-pointer gaps', () => {
  for (const trackpad of [false, true]) {
    const full = T.humanSession(7, { actions: 300, trackpad });
    assert.ok(full.ptr.length > STREAM_CAPS.ptr * 2, 'fixture must overflow the pointer stream');
    const capped = mergeBatch(emptyTrace(), full);
    const r = scoreTrace(capped);
    assert.ok(!r.hits.some((h) => h.id === 'mot.jump_arrival'), 'jump_arrival fired on evicted history');
    assert.ok(!r.hits.some((h) => h.id === 'tim.still_gaps'), 'still_gaps fired on evicted history');
    assert.equal(r.verdict, 'human', `trackpad=${trackpad}`);
  }
});

test('an app-chained synthetic click is not convicted after the trusted key that chained it was evicted', () => {
  const tr = T.humanSession(31);
  const batch = emptyTrace();
  batch.key.push({ t: 100000, k: 'd', tr: 1, s: 7000001, rep: 0, mod: 1, bg: 0 });           // Enter
  batch.click.push({ ...tr.click[0], t: 100004, tr: 0, det: 0 });                            // app calls el.click() in the handler
  mergeBatch(tr, batch);
  assert.ok(!ids(tr).includes('evt.untrusted'), 'precondition: chained click is ignored');
  // a long typing run pushes the Enter keydown out of the key stream
  const flood = emptyTrace();
  for (let i = 0; i < STREAM_CAPS.key + 200; i++) flood.key.push({ t: 200000 + i * 150, k: i % 2 ? 'u' : 'd', tr: 1, s: 8000000 + (i >> 1), rep: 0, mod: 0, bg: 0 });
  mergeBatch(tr, flood);
  assert.ok(!tr.key.some((k) => k.s === 7000001), 'fixture must evict the chaining keydown');
  assert.ok(!ids(tr).includes('evt.untrusted'), 'eviction turned a chained click into Tier 1 evidence');
});

test('environment flags are monotonic: a later "clean" snapshot cannot erase an automation flag', () => {
  const dirty = T.cleanEnv({ webdriver: true, automationGlobals: ['__pwInitScripts'] });
  const merged = mergeEnv(dirty, T.cleanEnv());
  assert.equal(merged.webdriver, true);
  assert.deepEqual(merged.automationGlobals, ['__pwInitScripts']);
  const tr = emptyTrace();
  mergeBatch(tr, { env: dirty });
  mergeBatch(tr, { env: T.cleanEnv() });
  assert.equal(tr.env!.webdriver, true);
});

// ───────────── "human" needs evidence that rules could actually test ─────────────

test('a short robotic session is "unknown", not "human": no rule had enough samples to clear it', () => {
  const r = scoreTrace(shortRobot());
  assert.equal(r.verdict, 'unknown');
  assert.equal(decide(r, 'high'), 'step_up');
});

test('no environment snapshot means never "human" (the env checks were never reported)', () => {
  const tr = T.humanSession(32);
  delete tr.env;
  const r = scoreTrace(tr);
  assert.equal(r.verdict, 'unknown');
  assert.equal(decide(r, 'high'), 'step_up');
});

test('pointer movement alone is not evidence of a human', () => {
  const tr = emptyTrace();
  tr.env = T.cleanEnv();
  for (let i = 0; i < 400; i++) tr.ptr.push({ t: i * 16, x: 100 + i, y: 100 + Math.sin(i / 9) * 40, c: 3, tr: 1, pt: 'mouse' });
  assert.equal(scoreTrace(tr).verdict, 'unknown');
});

// ───────────── dilution: a clean history must not launder a robotic tail ─────────────

test('takeover: a long human session followed by a robotic agent is not "human"', () => {
  const tr = append(T.humanSession(9, { actions: 40 }), T.xdotoolAgent(5));
  const r = scoreTrace(tr);
  assert.notEqual(r.verdict, 'human');
  assert.equal(r.scope, 'recent');
  assert.equal(decide(r, 'high'), 'step_up');
});

test('the recent-window pass never downgrades a session and leaves an all-human session alone', () => {
  for (let s = 40; s < 60; s++) {
    const r = scoreTrace(T.humanSession(s, { actions: 40 }));
    assert.equal(r.verdict, 'human', `seed ${s}`);
    assert.equal(r.scope, 'session');
  }
  const bot = append(T.xdotoolAgent(6), T.humanSession(61, { actions: 3 }));
  assert.equal(scoreTrace(bot).verdict, 'agent');
});

test('the recent-window pass can be turned off', () => {
  const tr = append(T.humanSession(9, { actions: 40 }), T.xdotoolAgent(5));
  assert.equal(scoreTrace(tr, { tailActions: 0 }).scope, 'session');
});

// ───────────── accessibility / false positives ─────────────

test('touch taps: the compatibility mousedown/mouseup pair (~0 ms hold) does not fire tim.fixed_hold', () => {
  const tr = emptyTrace();
  tr.env = T.cleanEnv({ pointerFine: false, touchPoints: 5 });
  for (let i = 0; i < 12; i++) {
    const t = 1000 + i * 1500;
    tr.btn.push({ t, k: 'd', tr: 1, pt: 'touch' }, { t: t + 0.6, k: 'u', tr: 1, pt: 'touch' });
    tr.click.push({ t: t + 1, x: 100, y: 200, tr: 1, det: 1, dx: 4, dy: -3, w: 140, h: 44, pre: 0, bg: 0, pt: 'touch' });
  }
  assert.ok(!ids(tr).includes('tim.fixed_hold'));
  // the same press pattern from a mouse is still caught
  for (const b of tr.btn) delete b.pt;
  assert.ok(ids(tr).includes('tim.fixed_hold'));
});

test('password-manager extension fills (script events on credential fields) are not Tier 1', () => {
  const tr = T.humanSession(33);
  const t = tr.click[1].t + 4000;
  // Bitwarden-style fill: click(), key events and input events dispatched by a content script
  tr.click.push({ ...tr.click[1], t, tr: 0, det: 0, af: 1 });
  tr.key.push({ t: t + 1, k: 'd', tr: 0, s: -1, rep: 0, mod: 0, bg: 0, af: 1 }, { t: t + 2, k: 'u', tr: 0, s: -1, rep: 0, mod: 0, bg: 0, af: 1 });
  tr.input.push({ t: t + 3, it: '', tr: 0, kd: -1, comp: 0, bg: 0, af: 1 });
  const r = scoreTrace(tr);
  assert.ok(!r.hits.some((h) => h.id === 'evt.untrusted'));
  assert.equal(r.verdict, 'human');
  assert.equal(extractFeatures(tr).untrustedAutofill, 4);
  // the same script fill on an ordinary field (amount, payee) is still Tier 1
  tr.input.push({ t: t + 9000, it: 'insertText', tr: 0, kd: -1, comp: 0, bg: 0 });
  assert.ok(ids(tr).includes('evt.untrusted'));
});

test('the browser visibility timeline overrides a handler-time "hidden" flag (no Tier 1 from a dispatch race)', () => {
  const tr = T.humanSession(34);
  const k = tr.key.find((x) => x.k === 'd')!;
  tr.vis = [{ t: -20, hid: 0 }];          // the browser says: visible the whole time
  k.bg = 2;                               // the handler ran after the tab was hidden
  assert.ok(!ids(tr).includes('evt.input_while_hidden'));
  tr.vis = [];                            // no timeline (non-Chromium): the handler flag is all we have
  assert.ok(ids(tr).includes('evt.input_while_hidden'));
});

test('masked clicks (PIN pads) carry no geometry and are not scored as dead-centre or teleport clicks', () => {
  const tr = T.humanSession(35);
  const before = extractFeatures(tr).mouseClicks;
  const t0 = Math.max(...tr.click.map((c) => c.t)) + 3000;
  for (let i = 0; i < 8; i++) tr.click.push({ t: t0 + i * 900, x: 0, y: 0, tr: 1, det: 1, dx: 0, dy: 0, w: 0, h: 0, pre: 0, bg: 0, pt: 'mouse', mk: 1 });
  const h = ids(tr, { tailActions: 0 });
  assert.ok(!h.includes('mot.centred_clicks'));
  assert.ok(!h.includes('mot.jump_arrival'));
  assert.equal(extractFeatures(tr).mouseClicks, before, 'masked clicks are not pointer evidence');
  assert.equal(extractFeatures(tr).interactions, extractFeatures(T.humanSession(35)).interactions + 8, 'but they are still interactions');
  assert.equal(scoreTrace(tr).verdict, 'human');
});

// ───────────── decision policy fails closed ─────────────

test('decide(): an unrecognised sensitivity is treated as high, never as "allow"', () => {
  const unknown = scoreTrace(Object.assign(emptyTrace(), { env: T.cleanEnv() }));
  const suspect = scoreTrace(T.dictationUser());
  assert.equal(suspect.verdict, 'suspect');
  for (const bogus of ['hihg', '', undefined, (() => 0), {}]) {
    assert.equal(decide(unknown, bogus as any), 'step_up');
    assert.equal(decide(suspect, bogus as any), 'step_up');
  }
});

test('"critical" actions always need the human: even a clean "human" verdict steps up', () => {
  const human = scoreTrace(T.humanSession(36));
  assert.equal(human.verdict, 'human');
  assert.equal(decide(human, 'high'), 'allow');
  assert.equal(decide(human, 'critical'), 'step_up');
  const hard = scoreTrace(Object.assign(T.humanSession(36), { env: T.cleanEnv({ webdriver: true }) }));
  assert.equal(decide(hard, 'critical'), 'block');
});

test('a negative or oversized weight override cannot lower the score below the other hits', () => {
  const tr = T.xdotoolAgent();
  const base = scoreTrace(tr).score;
  assert.ok(scoreTrace(tr, { weights: { 'tim.fixed_hold': -500 } }).score <= base);
  assert.ok(scoreTrace(tr, { weights: { 'tim.fixed_hold': -500 } }).score >= scoreTrace(tr, { disabled: ['tim.fixed_hold'] }).score);
});

// ───────────── cost: scoring is attacker-triggered, so it must stay near-linear ─────────────

test('feature extraction stays fast on an adversarial trace at the stream caps', () => {
  const tr = emptyTrace();
  tr.env = T.cleanEnv();
  for (let i = 0; i < STREAM_CAPS.btn; i++) tr.btn.push({ t: i, k: 'd', tr: 1 });                       // presses that never release
  for (let i = 0; i < STREAM_CAPS.key; i++) tr.key.push({ t: i, k: i % 2 ? 'u' : 'd', tr: 1, s: i % 2 ? -5 : i, rep: 0, mod: 0, bg: 0 });
  for (let i = 0; i < STREAM_CAPS.input; i++) tr.input.push({ t: i, it: 'insertText', tr: 1, kd: 1, comp: 0, bg: 0 });
  for (let i = 0; i < STREAM_CAPS.click; i++) tr.click.push({ t: i, x: 1, y: 1, tr: 1, det: 1, dx: 9, dy: 9, w: 50, h: 50, pre: 0, bg: 0, pt: 'mouse' });
  for (let i = 0; i < STREAM_CAPS.ptr; i++) tr.ptr.push({ t: 1e6 + i, x: i, y: i, c: 1, tr: 1, pt: 'mouse' });     // every move is after every click
  for (let i = 0; i < STREAM_CAPS.vis; i++) tr.vis.push({ t: i, hid: (i % 2) as 0 | 1 });
  extractFeatures(tr); // warm up
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) extractFeatures(tr);
  const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 25, `extractFeatures took ${ms.toFixed(1)} ms on an adversarial trace`);
});

// ───────────── sanitizer covers every new field ─────────────

test('sanitizer: new fields are whitelisted and clamped', () => {
  const b = sanitizeBatch({
    btn: [{ t: 1, k: 'd', tr: 1, pt: 'touch' }, { t: 2, k: 'u', tr: 1, pt: 'laser' }, { t: 3, k: 'd', tr: 1 }],
    click: [
      { t: 1, x: 5, y: 5, tr: 1, det: 1, dx: 1, dy: 1, w: 10, h: 10, pre: 0, bg: 0, pt: 'mouse', mk: 1, af: 1 },
      { t: 2, x: 5, y: 5, tr: 0, det: 0, dx: 1, dy: 1, w: 10, h: 10, pre: 0, bg: 0, pt: 'mouse', af: 1 },
    ],
    key: [{ t: 1, k: 'd', tr: 1, s: 1, rep: 0, mod: 0, bg: 0, af: 1 }, { t: 2, k: 'd', tr: 0, s: 1, rep: 0, mod: 0, bg: 0, af: 'yes' }, { t: 3, k: 'd', tr: 0, s: 1, af: 1 }],
    input: [{ t: 1, it: 'insertText', tr: 0, kd: -1, af: 1 }, { t: 2, it: 'insertText', tr: 1, kd: -1, af: 1 }],
  });
  assert.equal(b.btn![0].pt, 'touch');
  assert.equal(b.btn![1].pt, undefined, 'unknown pointer type is dropped (treated as mouse)');
  assert.equal(b.btn![2].pt, undefined);
  // a masked click keeps no geometry even if the client sent some
  assert.deepEqual({ x: b.click![0].x, y: b.click![0].y, dx: b.click![0].dx, w: b.click![0].w, mk: b.click![0].mk }, { x: 0, y: 0, dx: 0, w: 0, mk: 1 });
  // `af` only means something on untrusted events
  assert.equal(b.click![0].af, undefined);
  assert.equal(b.click![1].af, 1);
  assert.equal(b.key![0].af, undefined);
  assert.equal(b.key![1].af, undefined);
  assert.equal(b.key![2].af, 1);
  assert.equal(b.input![0].af, 1);
  assert.equal(b.input![1].af, undefined);
});

// ───────────── one robotic action after a human did everything else (D33) ─────────────
// Measured 2026-11-12 in real Chrome: a person filled the transfer form, then asked Claude in Chrome
// to click "Review & send". That one click: a single pointer move 1 ms before the press, a 1 ms hold.
// Every other rule needs 3–5 samples, so the session was `human` and the transfer went through.

const TP = { experimental: ['mot.teleport_press'] };

/** Append one click to a trace: `travel` pointer moves leading to it (0 = the pointer just appears there), held `hold` ms. */
function addClick(tr: SessionTrace, at: number, x: number, y: number, hold: number, travel: number, opts: { re?: boolean; pt?: 'touch' } = {}) {
  const last = [...tr.ptr].sort((a, b) => a.t - b.t).pop() ?? { x: 0, y: 0 };
  if (opts.pt !== 'touch') {
    if (travel === 0) tr.ptr.push({ t: at - 1, x, y, c: 1, tr: 1, pt: 'mouse', ...(opts.re ? { re: 1 as const } : {}) });
    for (let i = 1; i <= travel; i++) tr.ptr.push({ t: at - (travel - i) * 16 - 20, x: last.x + ((x - last.x) * i) / travel, y: last.y + ((y - last.y) * i) / travel, c: 1, tr: 1, pt: 'mouse' });
  }
  tr.btn.push({ t: at, k: 'd', tr: 1, ...(opts.pt ? { pt: opts.pt } : {}) }, { t: at + hold, k: 'u', tr: 1, ...(opts.pt ? { pt: opts.pt } : {}) });
  tr.click.push({ t: at + hold, x, y, tr: 1, det: 1, dx: 0.3, dy: 0.3, w: 136, h: 43, pre: travel || 1, bg: 0, pt: opts.pt ?? 'mouse' });
  return tr;
}
const endOf = (tr: SessionTrace) => Math.max(...tr.click.map((c) => c.t), ...tr.key.map((k) => k.t));

test('one teleport-press click at the end of a human session is caught (experimental mot.teleport_press)', () => {
  const tr = T.humanSession(41);
  const end = endOf(tr);
  tr.ptr.push({ t: end + 500, x: 1652, y: 1, c: 1, tr: 1, pt: 'mouse' });                // the person's mouse leaves the page for the agent's side panel…
  addClick(tr, end + 40000, 900, 120, 1, 0, { re: true });                                // …40 s later the pointer "re-enters" exactly on the button and clicks in 1 ms
  const r = scoreTrace(tr, TP);
  assert.ok(r.hits.some((h) => h.id === 'mot.teleport_press'), 'rule fired');
  assert.equal(r.verdict, 'suspect');
  assert.equal(decide(r, 'high'), 'step_up');
  assert.equal(decide(r, 'low'), 'allow');
  // experimental: off unless enabled, like every uncalibrated rule
  assert.equal(scoreTrace(tr).verdict, 'human');
});

test('mot.teleport_press needs BOTH halves: no travel and no hold, on the same click', () => {
  const base = () => T.humanSession(42);
  const fired = (tr: SessionTrace) => scoreTrace(tr, TP).hits.some((h) => h.id === 'mot.teleport_press');
  let tr = base();
  assert.ok(!fired(addClick(tr, endOf(tr) + 5000, 300, 300, 1.5, 25)), 'a 1.5 ms hold after real pointer travel (tap-to-click, dwell tools) does not fire');
  tr = base();
  assert.ok(!fired(addClick(tr, endOf(tr) + 5000, 900, 200, 95, 0)), 'a jump followed by a normal hold (clicking back into the window) does not fire');
  tr = base();
  assert.ok(!fired(addClick(tr, endOf(tr) + 5000, 900, 200, 95, 0, { re: true })), 'a pointer re-entering the page on the target, with a normal hold, does not fire');
  tr = base();
  assert.ok(fired(addClick(tr, endOf(tr) + 5000, 900, 200, 1, 0)), 'control: the same click with neither travel nor hold does fire');
  tr = base();
  const t0 = endOf(tr) + 5000;
  addClick(tr, t0, 500, 500, 90, 20); addClick(tr, t0 + 600, 500, 500, 2, 0); tr.ptr.pop();   // second click on the same spot, pointer never moved
  assert.ok(!fired(tr), 'a repeat click without moving (switch bounce, double submit) does not fire');
  tr = base();
  assert.ok(!fired(addClick(tr, endOf(tr) + 5000, 200, 300, 0, 0, { pt: 'touch' })), 'a touch tap does not fire');
});

test('mot.teleport_press does not fire on any human or accessibility profile, and does on the click agents', () => {
  const fired = (tr: SessionTrace) => scoreTrace(tr, TP).hits.some((h) => h.id === 'mot.teleport_press');
  for (let s = 1; s <= 40; s++) {
    assert.ok(!fired(T.humanSession(s)), `human ${s}`);
    assert.ok(!fired(T.humanSession(s, { trackpad: true })), `trackpad ${s}`);
    assert.ok(!fired(T.keyboardOnlyUser(s)), `keyboard-only ${s}`);
    assert.ok(!fired(T.autofillUser(s)), `autofill ${s}`);
    assert.ok(!fired(T.dictationUser(s)), `dictation ${s}`);
  }
  const ime = T.humanSession(22);
  for (let i = 0; i < 6; i++) ime.input.push({ t: 5000 + i * 300, it: 'insertText', tr: 1, kd: -1, comp: 1, bg: 0 });
  assert.ok(!fired(ime), 'IME');
  assert.ok(!fired(mergeBatch(emptyTrace(), T.humanSession(7, { actions: 300 }))), 'long session after eviction');
  assert.ok(fired(T.xdotoolAgent()), 'xdotool-style agent');
  assert.ok(fired(T.cdpDomAgent()), 'DevTools-Protocol DOM agent');
  assert.ok(!fired(T.humanizedAgent()), 'a humanized agent travels and holds: this rule is not for it');
});

test('a script acting inside a masked region is counted by evt.untrusted through its marker (D35)', () => {
  const tr = T.humanSession(44);
  assert.ok(!ids(tr).includes('evt.untrusted'));
  tr.dom.push({ t: 9000, kind: 'script-in-mask' });
  const r = scoreTrace(tr);
  assert.ok(r.hits.some((h) => h.id === 'evt.untrusted'));
  assert.equal(extractFeatures(tr).untrustedMasked, 1);
  assert.equal(sanitizeBatch({ dom: [{ t: 1, kind: 'script-in-mask', tag: 'x', by: 'page' }] }).dom!.length, 1);
});

/**
 * Synthetic session generators for unit tests.
 *
 * The "human" generator models published motor-control regularities
 * (minimum-jerk strokes, Fitts-like durations, tremor, overshoot, log-normal
 * timing, coalesced hardware samples). It is a stand-in so the rules can be
 * unit-tested — NOT a substitute for calibrating on real human sessions.
 */
import type { EnvSnapshot, SessionTrace, PtrEv } from '../../src/core/types';
import { emptyTrace } from '../../src/core/types';

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (m = 0, s = 1) => {
    const u = Math.max(1e-9, next()), v = next();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const lognormal = (median: number, sigma: number) => median * Math.exp(normal(0, sigma));
  const uniform = (lo: number, hi: number) => lo + (hi - lo) * next();
  const int = (lo: number, hi: number) => Math.floor(uniform(lo, hi + 1));
  return { next, normal, lognormal, uniform, int };
}
type R = ReturnType<typeof rng>;

export const cleanEnv = (over: Partial<EnvSnapshot> = {}): EnvSnapshot => ({
  webdriver: false, webdriverIframeMismatch: false, webdriverOwnProperty: false, headlessUA: false,
  automationGlobals: [], nativeTampered: [], cdpRuntime: false,
  renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', softwareRenderer: false,
  screenW: 1512, screenH: 982, platform: 'macOS', pointerFine: true, touchPoints: 0, languages: 2,
  ...over,
});

const minJerk = (u: number) => 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;

interface Cursor { t: number; x: number; y: number }

/** A human-like stroke: minimum-jerk speed, curved path, tremor, optional overshoot. */
function humanStroke(tr: SessionTrace, r: R, cur: Cursor, tx: number, ty: number, coalesced: () => number) {
  const go = (fx: number, fy: number, toX: number, toY: number, t0: number) => {
    const d = Math.hypot(toX - fx, toY - fy);
    const dur = 250 + 110 * Math.log2(d / 15 + 1) + r.normal(0, 40);
    const curv = (r.next() < 0.5 ? -1 : 1) * r.uniform(0.04, 0.14) * d;
    const nx = -(toY - fy) / (d || 1), ny = (toX - fx) / (d || 1);
    let t = t0;
    while (t < t0 + dur) {
      t += r.uniform(14, 18);
      const u = Math.min(1, (t - t0) / dur);
      const s = minJerk(u);
      const off = Math.sin(Math.PI * s) * curv;
      tr.ptr.push({
        t, x: fx + (toX - fx) * s + nx * off + r.normal(0, 0.7),
        y: fy + (toY - fy) * s + ny * off + r.normal(0, 0.7), c: coalesced(), tr: 1, pt: 'mouse',
      });
    }
    return t;
  };
  let t = cur.t;
  if (r.next() < 0.3) {
    const k = 1 + r.uniform(0.03, 0.08);
    const ox = cur.x + (tx - cur.x) * k, oy = cur.y + (ty - cur.y) * k;
    t = go(cur.x, cur.y, ox, oy, t);
    t = go(ox, oy, tx, ty, t + r.uniform(30, 90));
  } else {
    t = go(cur.x, cur.y, tx, ty, t);
  }
  cur.t = t; cur.x = tx; cur.y = ty;
}

function microMoves(tr: SessionTrace, r: R, cur: Cursor, ms: number, coalesced: () => number) {
  const end = cur.t + ms;
  let t = cur.t;
  while (t < end) {
    t += r.lognormal(120, 0.9);
    if (t >= end) break;
    if (r.next() < 0.6) {
      cur.x += r.normal(0, 1.5); cur.y += r.normal(0, 1.5);
      tr.ptr.push({ t, x: cur.x, y: cur.y, c: coalesced(), tr: 1, pt: 'mouse' });
    }
  }
  cur.t = end;
}

let slot = 0;
function typeHuman(tr: SessionTrace, r: R, t0: number, n: number): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    const space = i > 0 && i % r.int(4, 7) === 0;
    t += space ? r.lognormal(260, 0.5) : r.lognormal(150, 0.45);
    const hold = r.lognormal(90, 0.3);
    const s = ++slot;
    tr.key.push({ t, k: 'd', tr: 1, s, rep: 0, mod: 0, bg: 0 });
    tr.input.push({ t: t + 2, it: 'insertText', tr: 1, kd: 2, comp: 0, bg: 0 });
    tr.key.push({ t: t + hold, k: 'u', tr: 1, s, rep: 0, mod: 0, bg: 0 });
  }
  tr.key.sort((a, b) => a.t - b.t);
  return t + 200;
}

function click(tr: SessionTrace, cur: Cursor, hold: number, dx: number, dy: number, w = 140, h = 40) {
  tr.btn.push({ t: cur.t, k: 'd', tr: 1 });
  tr.btn.push({ t: cur.t + hold, k: 'u', tr: 1 });
  cur.t += hold;
  const pre = tr.ptr.filter((p) => p.t > cur.t - 500 && p.t <= cur.t).length;
  tr.click.push({ t: cur.t, x: cur.x, y: cur.y, tr: 1, det: 1, dx, dy, w, h, pre, bg: 0, pt: 'mouse' });
}

const targets = (r: R) => ({ x: r.uniform(80, 1300), y: r.uniform(80, 850) });

/** Human with a mouse. `trackpad` makes coalesced counts mostly 1. */
export function humanSession(seed = 1, opts: { trackpad?: boolean; actions?: number } = {}): SessionTrace {
  const r = rng(seed);
  const tr = emptyTrace();
  tr.env = cleanEnv();
  const coalesced = opts.trackpad ? () => (r.next() < 0.05 ? 2 : 1) : () => r.int(2, 8);
  const cur: Cursor = { t: 100, x: 600, y: 400 };
  const actions = opts.actions ?? 14;
  for (let a = 0; a < actions; a++) {
    microMoves(tr, r, cur, r.lognormal(1800, 0.7), coalesced);
    const tg = targets(r);
    humanStroke(tr, r, cur, tg.x, tg.y, coalesced);
    cur.t += r.lognormal(120, 0.5);
    click(tr, cur, r.lognormal(95, 0.3), r.normal(0, 18), r.normal(0, 6));
    if (r.next() < 0.45) cur.t = typeHuman(tr, r, cur.t, r.int(8, 22));
    if (r.next() < 0.3) {
      for (let k = 0; k < 6; k++) { cur.t += r.uniform(20, 60); tr.scroll.push({ t: cur.t, dy: 100, cause: 1 }); }
    }
  }
  return tr;
}

/** Screenshot loop driving xdotool: frozen pointer, teleport, instant clicks, 12 ms typing. */
export function xdotoolAgent(seed = 2): SessionTrace {
  const r = rng(seed);
  const tr = emptyTrace();
  tr.env = cleanEnv({ renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)', softwareRenderer: true, screenW: 1024, screenH: 768, platform: 'Linux x86_64' });
  const cur: Cursor = { t: 100, x: 512, y: 384 };
  for (let a = 0; a < 12; a++) {
    cur.t += r.uniform(3000, 6000); // model latency, pointer frozen
    const tg = targets(r);
    cur.x = tg.x; cur.y = tg.y;
    tr.ptr.push({ t: cur.t, x: cur.x, y: cur.y, c: 1, tr: 1, pt: 'mouse' });
    cur.t += 1;
    click(tr, cur, r.uniform(0, 1.5), r.normal(0, 3), r.normal(0, 2));
    if (a % 3 === 0) {
      let t = cur.t + 50;
      for (let i = 0; i < 18; i++) {
        const s = ++slot;
        tr.key.push({ t, k: 'd', tr: 1, s, rep: 0, mod: 0, bg: 0 });
        tr.input.push({ t: t + 0.3, it: 'insertText', tr: 1, kd: 0, comp: 0, bg: 0 });
        tr.key.push({ t: t + 0.4, k: 'u', tr: 1, s, rep: 0, mod: 0, bg: 0 });
        t += 12 + r.uniform(0, 0.4);
      }
      cur.t = t;
    }
  }
  return tr;
}

/** pyautogui-style: linear tween moves, fixed-interval typing. */
export function pyautoguiAgent(seed = 3): SessionTrace {
  const r = rng(seed);
  const tr = emptyTrace();
  tr.env = cleanEnv();
  const cur: Cursor = { t: 100, x: 500, y: 400 };
  for (let a = 0; a < 12; a++) {
    cur.t += r.uniform(2500, 5000);
    const tg = targets(r);
    const steps = 25;
    const fx = cur.x, fy = cur.y;
    for (let i = 1; i <= steps; i++) {
      cur.t += 20;
      tr.ptr.push({ t: cur.t, x: fx + ((tg.x - fx) * i) / steps, y: fy + ((tg.y - fy) * i) / steps, c: 1, tr: 1, pt: 'mouse' });
    }
    cur.x = tg.x; cur.y = tg.y;
    click(tr, cur, r.uniform(0.5, 2), r.normal(0, 4), r.normal(0, 3));
    if (a % 2 === 0) {
      let t = cur.t + 100;
      for (let i = 0; i < 15; i++) {
        const s = ++slot;
        tr.key.push({ t, k: 'd', tr: 1, s, rep: 0, mod: 0, bg: 0 });
        tr.input.push({ t: t + 0.5, it: 'insertText', tr: 1, kd: 0, comp: 0, bg: 0 });
        tr.key.push({ t: t + 1, k: 'u', tr: 1, s, rep: 0, mod: 0, bg: 0 });
        t += 50;
      }
      cur.t = t;
    }
  }
  return tr;
}

/** "Humanized" agent: Bezier paths, eased timing, off-centre clicks, uniform random delays. */
export function humanizedAgent(seed = 4): SessionTrace {
  const r = rng(seed);
  const tr = emptyTrace();
  tr.env = cleanEnv();
  const cur: Cursor = { t: 100, x: 500, y: 400 };
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
  for (let a = 0; a < 14; a++) {
    cur.t += r.uniform(2500, 7000);
    const tg = targets(r);
    const p0 = { x: cur.x, y: cur.y }, p3 = tg;
    const p1 = { x: p0.x + r.uniform(-150, 150), y: p0.y + r.uniform(-150, 150) };
    const p2 = { x: p3.x + r.uniform(-150, 150), y: p3.y + r.uniform(-150, 150) };
    const dur = r.uniform(400, 900);
    const t0 = cur.t;
    for (let t = t0 + 16; t <= t0 + dur; t += 16) {
      const u = ease((t - t0) / dur), v = 1 - u;
      const x = v ** 3 * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u ** 3 * p3.x;
      const y = v ** 3 * p0.y + 3 * v * v * u * p1.y + 3 * v * u * u * p2.y + u ** 3 * p3.y;
      tr.ptr.push({ t, x, y, c: 1, tr: 1, pt: 'mouse' });
    }
    cur.t = t0 + dur; cur.x = tg.x; cur.y = tg.y;
    click(tr, cur, r.uniform(60, 140), r.uniform(-30, 30), r.uniform(-8, 8));
    if (a % 2 === 0) {
      let t = cur.t + r.uniform(200, 600);
      for (let i = 0; i < 16; i++) {
        const s = ++slot;
        const hold = r.uniform(50, 120);
        tr.key.push({ t, k: 'd', tr: 1, s, rep: 0, mod: 0, bg: 0 });
        tr.input.push({ t: t + 1, it: 'insertText', tr: 1, kd: 1, comp: 0, bg: 0 });
        tr.key.push({ t: t + hold, k: 'u', tr: 1, s, rep: 0, mod: 0, bg: 0 });
        t += r.uniform(80, 220);
      }
      tr.key.sort((x, y) => x.t - y.t);
      cur.t = t;
    }
  }
  return tr;
}

/** Keyboard-only / screen-reader user: no pointer, clicks via Enter (detail 0). */
export function keyboardOnlyUser(seed = 5): SessionTrace {
  const r = rng(seed);
  const tr = emptyTrace();
  tr.env = cleanEnv();
  let t = 200;
  for (let a = 0; a < 12; a++) {
    for (let k = 0; k < r.int(1, 4); k++) { // Tab presses
      t += r.lognormal(700, 0.6);
      const s = ++slot;
      tr.key.push({ t, k: 'd', tr: 1, s, rep: 0, mod: 1, bg: 0 }, { t: t + r.lognormal(90, 0.3), k: 'u', tr: 1, s, rep: 0, mod: 1, bg: 0 });
    }
    t += r.lognormal(1500, 0.6);
    tr.click.push({ t, x: 0, y: 0, tr: 1, det: 0, dx: -300, dy: -200, w: 140, h: 40, pre: 0, bg: 0, pt: 'none' });
    if (r.next() < 0.5) t = typeHuman(tr, r, t, r.int(8, 20));
  }
  tr.key.sort((a, b) => a.t - b.t);
  return tr;
}

/** Human + password manager / browser autofill (insertReplacementText, no keys). */
export function autofillUser(seed = 6): SessionTrace {
  const tr = humanSession(seed);
  const t = tr.click[0].t + 50;
  for (let i = 0; i < 4; i++) tr.input.push({ t: t + i, it: 'insertReplacementText', tr: 1, kd: -1, comp: 0, bg: 0 });
  return tr;
}

/** Human using voice dictation: insertText with no keydown. */
export function dictationUser(seed = 7): SessionTrace {
  const tr = humanSession(seed);
  tr.key = []; tr.input = tr.input.filter(() => false);
  let t = tr.click[2].t + 300;
  for (let i = 0; i < 10; i++) { t += 400; tr.input.push({ t, it: 'insertText', tr: 1, kd: -1, comp: 0, bg: 0 }); }
  return tr;
}

/** Playwright-style DOM agent via CDP: one move per click, dead-centre, 0 ms holds, fill(). */
export function cdpDomAgent(seed = 8): SessionTrace {
  const r = rng(seed);
  const tr = emptyTrace();
  tr.env = cleanEnv();
  let t = 200;
  for (let a = 0; a < 8; a++) {
    t += r.uniform(1500, 4000);
    const p: PtrEv = { t, x: r.uniform(100, 1200), y: r.uniform(100, 800), c: 1, tr: 1, pt: 'mouse' };
    tr.ptr.push(p);
    tr.btn.push({ t: t + 0.5, k: 'd', tr: 1 }, { t: t + 0.9, k: 'u', tr: 1 });
    tr.click.push({ t: t + 1, x: p.x, y: p.y, tr: 1, det: 1, dx: 0, dy: 0.5, w: 160, h: 40, pre: 1, bg: 0, pt: 'mouse' });
    tr.input.push({ t: t + 30, it: 'insertText', tr: 1, kd: -1, comp: 0, bg: 0 });
  }
  return tr;
}

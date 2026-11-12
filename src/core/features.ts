/**
 * Turns a raw SessionTrace into numeric features. Pure functions, no DOM,
 * so the same code runs in the browser (debug panel) and on the server
 * (authoritative scoring).
 */
import type { BgState, SessionTrace, PtrEv, ClickEv, EnvSnapshot, KeyEv } from './types';
import { cv, dist, excessKurtosis, median, skewness, std } from './stats';

export interface Stroke {
  n: number;
  straight: number;     // direct distance first → last point, px
  path: number;         // summed path length, px
  straightness: number; // path / straight (1.0 = ruler-straight)
  speedCV: number;      // variation of segment speed within the stroke
}

export interface Features {
  env?: EnvSnapshot;

  // --- events
  untrustedClicks: number;
  untrustedKeys: number;
  untrustedInputs: number;
  untrustedMoves: number;
  untrustedAutofill: number;  // script events on credential/identity fields (password managers) — counted, not convicted
  insertTextTotal: number;
  insertTextNoKeydown: number;
  hiddenKeyOrInput: number;   // keys/inputs while document.hidden
  unfocusedKeyOrInput: number;
  hiddenClicks: number;
  initiallyHidden: boolean;     // VisibilityStateEntry says the page loaded in the background

  // --- dom
  foreignNodes: number;
  foreignTags: string[];
  agentMarkers: number;
  canaryHits: number;
  scriptSinks: number;          // Trusted Types violations by DevTools Protocol / extensions
  scriptSinkBy: string[];
  webmcpSubmits: number;        // SubmitEvent.agentInvoked
  webmcpTools: number;          // toolactivated / toolcancel

  // --- motion
  mouseMoves: number;
  coalescedApi: boolean;
  coalescedMultiFrac: number; // share of moves carrying >1 coalesced sample
  jumps: number;              // single-event moves of >= 400 px (re-entries excluded)
  strokes: Stroke[];
  medianStraightness: number;
  medianSpeedCV: number;
  mouseClicks: number;
  motionClicks: number;       // mouse clicks whose preceding pointer history is still in the trace (not evicted)
  jumpArrivalClicks: number;  // ...of which the pointer arrived in a single jump (or never moved)
  teleportPresses: number;    // ...and of those, the button was also released within INSTANT_HOLD_MS (judged per click)
  centredClicks: number;      // within 1.5 px of target centre (targets >= 24 px)
  centreEligibleClicks: number;
  keyboardClicks: number;     // detail === 0 (keyboard / assistive tech)

  // --- timing
  holds: number[];            // mousedown → mouseup, ms
  holdMedian: number;
  holdStd: number;
  longGaps: number;           // >= 2 s gaps between consecutive actions, ending in a mouse click
  stillGaps: number;          // ...of which the pointer moved <= 2 events
  gapValues: number[];        // all 1.5–30 s action gaps
  gapCV: number;
  scrolls: number;
  uncausedScrolls: number;

  // --- keyboard
  typedKeys: number;
  keyIntervals: number[];
  keyCV: number;
  keySkew: number;
  keyKurt: number;
  keyHolds: number[];
  keyHoldMedian: number;
  keyHoldStd: number;
  rolloverFrac: number;
  keyLatencies: number[];       // keydown delivery latency, ms (experimental)
  keyLatencyMedian: number;
  mouseHoldSkew: number;
  mouseHoldKurt: number;
  keyHoldSkew: number;
  keyHoldKurt: number;

  interactions: number;
}

const JUMP_PX = 400;
const INSTANT_HOLD_MS = 8;  // same limit tim.fixed_hold uses for "near-zero"

const STROKE_SPLIT_MS = 300;
const CHAIN_MS = 100; // untrusted event this soon after a trusted one = app-chained, ignore

function isMouse(p: { pt: string }) { return p.pt === 'mouse' || p.pt === 'pen'; }

const byT = <T extends { t: number }>(a: T[]): T[] => [...a].sort((x, y) => x.t - y.t);

/** Index of the last element with t <= `t` in a time-sorted array, or -1. */
function lastAtOrBefore(sorted: { t: number }[], t: number): number {
  let lo = 0, hi = sorted.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Untrusted events fired synchronously by the app inside a trusted handler are not agents.
 * `knownFrom`: before this time the trusted streams were evicted, so "no trusted event
 * nearby" cannot be told from "it was evicted" — those events are skipped, not convicted.
 * (The server latches Tier 1 hits before it evicts, so nothing real is lost.)
 */
function unchained(ts: number[], trustedSorted: number[], knownFrom: number): number {
  let n = 0;
  let j = 0;
  for (const t of [...ts].sort((a, b) => a - b)) {
    if (t - CHAIN_MS <= knownFrom) continue;
    while (j < trustedSorted.length && trustedSorted[j] <= t - CHAIN_MS) j++;
    const chained = j < trustedSorted.length && trustedSorted[j] <= t; // a trusted event within the last CHAIN_MS
    if (!chained) n++;
  }
  return n;
}

/** Non-repeat, non-modifier trusted keydowns: the keys that count as typing. Time-sorted. */
function typingKeys(trustedKeys: KeyEv[]): KeyEv[] {
  return byT(trustedKeys.filter((k) => k.k === 'd' && k.rep === 0 && k.mod === 0));
}

/** Start of each typing burst (a pause of more than 1 s starts a new one). */
function burstStarts(typing: KeyEv[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < typing.length; i++) if (i === 0 || typing[i].t - typing[i - 1].t > 1000) out.push(typing[i].t);
  return out;
}

/**
 * Times of the user's "actions" — every trusted click (any device) and every typing-burst start —
 * in order. score.ts uses the last few to cut the recent window.
 */
export function actionTimes(tr: SessionTrace): number[] {
  const clicks = tr.click.filter((c) => c.tr === 1).map((c) => c.t);
  const bursts = burstStarts(typingKeys(tr.key.filter((k) => k.tr === 1)));
  return [...clicks, ...bursts].sort((a, b) => a - b);
}

function buildStrokes(moves: PtrEv[], clicks: ClickEv[]): Stroke[] {
  const out: Stroke[] = [];
  const clickTimes = clicks.map((c) => c.t).sort((a, b) => a - b);
  let cur: PtrEv[] = [];
  let ci = 0;
  const flush = () => {
    if (cur.length >= 5) {
      const a = cur[0], b = cur[cur.length - 1];
      const straight = dist(a.x, a.y, b.x, b.y);
      let path = 0;
      const speeds: number[] = [];
      for (let i = 1; i < cur.length; i++) {
        const d = dist(cur[i - 1].x, cur[i - 1].y, cur[i].x, cur[i].y);
        path += d;
        const dt = cur[i].t - cur[i - 1].t;
        if (dt >= 4) speeds.push(d / dt); // ignore bunched events (<4 ms apart)
      }
      if (straight >= 100) {
        out.push({
          n: cur.length,
          straight,
          path,
          straightness: path / straight,
          speedCV: speeds.length >= 4 ? cv(speeds) : NaN,
        });
      }
    }
    cur = [];
  };
  for (const m of moves) {
    while (ci < clickTimes.length && clickTimes[ci] < m.t) { flush(); ci++; }
    const prev = cur[cur.length - 1];
    if (prev && (m.t - prev.t > STROKE_SPLIT_MS || m.re)) flush();
    cur.push(m);
  }
  flush();
  return out;
}

export function extractFeatures(tr: SessionTrace): Features {
  const cut = tr.cut ?? {};
  const moves = byT(tr.ptr.filter((p) => p.tr === 1 && isMouse(p)));
  const trustedClicks = byT(tr.click.filter((c) => c.tr === 1));
  const trustedKeys = byT(tr.key.filter((k) => k.tr === 1));
  const trustedTimes = [...trustedClicks.map((c) => c.t), ...trustedKeys.map((k) => k.t)].sort((a, b) => a - b);

  // ---------- events
  // Script events on credential/identity fields are what password-manager extensions do
  // (set value, dispatch click/key/input). They are counted but never convict.
  const hard = <T extends { tr: number; af?: number }>(a: T[]) => a.filter((e) => e.tr === 0 && e.af !== 1);
  const chainKnownFrom = Math.max(cut.click ?? -Infinity, cut.key ?? -Infinity);
  const untrustedClicks = unchained(hard(tr.click).map((c) => c.t), trustedTimes, chainKnownFrom);
  const untrustedKeys = unchained(hard(tr.key).map((k) => k.t), trustedTimes, chainKnownFrom);
  const untrustedInputs = unchained(hard(tr.input).map((i) => i.t), trustedTimes, chainKnownFrom);
  const untrustedMoves = tr.ptr.filter((p) => p.tr === 0).length;
  const autofillish = (a: { tr: number; af?: number }[]) => a.filter((e) => e.tr === 0 && e.af === 1).length;
  const untrustedAutofill = autofillish(tr.click) + autofillish(tr.key) + autofillish(tr.input);

  const insertText = tr.input.filter((i) => i.tr === 1 && i.it === 'insertText' && i.comp === 0 && !i.src);
  const insertTextNoKeydown = insertText.filter((i) => i.kd < 0 || i.kd > 500).length;

  // Visibility. The browser's own timeline (VisibilityStateEntry) is exact, so when it covers an
  // event it is the only thing consulted: the handler-time flag can lag the event (a queued
  // keydown dispatched after the tab was hidden) and must not produce a Tier 1 hit on its own.
  // The handler-time flag is the fallback where there is no timeline (non-Chromium, or evicted).
  const vis = byT(tr.vis ?? []);
  const visKnownFrom = !vis.length ? Infinity : cut.vis !== undefined ? vis[0].t : -Infinity;
  const isHidden = (e: { t: number; bg: BgState }) => {
    if (e.t < visKnownFrom) return e.bg === 2;
    const i = lastAtOrBefore(vis, e.t);
    return i >= 0 && vis[i].hid === 1;
  };
  const initiallyHidden = vis.length > 0 && vis[0].hid === 1 && vis[0].t <= 50;
  const trustedInputs = tr.input.filter((i) => i.tr === 1);
  const hiddenKeyOrInput = trustedKeys.filter(isHidden).length + trustedInputs.filter(isHidden).length;
  const unfocusedKeyOrInput =
    trustedKeys.filter((k) => k.bg === 1).length + trustedInputs.filter((i) => i.bg === 1).length;
  const hiddenClicks = trustedClicks.filter(isHidden).length;

  // ---------- dom
  const foreign = tr.dom.filter((d) => d.kind === 'foreign-node' || d.kind === 'shadow-root');
  const agentMarkers = tr.dom.filter((d) => d.kind === 'agent-marker').length;
  const canaryHits = tr.dom.filter((d) => d.kind.startsWith('canary')).length;
  const sinks = tr.dom.filter((d) => d.kind === 'script-sink' && (d.by === 'none' || d.by === 'extension'));
  const webmcpSubmits = tr.dom.filter((d) => d.kind === 'webmcp-submit').length;
  const webmcpTools = tr.dom.filter((d) => d.kind === 'webmcp-tool').length;

  // ---------- button presses (needed by both motion and timing)
  // Touch taps emit a compatibility mousedown/mouseup pair back to back; only mouse/pen presses are holds.
  const btn = byT(tr.btn.filter((b) => b.tr === 1 && b.pt !== 'touch'));
  const holds: number[] = [];
  const presses: { d: number; u: number }[] = []; // each release with the press that it ended, time-sorted by release
  let pendingDowns: number[] = [];
  for (const b of btn) {
    if (b.k === 'd') { pendingDowns.push(b.t); continue; }
    for (const d of pendingDowns) if (b.t - d < 2000) holds.push(b.t - d);
    if (pendingDowns.length) presses.push({ d: pendingDowns[pendingDowns.length - 1], u: b.t });
    pendingDowns = [];
  }

  // ---------- motion
  const withApi = moves.filter((m) => m.c > 0);
  const coalescedApi = withApi.length > 0;
  const coalescedMultiFrac = withApi.length ? withApi.filter((m) => m.c > 1).length / withApi.length : NaN;

  let jumps = 0;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].re) continue;
    if (dist(moves[i - 1].x, moves[i - 1].y, moves[i].x, moves[i].y) >= JUMP_PX) jumps++;
  }

  const strokes = buildStrokes(moves, trustedClicks);
  const straightVals = strokes.map((s) => s.straightness);
  const speedVals = strokes.map((s) => s.speedCV).filter(Number.isFinite);

  // Masked clicks (PIN pads) carry no geometry by design, so they are not pointer evidence either way.
  const mouseClicksArr = trustedClicks.filter((c) => c.det > 0 && isMouse(c as any) && c.mk !== 1);

  // Arrival. Only clicks whose approach is still in the trace can be judged: once pointer history
  // has been evicted, "no move before this click" means "evicted", not "teleported".
  const ptrCut = cut.ptr ?? -Infinity;
  const ptrTrimmed = Number.isFinite(ptrCut);
  let motionClicks = 0, jumpArrivalClicks = 0, teleportPresses = 0;
  let idx = -1, pi = -1;
  for (const c of mouseClicksArr) {
    if (c.t <= ptrCut) continue;
    while (idx + 1 < moves.length && moves[idx + 1].t <= c.t) idx++;
    if (ptrTrimmed && idx < 1) continue;           // its approach was (partly) evicted
    motionClicks++;
    let jumped = true, reEntry = false;            // idx < 0: clicked without the pointer ever moving
    if (idx >= 0) {
      const last = moves[idx], prev = moves[idx - 1];
      jumped = dist(last.x, last.y, c.x, c.y) <= 3 && (!prev || dist(prev.x, prev.y, last.x, last.y) >= 100);
      reEntry = last.re === 1;
    }
    if (!jumped) continue;
    // A pointer coming back into the page legitimately "jumps", so mot.jump_arrival (a ratio over many
    // clicks) gives re-entry the benefit of the doubt.
    if (!reEntry) jumpArrivalClicks++;
    // The same click, judged on its own: did the button also come up almost as soon as it went down?
    // One click with neither travel nor hold needs no pattern around it (a person's hand does both).
    // No re-entry exemption here. Measured: when a person moves their mouse off the page to an agent's
    // side panel and the agent then clicks, the agent's single move IS the re-entry; and a person who
    // re-enters exactly on the target still holds the button for ~100 ms.
    while (pi + 1 < presses.length && presses[pi + 1].u <= c.t + 1) pi++;
    const press = pi >= 0 && c.t - presses[pi].u <= 50 ? presses[pi] : undefined;
    if (press && press.u - press.d < INSTANT_HOLD_MS) teleportPresses++;
  }
  const eligible = mouseClicksArr.filter((c) => c.w >= 24 && c.h >= 24);
  const centredClicks = eligible.filter((c) => Math.abs(c.dx) <= 1.5 && Math.abs(c.dy) <= 1.5).length;
  const keyboardClicks = trustedClicks.filter((c) => c.det === 0).length;

  // ---------- timing

  // actions: mouse clicks + typing-burst starts
  const typing = typingKeys(trustedKeys);
  const actions = [
    ...mouseClicksArr.map((c) => ({ t: c.t, mouse: true })),
    ...burstStarts(typing).map((t) => ({ t, mouse: false })),
  ].sort((a, b) => a.t - b.t);

  let longGaps = 0, stillGaps = 0;
  const gapValues: number[] = [];
  let mi = 0;
  for (let i = 1; i < actions.length; i++) {
    const a = actions[i - 1], b = actions[i];
    const gap = b.t - a.t;
    if (gap >= 1500 && gap <= 30000) gapValues.push(gap);
    if (gap < 2000 || !b.mouse) continue;
    if (a.t <= ptrCut) continue; // pointer history for this pause was evicted: unknown, not "frozen"
    longGaps++;
    while (mi < moves.length && moves[mi].t <= a.t) mi++;
    let n = 0;
    for (let j = mi; j < moves.length && moves[j].t < b.t && n <= 2; j++) n++;
    if (n <= 2) stillGaps++;
  }

  const uncausedScrolls = tr.scroll.filter((s) => s.cause === 0 && Math.abs(s.dy) > 0).length;

  // ---------- keyboard
  const keyIntervals: number[] = [];
  for (let i = 1; i < typing.length; i++) {
    const d = typing[i].t - typing[i - 1].t;
    if (d < 1500) keyIntervals.push(d);
  }
  const keyLatencies = typing.map((k) => k.l).filter((l): l is number => typeof l === 'number' && l >= 0);
  const keyHolds: number[] = [];
  const upsBySlot = new Map<number, { t: number }[]>(); // per-press id → its keyups, time-sorted
  for (const u of trustedKeys) {
    if (u.k !== 'u') continue;
    const list = upsBySlot.get(u.s);
    if (list) list.push(u); else upsBySlot.set(u.s, [u]);
  }
  const upTimeFor = (d: { t: number; s: number }): number | undefined => {
    const list = upsBySlot.get(d.s);
    if (!list) return undefined;
    let lo = 0, hi = list.length - 1, ans = -1; // first keyup at or after the keydown
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].t >= d.t) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    return ans < 0 ? undefined : list[ans].t;
  };
  let rollover = 0, rollPairs = 0;
  for (let i = 0; i < typing.length; i++) {
    const up = upTimeFor(typing[i]);
    if (up !== undefined && up - typing[i].t < 2000) keyHolds.push(up - typing[i].t);
    if (i + 1 < typing.length && typing[i + 1].t - typing[i].t < 1500 && up !== undefined) {
      rollPairs++;
      if (up > typing[i + 1].t) rollover++;
    }
  }

  return {
    env: tr.env,
    untrustedClicks, untrustedKeys, untrustedInputs, untrustedMoves, untrustedAutofill,
    insertTextTotal: insertText.length, insertTextNoKeydown,
    hiddenKeyOrInput, unfocusedKeyOrInput, hiddenClicks, initiallyHidden,
    foreignNodes: foreign.length,
    foreignTags: [...new Set(foreign.map((d) => d.tag || '?'))].slice(0, 10),
    agentMarkers, canaryHits,
    scriptSinks: sinks.length, scriptSinkBy: [...new Set(sinks.map((d) => d.by as string))],
    webmcpSubmits, webmcpTools,
    mouseMoves: moves.length, coalescedApi, coalescedMultiFrac, jumps,
    strokes,
    medianStraightness: median(straightVals),
    medianSpeedCV: median(speedVals),
    mouseClicks: mouseClicksArr.length, motionClicks, jumpArrivalClicks, teleportPresses, centredClicks,
    centreEligibleClicks: eligible.length, keyboardClicks,
    holds, holdMedian: median(holds), holdStd: std(holds),
    longGaps, stillGaps, gapValues, gapCV: cv(gapValues),
    scrolls: tr.scroll.length, uncausedScrolls,
    typedKeys: typing.length, keyIntervals,
    keyCV: cv(keyIntervals), keySkew: skewness(keyIntervals), keyKurt: excessKurtosis(keyIntervals),
    keyHolds, keyHoldMedian: median(keyHolds), keyHoldStd: std(keyHolds),
    rolloverFrac: rollPairs ? rollover / rollPairs : NaN,
    keyLatencies, keyLatencyMedian: median(keyLatencies),
    mouseHoldSkew: skewness(holds), mouseHoldKurt: excessKurtosis(holds),
    keyHoldSkew: skewness(keyHolds), keyHoldKurt: excessKurtosis(keyHolds),
    interactions: trustedClicks.length + typing.length,
  };
}

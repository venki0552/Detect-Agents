/**
 * Turns a raw SessionTrace into numeric features. Pure functions, no DOM,
 * so the same code runs in the browser (debug panel) and on the server
 * (authoritative scoring).
 */
import type { SessionTrace, PtrEv, ClickEv, EnvSnapshot } from './types';
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
  jumpArrivalClicks: number;  // clicks whose pointer arrived in a single jump (or never moved)
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
const STROKE_SPLIT_MS = 300;
const CHAIN_MS = 100; // untrusted event this soon after a trusted one = app-chained, ignore

function isMouse(p: { pt: string }) { return p.pt === 'mouse' || p.pt === 'pen'; }

/** Untrusted events fired synchronously by the app inside a trusted handler are not agents. */
function unchained(ts: number[], trustedTs: number[]): number {
  let n = 0;
  let j = 0;
  const tr = [...trustedTs].sort((a, b) => a - b);
  for (const t of [...ts].sort((a, b) => a - b)) {
    while (j < tr.length && tr[j] <= t - CHAIN_MS) j++;
    const chained = j < tr.length && tr[j] <= t; // a trusted event within the last CHAIN_MS
    if (!chained) n++;
  }
  return n;
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
  const moves = tr.ptr.filter((p) => p.tr === 1 && isMouse(p)).sort((a, b) => a.t - b.t);
  const trustedClicks = tr.click.filter((c) => c.tr === 1);
  const trustedKeys = tr.key.filter((k) => k.tr === 1);
  const trustedTimes = [...trustedClicks.map((c) => c.t), ...trustedKeys.map((k) => k.t)];

  // ---------- events
  const untrustedClicks = unchained(tr.click.filter((c) => c.tr === 0).map((c) => c.t), trustedTimes);
  const untrustedKeys = unchained(tr.key.filter((k) => k.tr === 0).map((k) => k.t), trustedTimes);
  const untrustedInputs = unchained(tr.input.filter((i) => i.tr === 0).map((i) => i.t), trustedTimes);
  const untrustedMoves = tr.ptr.filter((p) => p.tr === 0).length;

  const insertText = tr.input.filter((i) => i.tr === 1 && i.it === 'insertText' && i.comp === 0 && !i.src);
  const insertTextNoKeydown = insertText.filter((i) => i.kd < 0 || i.kd > 500).length;

  // Visibility timeline from the browser (VisibilityStateEntry) — immune to handler-time races.
  const vis = [...(tr.vis ?? [])].sort((a, b) => a.t - b.t);
  const hiddenAt = (t: number) => {
    let h: number | null = null;
    for (const v of vis) { if (v.t <= t) h = v.hid; else break; }
    return h === 1;
  };
  const initiallyHidden = vis.length > 0 && vis[0].hid === 1 && vis[0].t <= 50;
  const hiddenKeyOrInput =
    trustedKeys.filter((k) => k.bg === 2 || hiddenAt(k.t)).length +
    tr.input.filter((i) => i.tr === 1 && (i.bg === 2 || hiddenAt(i.t))).length;
  const unfocusedKeyOrInput =
    trustedKeys.filter((k) => k.bg === 1).length + tr.input.filter((i) => i.tr === 1 && i.bg === 1).length;
  const hiddenClicks = trustedClicks.filter((c) => c.bg === 2 || hiddenAt(c.t)).length;

  // ---------- dom
  const foreign = tr.dom.filter((d) => d.kind === 'foreign-node' || d.kind === 'shadow-root');
  const agentMarkers = tr.dom.filter((d) => d.kind === 'agent-marker').length;
  const canaryHits = tr.dom.filter((d) => d.kind.startsWith('canary')).length;
  const sinks = tr.dom.filter((d) => d.kind === 'script-sink' && (d.by === 'none' || d.by === 'extension'));
  const webmcpSubmits = tr.dom.filter((d) => d.kind === 'webmcp-submit').length;
  const webmcpTools = tr.dom.filter((d) => d.kind === 'webmcp-tool').length;

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

  const mouseClicksArr = trustedClicks.filter((c) => c.det > 0 && isMouse(c as any));
  let jumpArrivalClicks = 0;
  for (const c of mouseClicksArr) {
    // last two moves before this click
    let idx = -1;
    for (let i = moves.length - 1; i >= 0; i--) if (moves[i].t <= c.t) { idx = i; break; }
    if (idx < 0) { jumpArrivalClicks++; continue; } // clicked without the pointer ever moving
    const last = moves[idx];
    const nearTarget = dist(last.x, last.y, c.x, c.y) <= 3;
    if (!nearTarget) continue;
    const prev = moves[idx - 1];
    if (!prev || (dist(prev.x, prev.y, last.x, last.y) >= 100 && !last.re)) jumpArrivalClicks++;
  }
  const eligible = mouseClicksArr.filter((c) => c.w >= 24 && c.h >= 24);
  const centredClicks = eligible.filter((c) => Math.abs(c.dx) <= 1.5 && Math.abs(c.dy) <= 1.5).length;
  const keyboardClicks = trustedClicks.filter((c) => c.det === 0).length;

  // ---------- timing
  const btn = tr.btn.filter((b) => b.tr === 1).sort((a, b) => a.t - b.t);
  const holds: number[] = [];
  for (let i = 0; i < btn.length; i++) {
    if (btn[i].k !== 'd') continue;
    const up = btn.slice(i + 1).find((b) => b.k === 'u');
    if (up && up.t - btn[i].t < 2000) holds.push(up.t - btn[i].t);
  }

  // actions: mouse clicks + typing-burst starts
  const typing = trustedKeys.filter((k) => k.k === 'd' && k.rep === 0 && k.mod === 0).sort((a, b) => a.t - b.t);
  const burstStarts: number[] = [];
  for (let i = 0; i < typing.length; i++) if (i === 0 || typing[i].t - typing[i - 1].t > 1000) burstStarts.push(typing[i].t);
  const actions = [
    ...mouseClicksArr.map((c) => ({ t: c.t, mouse: true })),
    ...burstStarts.map((t) => ({ t, mouse: false })),
  ].sort((a, b) => a.t - b.t);

  let longGaps = 0, stillGaps = 0;
  const gapValues: number[] = [];
  let mi = 0;
  for (let i = 1; i < actions.length; i++) {
    const a = actions[i - 1], b = actions[i];
    const gap = b.t - a.t;
    if (gap >= 1500 && gap <= 30000) gapValues.push(gap);
    if (gap < 2000 || !b.mouse) continue;
    longGaps++;
    while (mi < moves.length && moves[mi].t <= a.t) mi++;
    let n = 0;
    for (let j = mi; j < moves.length && moves[j].t < b.t; j++) n++;
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
  const ups = trustedKeys.filter((k) => k.k === 'u').sort((a, b) => a.t - b.t);
  const upTimeFor = (d: { t: number; s: number }) => ups.find((u) => u.s === d.s && u.t >= d.t)?.t;
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
    untrustedClicks, untrustedKeys, untrustedInputs, untrustedMoves,
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
    mouseClicks: mouseClicksArr.length, jumpArrivalClicks, centredClicks,
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

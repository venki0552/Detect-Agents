/**
 * Shared types for the agent-detect SDK.
 *
 * Privacy contract: nothing here carries key values, input values, page text
 * or PII. Keys are recorded as timestamps plus an ephemeral slot number used
 * only to pair keydown with keyup; slots are reassigned on every page load.
 */

/** 0/1 flag kept as a number to keep payloads small. */
export type Bit = 0 | 1;

export type PointerKind = 'mouse' | 'pen' | 'touch';

/** 0 = visible and focused, 1 = visible but window unfocused, 2 = document hidden. */
export type BgState = 0 | 1 | 2;

/** One pointermove event. */
export interface PtrEv {
  t: number;        // ms since session start (performance.now based)
  x: number;        // clientX
  y: number;        // clientY
  c: number;        // getCoalescedEvents().length (0 when the API is missing)
  tr: Bit;          // isTrusted
  pt: PointerKind;
  re?: Bit;         // first move after the pointer re-entered the document
}

/** mousedown / mouseup. */
export interface BtnEv {
  t: number;
  k: 'd' | 'u';
  tr: Bit;
  /** Pointer type of the press that produced it, when not a mouse. Touch taps emit a compatibility
   *  mousedown/mouseup pair with a ~0 ms hold, which must not be read as a robotic click. */
  pt?: PointerKind;
}

/** click. */
export interface ClickEv {
  t: number;
  x: number;
  y: number;
  tr: Bit;
  det: number;      // event.detail: 0 for keyboard / assistive-tech activation
  dx: number;       // click offset from target centre, px
  dy: number;
  w: number;        // target width/height, px
  h: number;
  pre: number;      // pointermove events in the 500 ms before the click
  bg: BgState;      // page state when it happened
  pt: PointerKind | 'none';
  af?: Bit;         // untrusted only: the target is a credential/identity field a password manager fills
  mk?: Bit;         // inside a masked region (PIN pad): geometry withheld, excluded from pointer rules
}

/** keydown / keyup — timing only. */
export interface KeyEv {
  t: number;
  k: 'd' | 'u';
  tr: Bit;
  s: number;        // ephemeral slot id pairing down/up (not the key)
  rep: Bit;         // auto-repeat
  mod: Bit;         // modifier/navigation key or IME process key (excluded from typing rhythm)
  bg: BgState;
  l?: number;       // keydown only: ms from event.timeStamp to handler (delivery latency)
  af?: Bit;         // untrusted only: see ClickEv.af
}

/** input event on a text control — the inputType only, never the value. */
export interface InputEv {
  t: number;
  it: string;       // inputType, e.g. insertText, insertFromPaste
  tr: Bit;
  kd: number;       // ms since the trusted printable keydown that produced it, -1 if none (each keydown pays for one insertText)
  comp: Bit;        // IME composition in progress (isComposing, keyCode 229, or <50 ms after compositionend)
  bg: BgState;
  src?: InputSource; // where the text came from, when the browser tells us
  af?: Bit;          // untrusted only: see ClickEv.af
}

/** 0 = typed/unknown, 1 = browser or password-manager autofill (:autofill), 2 = one-time-code field (SMS/WebOTP). */
export type InputSource = 0 | 1 | 2;

/** scroll event on the document. */
export interface ScrollEv {
  t: number;
  dy: number;
  cause: Bit;       // 1 if a wheel/touch/key/pointer-drag preceded it within 300 ms
}

export interface FocusEv {
  t: number;
  hid: Bit;
  foc: Bit;
}

/** Page visibility history from the browser's VisibilityStateEntry timeline. */
export interface VisEv {
  t: number;        // on the collector clock
  hid: Bit;
}

export type DomKind =
  | 'foreign-node' | 'agent-marker' | 'shadow-root'
  | 'canary-click' | 'canary-fill' | 'canary-focus'
  | 'script-sink'      // Trusted Types report-only violation (HTML/script injected via a string sink)
  | 'webmcp-submit'    // SubmitEvent.agentInvoked === true
  | 'webmcp-tool';     // toolactivated / toolcancel

export const DOM_KINDS: DomKind[] = ['foreign-node', 'agent-marker', 'shadow-root', 'canary-click', 'canary-fill', 'canary-focus', 'script-sink', 'webmcp-submit', 'webmcp-tool'];

export interface DomEv {
  t: number;
  kind: DomKind;
  tag?: string;
  /** script-sink only: who ran the sink. 'none' = no source file (DevTools Protocol / console), 'extension', 'page', 'other'. */
  by?: 'none' | 'extension' | 'page' | 'other';
}

/** Environment snapshot, collected once per page load. */
export interface EnvSnapshot {
  webdriver: boolean;
  webdriverIframeMismatch: boolean;
  webdriverOwnProperty: boolean;
  headlessUA: boolean;
  automationGlobals: string[];
  nativeTampered: string[];
  cdpRuntime: boolean;
  renderer: string;
  softwareRenderer: boolean;
  screenW: number;
  screenH: number;
  platform: string;
  pointerFine: boolean;
  touchPoints: number;
  languages: number;
}

/** A batch the client sends to the server. */
export interface Batch {
  sid: string;
  nonce: string;
  seq: number;
  env?: EnvSnapshot;
  ptr: PtrEv[];
  btn: BtnEv[];
  click: ClickEv[];
  key: KeyEv[];
  input: InputEv[];
  scroll: ScrollEv[];
  focus: FocusEv[];
  dom: DomEv[];
  vis?: VisEv[];
}

export type StreamKey = 'ptr' | 'btn' | 'click' | 'key' | 'input' | 'scroll' | 'focus' | 'dom' | 'vis';
export const STREAM_KEYS: StreamKey[] = ['ptr', 'btn', 'click', 'key', 'input', 'scroll', 'focus', 'dom', 'vis'];

/**
 * Max events kept per stream, per session. Worst case is about 16 500 events
 * (roughly 1.5 MB of heap) per session; a typical session is far smaller.
 * Size `maxSessions` against that number, not against the typical one.
 */
export const STREAM_CAPS: Record<StreamKey, number> = {
  ptr: 5000, btn: 2000, click: 1000, key: 3000, input: 3000, scroll: 1000, focus: 500, dom: 500, vis: 500,
};

/** Streams that can carry Tier 1 evidence: the server latches Tier 1 hits before evicting from these. */
export const TIER1_STREAMS: StreamKey[] = ['click', 'key', 'input', 'dom', 'vis'];

/** Everything known about a session so far (server or client side). */
export interface SessionTrace {
  env?: EnvSnapshot;
  /**
   * Per stream: the latest timestamp that was evicted to stay under the cap.
   * At or before this time the stream is INCOMPLETE, so a rule that needs it
   * must not read "no event" as "nothing happened" (see features.ts).
   */
  cut?: Partial<Record<StreamKey, number>>;
  ptr: PtrEv[];
  btn: BtnEv[];
  click: ClickEv[];
  key: KeyEv[];
  input: InputEv[];
  scroll: ScrollEv[];
  focus: FocusEv[];
  dom: DomEv[];
  vis: VisEv[];
}

export type Category = 'automation' | 'events' | 'dom' | 'motion' | 'timing' | 'keyboard' | 'environment' | 'declared';

export interface RuleHit {
  id: string;
  tier: 1 | 2;
  category: Category;
  weight: number;
  evidence: string;
}

export type Verdict = 'human' | 'unknown' | 'suspect' | 'agent';

export interface ScoreResult {
  verdict: Verdict;
  score: number;          // 0..100
  hits: RuleHit[];
  categories: Category[]; // distinct Tier 2 categories that fired
  declared: boolean;      // the agent announced itself (WebMCP) and nothing else hard fired
  /** Which pass produced the verdict: the whole session, or only the most recent actions (see score.ts). */
  scope: 'session' | 'recent';
  evidence: { interactions: number; mouseMoves: number; keys: number };
}

/**
 * How much an action matters. `critical` is for irreversible, high-value actions: the human must
 * always re-authenticate, whatever the verdict, because a verdict of "human" is evidence, not proof.
 */
export type Sensitivity = 'low' | 'medium' | 'high' | 'critical';
export const SENSITIVITIES: Sensitivity[] = ['low', 'medium', 'high', 'critical'];
export type Decision = 'allow' | 'notify' | 'step_up' | 'block';

export function emptyTrace(): SessionTrace {
  return { ptr: [], btn: [], click: [], key: [], input: [], scroll: [], focus: [], dom: [], vis: [] };
}

/**
 * Environment snapshots merge monotonically: an automation flag seen once stays
 * set, so a later (or forged) "clean" snapshot cannot erase it. Descriptive
 * fields take the latest value.
 */
export function mergeEnv(prev: EnvSnapshot | undefined, next: EnvSnapshot): EnvSnapshot {
  if (!prev) return next;
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(0, 40);
  return {
    ...next,
    webdriver: prev.webdriver || next.webdriver,
    webdriverIframeMismatch: prev.webdriverIframeMismatch || next.webdriverIframeMismatch,
    webdriverOwnProperty: prev.webdriverOwnProperty || next.webdriverOwnProperty,
    headlessUA: prev.headlessUA || next.headlessUA,
    cdpRuntime: prev.cdpRuntime || next.cdpRuntime,
    automationGlobals: union(prev.automationGlobals, next.automationGlobals),
    nativeTampered: union(prev.nativeTampered, next.nativeTampered),
  };
}

/** Append a batch to a trace without trimming. Pair with trimTrace(). */
export function appendBatch(trace: SessionTrace, b: Partial<Batch>): SessionTrace {
  if (b.env) trace.env = mergeEnv(trace.env, b.env);
  for (const k of STREAM_KEYS) {
    const src = (b as any)[k] as unknown[] | undefined;
    if (!src || !src.length) continue;
    const dst = trace[k] as unknown[];
    for (const ev of src) dst.push(ev);
  }
  return trace;
}

/** True when trimTrace() would evict from one of the given streams. */
export function overCap(trace: SessionTrace, streams: StreamKey[] = STREAM_KEYS, caps: Record<StreamKey, number> = STREAM_CAPS): boolean {
  return streams.some((k) => trace[k].length > caps[k]);
}

/**
 * Evict the oldest events of any stream over its cap, down to 80% of the cap
 * (so eviction, and the scoring pass the server runs before it, happens once
 * per fifth of a cap rather than on every batch). Records the eviction
 * watermark in `trace.cut`.
 */
export function trimTrace(trace: SessionTrace, caps: Record<StreamKey, number> = STREAM_CAPS): SessionTrace {
  for (const k of STREAM_KEYS) {
    const dst = trace[k] as { t: number }[];
    if (dst.length <= caps[k]) continue;
    const removed = dst.splice(0, dst.length - Math.floor(caps[k] * 0.8));
    let cut = trace.cut?.[k] ?? -Infinity;
    for (const ev of removed) if (ev.t > cut) cut = ev.t;
    (trace.cut ??= {})[k] = cut;
  }
  return trace;
}

/** Append a batch to a trace, capping each stream to bound memory. */
export function mergeBatch(trace: SessionTrace, b: Partial<Batch>, caps: Record<StreamKey, number> = STREAM_CAPS): SessionTrace {
  return trimTrace(appendBatch(trace, b), caps);
}

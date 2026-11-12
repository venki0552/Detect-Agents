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
}

/** input event on a text control — the inputType only, never the value. */
export interface InputEv {
  t: number;
  it: string;       // inputType, e.g. insertText, insertFromPaste
  tr: Bit;
  kd: number;       // ms since the last trusted keydown, -1 if none
  comp: Bit;        // IME composition in progress (isComposing, keyCode 229, or <50 ms after compositionend)
  bg: BgState;
  src?: InputSource; // where the text came from, when the browser tells us
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

/** Everything known about a session so far (server or client side). */
export interface SessionTrace {
  env?: EnvSnapshot;
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
  evidence: { interactions: number; mouseMoves: number; keys: number };
}

export type Sensitivity = 'low' | 'medium' | 'high';
export type Decision = 'allow' | 'notify' | 'step_up' | 'block';

export function emptyTrace(): SessionTrace {
  return { ptr: [], btn: [], click: [], key: [], input: [], scroll: [], focus: [], dom: [], vis: [] };
}

/** Append a batch to a trace, capping each stream to bound memory. */
export function mergeBatch(trace: SessionTrace, b: Partial<Batch>, cap = 5000): SessionTrace {
  if (b.env) trace.env = b.env;
  const keys: (keyof Omit<SessionTrace, 'env'>)[] = ['ptr', 'btn', 'click', 'key', 'input', 'scroll', 'focus', 'dom', 'vis'];
  for (const k of keys) {
    const src = (b as any)[k] as unknown[] | undefined;
    if (!src || !src.length) continue;
    const dst = trace[k] as unknown[];
    dst.push(...src);
    if (dst.length > cap) dst.splice(0, dst.length - cap);
  }
  return trace;
}

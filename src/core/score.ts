/**
 * Combines rule hits into a verdict, and a verdict into a decision for a
 * given action sensitivity.
 *
 * Two principles hold this file together (docs/DECISIONS.md D14, D15):
 *  - "human" is a positive claim. It needs an environment snapshot and enough
 *    samples that the rules could have fired. Too little to test = "unknown".
 *  - A clean history must not launder a robotic present. The most recent
 *    actions are scored on their own as well, and the worse result wins.
 */
import type { Category, Decision, RuleHit, ScoreResult, Sensitivity, SessionTrace, Verdict } from './types';
import { emptyTrace, SENSITIVITIES, STREAM_KEYS } from './types';
import { actionTimes, extractFeatures, type Features } from './features';
import { evaluateRules, type RuleConfig } from './rules';

export interface ScoreConfig extends RuleConfig {
  /** Score at or above which a session is "agent" (needs >= minCategories). Default 70. */
  agentScore?: number;
  /** Score at or above which a session is "suspect". Default 40. */
  suspectScore?: number;
  /** Independent Tier 2 categories required for an "agent" verdict. Default 2. */
  minCategories?: number;
  /** Interactions (clicks + keystrokes) needed before calling anything "human". Default 8. */
  minInteractions?: number;
  /**
   * "human" also needs one input family with enough samples for its rules to have run:
   * this many mouse/pen clicks (default 5, the largest minimum among the click rules)…
   */
  minPointerClicks?: number;
  /** …or this many typing intervals (default 20, the minimum of the keyboard rules). */
  minKeyIntervals?: number;
  /**
   * Also score the last N actions (clicks and typing bursts) on their own, and take the worse
   * verdict. Stops a long human session from diluting an agent that takes over. Default 8; 0 = off.
   */
  tailActions?: number;
}

const RANK: Record<Verdict, number> = { human: 0, unknown: 1, suspect: 2, agent: 3 };

/**
 * @param carried Tier 1 hits latched earlier in the session (the server keeps them so that
 *                evicting old events cannot erase hard evidence).
 */
export function scoreFeatures(f: Features, cfg: ScoreConfig = {}, carried: RuleHit[] = []): ScoreResult {
  const agentScore = cfg.agentScore ?? 70;
  const suspectScore = cfg.suspectScore ?? 40;
  const minCategories = cfg.minCategories ?? 2;
  const minInteractions = cfg.minInteractions ?? 8;
  const minPointerClicks = cfg.minPointerClicks ?? 5;
  const minKeyIntervals = cfg.minKeyIntervals ?? 20;

  const hits = evaluateRules(f, cfg);
  for (const c of carried) if (!hits.some((h) => h.id === c.id)) hits.push(c);
  const evidence = { interactions: f.interactions, mouseMoves: f.mouseMoves, keys: f.typedKeys };

  const tier1 = hits.filter((h) => h.tier === 1);
  const tier2 = hits.filter((h) => h.tier === 2);
  const categories = [...new Set(tier2.map((h) => h.category))] as Category[];

  if (tier1.length) {
    const declared = tier1.every((h) => h.category === 'declared');
    return { verdict: 'agent', score: 100, hits, categories, evidence, declared, scope: 'session' };
  }

  // Probabilistic OR of weights: 1 - Π(1 - w). Weights are clamped so a bad override cannot go negative.
  let keep = 1;
  for (const h of tier2) keep *= 1 - Math.max(0, Math.min(99, h.weight)) / 100;
  const score = Math.round((1 - keep) * 100);

  // Could the rules have caught a robot here? Only then does a clean result mean anything.
  const testable = f.mouseClicks >= minPointerClicks || f.keyIntervals.length >= minKeyIntervals;

  let verdict: Verdict;
  if (score >= agentScore && categories.length >= minCategories) verdict = 'agent';
  else if (score >= suspectScore) verdict = 'suspect';
  else if (f.env && f.interactions >= minInteractions && testable) verdict = 'human';
  else verdict = 'unknown';

  return { verdict, score, hits, categories, evidence, declared: false, scope: 'session' };
}

/** Pointer history kept before the first action of the recent window, so its approach can be judged. */
const TAIL_LEAD_MS = 3000;

/**
 * The trace restricted to the last `n` actions (plus a short lead-in), or null when the session
 * has no more than `n` actions. Marked as cut at its start, so rules treat anything earlier as
 * "not in view" rather than "did not happen".
 */
export function tailTrace(trace: SessionTrace, n: number): SessionTrace | null {
  if (n <= 0) return null;
  const acts = actionTimes(trace);
  if (acts.length <= n) return null;
  const from = acts[acts.length - n] - TAIL_LEAD_MS;
  const out = emptyTrace();
  out.env = trace.env;
  out.cut = { ...trace.cut };
  for (const k of STREAM_KEYS) {
    (out[k] as { t: number }[]) = (trace[k] as { t: number }[]).filter((e) => e.t >= from);
    if (k !== 'vis') out.cut[k] = Math.max(out.cut[k] ?? -Infinity, from);
  }
  // carry the visibility state in force at the window start, so the timeline stays complete
  let state: { t: number; hid: 0 | 1 } | undefined;
  for (const v of trace.vis) if (v.t < from && (!state || v.t >= state.t)) state = v;
  if (state) { out.vis.unshift({ t: from, hid: state.hid }); delete out.cut.vis; }
  return out;
}

export function scoreTrace(trace: SessionTrace, cfg: ScoreConfig = {}, carried: RuleHit[] = []): ScoreResult {
  const full = scoreFeatures(extractFeatures(trace), cfg, carried);
  if (full.verdict === 'agent') return full;
  const tail = tailTrace(trace, cfg.tailActions ?? 8);
  if (!tail) return full;
  const recent = scoreFeatures(extractFeatures(tail), cfg);
  // The recent pass can only add a detection. Its "unknown"/"human" never overrides the session.
  if (RANK[recent.verdict] < RANK.suspect || RANK[recent.verdict] <= RANK[full.verdict]) return full;
  return { ...recent, evidence: full.evidence, scope: 'recent' };
}

/**
 * Verdict × action sensitivity → what to do.
 *
 *                 low       medium     high       critical
 *   declared      allow     step_up    step_up    step_up   (WebMCP agent that announced itself)
 *   hard (T1)     notify    block      block      block
 *   agent         notify    step_up    step_up    step_up
 *   suspect       allow     notify     step_up    step_up
 *   unknown       allow     allow      step_up    step_up
 *   human         allow     allow      allow      step_up
 *
 * `critical` never returns allow: telemetry comes from a browser the attacker may control, so a
 * "human" verdict is evidence, not proof. Anything that is not a known sensitivity is treated as
 * `high` — a typo in a policy must fail closed.
 */
export function decide(r: ScoreResult, sensitivity: Sensitivity): Decision {
  const s: Sensitivity = SENSITIVITIES.includes(sensitivity) ? sensitivity : 'high';
  // A declared (WebMCP) agent is cooperative: read-only is fine, anything that changes state needs the human.
  if (r.declared) return s === 'low' ? 'allow' : 'step_up';
  const hard = r.hits.some((h: RuleHit) => h.tier === 1);
  if (hard) return s === 'low' ? 'notify' : 'block';
  if (s === 'critical') return 'step_up';
  switch (r.verdict) {
    case 'agent': return s === 'low' ? 'notify' : 'step_up';
    case 'suspect': return s === 'high' ? 'step_up' : s === 'medium' ? 'notify' : 'allow';
    case 'unknown': return s === 'high' ? 'step_up' : 'allow';
    default: return 'allow';
  }
}

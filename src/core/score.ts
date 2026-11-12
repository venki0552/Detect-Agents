/**
 * Combines rule hits into a verdict, and a verdict into a decision for a
 * given action sensitivity.
 */
import type { Category, Decision, RuleHit, ScoreResult, Sensitivity, SessionTrace } from './types';
import { extractFeatures, type Features } from './features';
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
}

export function scoreFeatures(f: Features, cfg: ScoreConfig = {}): ScoreResult {
  const agentScore = cfg.agentScore ?? 70;
  const suspectScore = cfg.suspectScore ?? 40;
  const minCategories = cfg.minCategories ?? 2;
  const minInteractions = cfg.minInteractions ?? 8;

  const hits = evaluateRules(f, cfg);
  const evidence = { interactions: f.interactions, mouseMoves: f.mouseMoves, keys: f.typedKeys };

  const tier1 = hits.filter((h) => h.tier === 1);
  const tier2 = hits.filter((h) => h.tier === 2);
  const categories = [...new Set(tier2.map((h) => h.category))] as Category[];

  if (tier1.length) {
    const declared = tier1.every((h) => h.category === 'declared');
    return { verdict: 'agent', score: 100, hits, categories, evidence, declared };
  }

  // Probabilistic OR of weights: 1 - Π(1 - w)
  let keep = 1;
  for (const h of tier2) keep *= 1 - Math.min(99, h.weight) / 100;
  const score = Math.round((1 - keep) * 100);

  let verdict: ScoreResult['verdict'];
  if (score >= agentScore && categories.length >= minCategories) verdict = 'agent';
  else if (score >= suspectScore) verdict = 'suspect';
  else if (f.interactions >= minInteractions || f.mouseMoves >= 200) verdict = 'human';
  else verdict = 'unknown';

  return { verdict, score, hits, categories, evidence, declared: false };
}

export function scoreTrace(trace: SessionTrace, cfg: ScoreConfig = {}): ScoreResult {
  return scoreFeatures(extractFeatures(trace), cfg);
}

/**
 * Verdict × action sensitivity → what to do.
 *
 *                 low       medium     high (money movement, payee, password)
 *   declared      allow     step_up    step_up   (WebMCP agent that announced itself)
 *   hard (T1)     notify    block      block
 *   agent         notify    step_up    step_up
 *   suspect       allow     notify     step_up
 *   unknown       allow     allow      step_up
 *   human         allow     allow      allow
 */
export function decide(r: ScoreResult, sensitivity: Sensitivity): Decision {
  // A declared (WebMCP) agent is cooperative: read-only is fine, anything that changes state needs the human.
  if (r.declared) return sensitivity === 'low' ? 'allow' : 'step_up';
  const hard = r.hits.some((h: RuleHit) => h.tier === 1);
  if (hard) return sensitivity === 'low' ? 'notify' : 'block';
  switch (r.verdict) {
    case 'agent': return sensitivity === 'low' ? 'notify' : 'step_up';
    case 'suspect': return sensitivity === 'high' ? 'step_up' : sensitivity === 'medium' ? 'notify' : 'allow';
    case 'unknown': return sensitivity === 'high' ? 'step_up' : 'allow';
    default: return 'allow';
  }
}

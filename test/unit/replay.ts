/**
 * Re-score captured sessions with the current rules:  npm run replay [dir]
 * Captures come from `npm run demo:capture` (one JSON file per decision). Use it to see what a
 * rule or threshold change would have done to sessions you already recorded.
 * AD_EXPERIMENTAL=mot.teleport_press,key.instant_delivery (or "all") also applies experimental rules.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreTrace, decide } from '../../src/core/score';
import { extractFeatures } from '../../src/core/features';

const dir = process.argv[2] || 'captures';
const cfg = { experimental: (process.env.AD_EXPERIMENTAL || '').split(',').filter(Boolean) };
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
if (!files.length) console.log(`no captures in ${dir}/`);
for (const f of files) {
  const c = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (!c.trace) { console.log(`${f}\n  (no session)`); continue; }
  const r = scoreTrace(c.trace, cfg);
  const x = extractFeatures(c.trace);
  console.log(`${f}${c.label ? `  [${c.label}]` : ''}`);
  console.log(`  then: ${c.event.decision} (${c.event.verdict} ${c.event.score})   now: ${decide(r, c.event.sensitivity)} (${r.verdict} ${r.score}, ${r.scope})`);
  console.log(`  evidence: ${x.mouseClicks} mouse clicks, ${x.keyboardClicks} keyboard clicks, ${x.typedKeys} typed keys, ${x.mouseMoves} moves, coalesced>1 in ${Number.isFinite(x.coalescedMultiFrac) ? Math.round(x.coalescedMultiFrac * 100) + '%' : 'n/a'} of moves`);
  console.log(`  timing: mouse hold median ${Math.round(x.holdMedian)} ms, key hold median ${Math.round(x.keyHoldMedian)} ms, key interval CV ${x.keyCV.toFixed(2)}, rollover ${Number.isFinite(x.rolloverFrac) ? Math.round(x.rolloverFrac * 100) + '%' : 'n/a'}`);
  for (const h of r.hits) console.log(`   - ${h.id} (${h.tier === 1 ? 'Tier 1' : h.weight}): ${h.evidence}`);
}

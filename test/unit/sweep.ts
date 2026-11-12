import * as T from './traces';
import { scoreTrace } from '../../src/core/score';
/** A long human session, then an xdotool-style agent takes over the same session (the dilution case). */
function takeover(s: number) {
  const tr = T.humanSession(s, { actions: 40 });
  const end = Math.max(...tr.click.map((c: any) => c.t), ...tr.key.map((k: any) => k.t));
  const bot = T.xdotoolAgent(s + 7);
  for (const k of ['ptr', 'btn', 'click', 'key', 'input'] as const) for (const e of bot[k]) (tr[k] as any[]).push({ ...e, t: e.t + end + 2000 });
  return tr;
}
const gens: [string, (s: number) => any][] = [
  ['human', (s) => T.humanSession(s)], ['human-trackpad', (s) => T.humanSession(s, { trackpad: true })],
  ['human-long (40)', (s) => T.humanSession(s, { actions: 40 })], ['human-short (3)', (s) => T.humanSession(s, { actions: 3 })],
  ['takeover', takeover],
  ['keyboard-only', (s) => T.keyboardOnlyUser(s)], ['autofill', (s) => T.autofillUser(s)], ['dictation', (s) => T.dictationUser(s)],
  ['xdotool', (s) => T.xdotoolAgent(s)], ['pyautogui', (s) => T.pyautoguiAgent(s)], ['humanized', (s) => T.humanizedAgent(s)], ['cdp-dom', (s) => T.cdpDomAgent(s)],
];
const N = Number(process.argv[2] || 500);
console.log(`profile          n    human  unknown suspect  agent   top false/true hits`);
for (const [name, g] of gens) {
  const c: Record<string, number> = { human: 0, unknown: 0, suspect: 0, agent: 0 };
  const hitCount: Record<string, number> = {};
  for (let s = 1; s <= N; s++) { const r = scoreTrace(g(1000 + s)); c[r.verdict]++; for (const h of r.hits) hitCount[h.id] = (hitCount[h.id] || 0) + 1; }
  const top = Object.entries(hitCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round(100 * v / N)}%`).join(', ');
  const pct = (k: string) => (100 * c[k] / N).toFixed(1).padStart(6);
  console.log(`${name.padEnd(15)} ${String(N).padEnd(4)} ${pct('human')} ${pct('unknown')} ${pct('suspect')} ${pct('agent')}   ${top}`);
}

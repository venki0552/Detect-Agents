/**
 * The rule catalog. Every rule is plain code with an explicit threshold.
 *
 * Tier 1 — hard evidence of automation; one hit is enough.
 * Tier 2 — weighted evidence; a verdict of "agent" needs hits in two or more
 *          independent categories, so no single noisy rule can convict.
 *
 * Every rule also runs on the last few actions alone (score.ts), so its
 * minimum sample must make sense in a short window. A rule that reads one
 * stream against another must respect `trace.cut` (features.ts): after
 * eviction, "no event" is not "nothing happened".
 *
 * Thresholds are starting points. Calibrate them against real human
 * sessions before using any verdict to block (see README → Calibration).
 */
import type { Category, RuleHit } from './types';
import type { Features } from './features';
import { round } from './stats';

export interface RuleConfig {
  /** Rules disabled by id. */
  disabled?: string[];
  /** Experimental rules to enable by id ('all' enables every experimental rule). Off by default until calibrated. */
  experimental?: string[];
  /** Weight overrides by id (Tier 2 only). */
  weights?: Record<string, number>;
}

interface Rule {
  id: string;
  tier: 1 | 2;
  category: Category;
  weight: number; // 0–100, Tier 2 only (Tier 1 is always decisive)
  description: string;
  /** Not calibrated on real humans yet — off unless enabled in RuleConfig.experimental. */
  experimental?: boolean;
  /** Returns evidence text when the rule fires, otherwise null. */
  test(f: Features): string | null;
}

const fin = Number.isFinite;

export const RULES: Rule[] = [
  // ───────────────────────── Tier 1: automation ─────────────────────────
  {
    id: 'env.webdriver', tier: 1, category: 'automation', weight: 100,
    description: 'navigator.webdriver is true (WebDriver / CDP automation flag).',
    test: (f) => (f.env?.webdriver ? 'navigator.webdriver === true' : null),
  },
  {
    id: 'env.webdriver_patched', tier: 1, category: 'automation', weight: 100,
    description: 'navigator.webdriver was patched (own property, or top frame and fresh iframe disagree) — stealth plugins do this.',
    test: (f) =>
      f.env?.webdriverOwnProperty ? 'webdriver defined as own property on navigator'
        : f.env?.webdriverIframeMismatch ? 'webdriver differs between top frame and a fresh iframe' : null,
  },
  {
    id: 'env.automation_globals', tier: 1, category: 'automation', weight: 100,
    description: 'Globals injected by Playwright, Puppeteer, Selenium/ChromeDriver, PhantomJS or Nightmare.',
    test: (f) => (f.env?.automationGlobals.length ? `found: ${f.env.automationGlobals.join(', ')}` : null),
  },
  {
    id: 'env.headless_ua', tier: 1, category: 'automation', weight: 100,
    description: 'User agent says HeadlessChrome.',
    test: (f) => (f.env?.headlessUA ? 'HeadlessChrome in user agent' : null),
  },
  // ───────────────────────── Tier 1: events ─────────────────────────
  {
    id: 'evt.untrusted', tier: 1, category: 'events', weight: 100,
    description: 'Script-dispatched (isTrusted=false) clicks, keys or input that the app itself did not chain from a real event. Script events on credential/identity fields (password-manager fills) are excluded.',
    test: (f) => {
      const n = f.untrustedClicks + f.untrustedKeys + f.untrustedInputs + f.untrustedMasked;
      return n >= 1 ? `${n} untrusted events (clicks ${f.untrustedClicks}, keys ${f.untrustedKeys}, inputs ${f.untrustedInputs}${f.untrustedMasked ? `, in masked regions ${f.untrustedMasked}` : ''})` : null;
    },
  },
  {
    id: 'evt.input_while_hidden', tier: 1, category: 'events', weight: 100,
    description: 'Keystrokes or text input arrived while the tab was hidden — a human cannot type into a background tab.',
    test: (f) => (f.hiddenKeyOrInput >= 1 ? `${f.hiddenKeyOrInput} key/input events while document.hidden` : null),
  },
  // ───────────────────────── Tier 1: DOM ─────────────────────────
  {
    id: 'dom.canary', tier: 1, category: 'dom', weight: 100,
    description: 'A honeypot element that is invisible and hidden from screen readers was clicked, focused or filled.',
    test: (f) => (f.canaryHits >= 1 ? `${f.canaryHits} canary interactions` : null),
  },
  {
    id: 'dom.agent_marker', tier: 1, category: 'dom', weight: 100,
    description: 'An element matching a configured agent-overlay selector was injected into the page.',
    test: (f) => (f.agentMarkers >= 1 ? `${f.agentMarkers} agent marker nodes` : null),
  },

  // ───────────────────────── Tier 1: declared agents ─────────────────────────
  {
    id: 'agent.webmcp_declared', tier: 1, category: 'declared', weight: 100,
    description: 'The browser reported an agent acting through WebMCP (SubmitEvent.agentInvoked, toolactivated/toolcancel). Cooperative agent: steps up, never blocks.',
    test: (f) => (f.webmcpSubmits + f.webmcpTools >= 1 ? `${f.webmcpSubmits} agent-invoked submits, ${f.webmcpTools} tool events` : null),
  },

  // ───────────────────────── Tier 2: automation (soft) ─────────────────────────
  {
    id: 'env.cdp_runtime', tier: 2, category: 'automation', weight: 45,
    description: 'Chrome DevTools Protocol Runtime domain appears active (Playwright/Puppeteer, or a human with DevTools open).',
    test: (f) => (f.env?.cdpRuntime ? 'console object serialisation side effect observed' : null),
  },
  {
    id: 'env.native_tampered', tier: 2, category: 'automation', weight: 35,
    description: 'Native browser functions were replaced by JavaScript (stealth tools; also some privacy extensions).',
    test: (f) => (f.env?.nativeTampered.length ? `patched: ${f.env.nativeTampered.join(', ')}` : null),
  },
  // ───────────────────────── Tier 2: DOM ─────────────────────────
  {
    id: 'dom.injected_html', tier: 2, category: 'dom', weight: 40,
    description: 'Trusted Types (report-only) caught HTML or script injected through a string sink by the DevTools Protocol or a main-world extension script. Needs the CSP report-only header; benign extensions can trigger it too.',
    test: (f) => (f.scriptSinks >= 1 ? `${f.scriptSinks} injected string sinks (by: ${f.scriptSinkBy.join(', ')})` : null),
  },
  {
    id: 'dom.foreign_nodes', tier: 2, category: 'dom', weight: 12,
    description: 'Elements inserted outside the app roots by something other than the app (extensions, agent overlays). Known benign extensions are ignored.',
    test: (f) => (f.foreignNodes >= 1 ? `${f.foreignNodes} foreign nodes (${f.foreignTags.join(', ')})` : null),
  },
  // ───────────────────────── Tier 2: environment ─────────────────────────
  {
    id: 'env.agent_vm_profile', tier: 2, category: 'environment', weight: 30,
    description: 'Software GPU + Linux + a small fixed resolution typical of agent VMs/containers (e.g. 1024×768).',
    test: (f) => {
      const e = f.env;
      if (!e || !e.softwareRenderer) return null;
      const small = [[1024, 768], [1280, 800], [1280, 720], [800, 600]].some(([w, h]) => e.screenW === w && e.screenH === h);
      return small && /linux/i.test(e.platform) ? `${e.renderer} at ${e.screenW}×${e.screenH} on ${e.platform}` : null;
    },
  },
  {
    id: 'env.software_renderer', tier: 2, category: 'environment', weight: 12,
    description: 'Software WebGL renderer (cloud browsers, VMs, remote desktop).',
    test: (f) => (f.env?.softwareRenderer ? f.env.renderer : null),
  },
  // ───────────────────────── Tier 2: events ─────────────────────────
  {
    id: 'evt.text_without_keys', tier: 2, category: 'events', weight: 40,
    description: 'Text inserted as typing (insertText) with no keystroke before it — CDP insertText / fill(). Dictation does this too.',
    test: (f) =>
      f.insertTextNoKeydown >= 2 && f.insertTextNoKeydown / Math.max(1, f.insertTextTotal) >= 0.5
        ? `${f.insertTextNoKeydown}/${f.insertTextTotal} insertText events had no keydown` : null,
  },
  {
    id: 'evt.input_while_unfocused', tier: 2, category: 'events', weight: 35,
    description: 'Keys or text input while the window did not have focus.',
    test: (f) => (f.unfocusedKeyOrInput >= 2 ? `${f.unfocusedKeyOrInput} key/input events without window focus` : null),
  },
  {
    id: 'evt.click_while_hidden', tier: 2, category: 'events', weight: 40,
    description: 'Clicks delivered while the document was hidden.',
    test: (f) => (f.hiddenClicks >= 1 ? `${f.hiddenClicks} clicks while hidden` : null),
  },
  // ───────────────────────── Tier 2: motion ─────────────────────────
  {
    id: 'mot.no_coalesced', tier: 2, category: 'motion', weight: 35,
    description: 'Hardware mice deliver several samples per frame (getCoalescedEvents > 1); injected input almost never does.',
    test: (f) =>
      f.coalescedApi && f.mouseMoves >= 150 && f.coalescedMultiFrac < 0.02
        ? `${round(f.coalescedMultiFrac * 100, 1)}% of ${f.mouseMoves} moves carried >1 sample` : null,
  },
  {
    id: 'mot.jump_arrival', tier: 2, category: 'motion', weight: 45,
    description: 'The pointer arrived at the clicked spot in a single jump (or never moved) instead of travelling there.',
    test: (f) =>
      f.motionClicks >= 3 && f.jumpArrivalClicks / f.motionClicks >= 0.6
        ? `${f.jumpArrivalClicks}/${f.motionClicks} clicks arrived by teleport` : null,
  },
  {
    id: 'mot.teleport_press', tier: 2, category: 'motion', weight: 45,
    description: 'On one click, the pointer appeared at the target in a single jump (or without ever moving) AND the button was released within 8 ms of being pressed: no travel and no hold. A single click is enough, so it covers one robotic action after a human did everything else. Measured in real Chrome: Claude in Chrome 11/11 clicks, one real human 0/17. On by default by the maintainer\'s decision (D37); not yet measured on trackpad tap-to-click or remote desktop.',
    test: (f) => (f.teleportPresses >= 1 ? `${f.teleportPresses} click${f.teleportPresses === 1 ? '' : 's'} with no pointer travel and no button hold` : null),
  },
  {
    id: 'mot.centred_clicks', tier: 2, category: 'motion', weight: 35,
    description: 'Clicks land within 1.5 px of the exact centre of the target, repeatedly.',
    test: (f) =>
      f.centreEligibleClicks >= 4 && f.centredClicks / f.centreEligibleClicks >= 0.7
        ? `${f.centredClicks}/${f.centreEligibleClicks} clicks dead-centre` : null,
  },
  {
    id: 'mot.ruler_straight', tier: 2, category: 'motion', weight: 30,
    description: 'Pointer paths are ruler-straight (path/direct distance ≤ 1.01).',
    test: (f) =>
      f.strokes.length >= 6 && fin(f.medianStraightness) && f.medianStraightness <= 1.01
        ? `median straightness ${round(f.medianStraightness, 4)} over ${f.strokes.length} strokes` : null,
  },
  {
    id: 'mot.constant_speed', tier: 2, category: 'motion', weight: 30,
    description: 'Pointer moves at constant speed (linear tweening) instead of accelerating and braking.',
    test: (f) =>
      f.strokes.filter((s) => fin(s.speedCV)).length >= 6 && fin(f.medianSpeedCV) && f.medianSpeedCV < 0.15
        ? `median speed variation ${round(f.medianSpeedCV, 3)}` : null,
  },
  // ───────────────────────── Tier 2: timing ─────────────────────────
  {
    id: 'tim.fixed_hold', tier: 2, category: 'timing', weight: 35,
    description: 'Mouse button held for a fixed or near-zero time on every click.',
    test: (f) =>
      f.holds.length >= 5 && (f.holdMedian < 8 || f.holdStd < 3)
        ? `hold median ${round(f.holdMedian, 1)} ms, std ${round(f.holdStd, 1)} ms over ${f.holds.length} clicks` : null,
  },
  {
    id: 'tim.still_gaps', tier: 2, category: 'timing', weight: 40,
    description: 'Long pauses with a frozen pointer, then a precise click — the screenshot → model → act loop.',
    test: (f) =>
      f.stillGaps >= 3 && f.stillGaps / Math.max(1, f.longGaps) >= 0.7
        ? `${f.stillGaps}/${f.longGaps} pauses of 2 s+ had a frozen pointer before the click` : null,
  },
  {
    id: 'tim.metronome_gaps', tier: 2, category: 'timing', weight: 20,
    description: 'Gaps between actions cluster tightly (model-latency band).',
    test: (f) =>
      f.gapValues.length >= 5 && fin(f.gapCV) && f.gapCV < 0.25
        ? `action-gap CV ${round(f.gapCV, 3)} over ${f.gapValues.length} gaps` : null,
  },
  {
    id: 'tim.uncaused_scroll', tier: 2, category: 'timing', weight: 25,
    description: 'The page scrolled with no wheel, touch, key or drag before it (scrollTo / scrollIntoView by an agent).',
    test: (f) =>
      f.uncausedScrolls >= 3 && f.uncausedScrolls / Math.max(1, f.scrolls) >= 0.5
        ? `${f.uncausedScrolls}/${f.scrolls} scroll events had no input cause` : null,
  },
  {
    id: 'tim.uniform_random_holds', tier: 2, category: 'timing', weight: 30,
    description: 'Hold times look drawn from random(a, b): flat histogram (excess kurtosis < −0.9, |skew| < 0.35). Human timing is right-skewed.',
    test: (f) => {
      const flat = (n: number, sk: number, ku: number, min: number) => n >= min && fin(ku) && ku < -0.9 && Math.abs(sk) < 0.35;
      if (flat(f.holds.length, f.mouseHoldSkew, f.mouseHoldKurt, 25))
        return `mouse hold skew ${round(f.mouseHoldSkew, 2)}, kurtosis ${round(f.mouseHoldKurt, 2)} over ${f.holds.length}`;
      if (flat(f.keyHolds.length, f.keyHoldSkew, f.keyHoldKurt, 25))
        return `key hold skew ${round(f.keyHoldSkew, 2)}, kurtosis ${round(f.keyHoldKurt, 2)} over ${f.keyHolds.length}`;
      return null;
    },
  },
  // ───────────────────────── Tier 2: keyboard ─────────────────────────
  {
    id: 'key.metronome', tier: 2, category: 'keyboard', weight: 40,
    description: 'Keystroke intervals almost constant (xdotool type defaults to 12 ms; Playwright type uses a fixed delay).',
    test: (f) =>
      f.keyIntervals.length >= 20 && fin(f.keyCV) && f.keyCV < 0.12
        ? `interval CV ${round(f.keyCV, 3)} over ${f.keyIntervals.length} keys` : null,
  },
  {
    id: 'key.fixed_hold', tier: 2, category: 'keyboard', weight: 35,
    description: 'Keys held for a fixed or near-zero time.',
    test: (f) =>
      f.keyHolds.length >= 20 && (f.keyHoldMedian < 8 || f.keyHoldStd < 3)
        ? `key hold median ${round(f.keyHoldMedian, 1)} ms, std ${round(f.keyHoldStd, 1)} ms` : null,
  },
  {
    id: 'key.uniform_random', tier: 2, category: 'keyboard', weight: 35,
    description: 'Keystroke intervals look drawn from random(a, b): flat histogram instead of right-skewed.',
    test: (f) =>
      f.keyIntervals.length >= 30 && fin(f.keyKurt) && f.keyKurt < -0.9 && Math.abs(f.keySkew) < 0.35
        ? `interval skew ${round(f.keySkew, 2)}, kurtosis ${round(f.keyKurt, 2)}` : null,
  },
  {
    id: 'key.instant_delivery', tier: 2, category: 'keyboard', weight: 30, experimental: true,
    description: 'Keydown reaches the page almost instantly after its timestamp (median < 0.5 ms). DevTools Protocol keys measured 0.1–1.2 ms (median 0.3); hardware keys travel the OS input pipeline. Needs a real-human baseline.',
    test: (f) =>
      f.keyLatencies.length >= 20 && fin(f.keyLatencyMedian) && f.keyLatencyMedian < 0.5
        ? `median delivery latency ${round(f.keyLatencyMedian, 2)} ms over ${f.keyLatencies.length} keys` : null,
  },
  {
    id: 'key.no_rollover', tier: 2, category: 'keyboard', weight: 15,
    description: 'Never presses the next key before releasing the previous one over a long typing run.',
    test: (f) =>
      f.typedKeys >= 40 && f.rolloverFrac === 0 ? `0 overlapping keys in ${f.typedKeys} keystrokes` : null,
  },
];

export function evaluateRules(f: Features, cfg: RuleConfig = {}): RuleHit[] {
  const off = new Set(cfg.disabled ?? []);
  const exp = new Set(cfg.experimental ?? []);
  const hits: RuleHit[] = [];
  for (const r of RULES) {
    if (off.has(r.id)) continue;
    if (r.experimental && !exp.has(r.id) && !exp.has('all')) continue;
    let ev: string | null = null;
    try { ev = r.test(f); } catch { ev = null; }
    if (ev === null) continue;
    hits.push({ id: r.id, tier: r.tier, category: r.category, weight: cfg.weights?.[r.id] ?? r.weight, evidence: ev });
  }
  // vm profile supersedes the plain software-renderer rule
  if (hits.some((h) => h.id === 'env.agent_vm_profile')) {
    return hits.filter((h) => h.id !== 'env.software_renderer');
  }
  return hits;
}

export function ruleCatalog() {
  return RULES.map(({ id, tier, category, weight, description, experimental }) => ({ id, tier, category, weight, description, experimental: !!experimental }));
}

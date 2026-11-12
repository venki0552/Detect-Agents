# Calibration

The shipped thresholds are informed by motor-control research, tool defaults (for example xdotool's 12 ms typing delay) and our own attack harness. **They have not been measured against real customers.** Do this before any verdict blocks or steps up a real person.

## 1. Run in shadow mode

- Deploy the collector and server, but make the bank's API ignore the decision (always proceed).
- Log every decision through `onDecision` (sid, action, decision, verdict, score, rule ids). Don't log raw traces unless your privacy review allows it.
- Keep `exposeReasons: false`.

## 2. Collect enough real sessions

At least **1,000 sessions per device class**, with consent where required:

| Class | Why it matters |
|---|---|
| Mouse (Windows, macOS) | Baseline for motion rules |
| Trackpad (macOS especially) | May report few coalesced samples (`mot.no_coalesced`) |
| Touch (phones, tablets) | No mouse moves; tap holds differ |
| Keyboard-only | No pointer at all |
| Screen readers (JAWS, NVDA, VoiceOver) | Keyboard/AT activation, `detail === 0` |
| Voice control / dictation (Dragon, OS dictation) | Text without keystrokes |
| IME users (Chinese, Japanese, Korean, Telugu, Hindi…) | Composition events, `keyCode 229` |
| Remote desktop / VDI (common inside banks) | Software rendering, jumpy pointer |
| Password-manager users | Autofill bursts |

## 3. Measure each rule

For every rule, compute **firing rate on human sessions** per device class.

| Rule type | Target on humans |
|---|---|
| Tier 1 | **0%** (any human hit is a bug in the rule) |
| Tier 2 | **≤ 0.1%** per rule, per device class |
| Overall `agent` verdict | ≤ 0.01% on high-sensitivity actions |
| Overall `suspect` | Track it: it turns into step-ups, which is friction |

If a rule misses its target: tighten the threshold, add an exclusion, lower its weight, or make it device-class specific. Then re-run the attack harness (`npm run attack`) to see how much detection you gave up.

## 4. Re-run on every change

- Every threshold change: unit tests, sweep, attack harness, and a replay of logged human traces.
- Every major agent release (Claude in Chrome, Gemini in Chrome, browser-use…): re-run the harness and update `agentMarkers`.

## 5. Experimental rules

`key.instant_delivery` ships off. To evaluate it, enable it in shadow mode only:

```ts
createAgentDetect({ ..., scoreConfig: { experimental: ['key.instant_delivery'] } });
```

Compare the keydown latency distribution (`features.keyLatencies`) of human sessions with the DevTools-Protocol baseline (0.1–1.2 ms, median 0.3 ms).

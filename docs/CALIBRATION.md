# Calibration

The shipped thresholds are informed by motor-control research, tool defaults (for example xdotool's 12 ms typing delay) and our own attack harness. **They have not been measured against real customers.** Do this before any verdict blocks or steps up a real person.

## 1. Run in shadow mode

- Deploy the collector and server, but make the bank's API ignore the decision (always proceed). A built-in `mode: 'shadow'` does not exist yet (roadmap P0); today this is a switch in your API.
- Log every decision through `onDecision` (session id, action, sensitivity, decision, verdict, score, rule ids, `scope`, token id, drop counters). Don't log raw traces unless your privacy review allows it.
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
| Remote desktop / VDI (common inside banks) | Software rendering, jumpy pointer, window occlusion (`evt.input_while_hidden`) |
| Password-manager users (native **and** extension: 1Password, Bitwarden, LastPass, Dashlane) | Autofill bursts; extensions fill with script events (`evt.untrusted` unless the field is recognised) |
| Users of assistive or productivity extensions that click by script (keyboard-navigation, voice-control, form fillers) | Tier 1 `evt.untrusted` today (open question D28) |
| Ad-blocker users | Collector requests may be blocked → no telemetry → step-up |

## 3. Measure each rule

For every rule, compute **firing rate on human sessions** per device class.

| Rule type | Target on humans |
|---|---|
| Tier 1 | **0%** (any human hit is a bug in the rule) |
| Tier 2 | **≤ 0.1%** per rule, per device class |
| Overall `agent` verdict | ≤ 0.01% on high-sensitivity actions |
| Overall `suspect` | Track it: it turns into step-ups, which is friction |
| Overall `unknown` at decision time | Track it per action and per device class: since v0.3 `human` needs testable evidence, so short sessions, touch sessions and low-typing keyboard sessions are `unknown` and step up on `high` |
| Verdicts with `scope: 'recent'` | Track separately: the last-8-actions pass runs rules on small samples and has never been measured on real people |
| `dropped.future` / `dropped.stale` > 0 on honest sessions | Should be rare; if not, the clock windows (5 s / 10 s) are too tight for your network |

Three v0.3 mechanisms are uncalibrated and should be the first things you measure: the evidence floor (`minPointerClicks` 5, `minKeyIntervals` 20), the recent-window pass (`tailActions` 8), and the one-keydown-per-`insertText` accounting.

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

## 6. Before shadow mode: capture a few real sessions locally

This is not calibration (that needs hundreds of people per device class). It is the first sanity check that a real person on real hardware is not flagged, and it gives the first hardware baselines the rules have never had.

```bash
npm run demo:capture        # prints every decision, saves each session's trace to captures/
# then, in your normal Chrome (not automated, DevTools closed):
#   http://127.0.0.1:8787/?fresh=1&label=mouse-normal
npm run replay              # re-score everything in captures/ with the current rules
```

`?fresh=1` starts a new session; `label` names the capture. Each "Refresh balance" click and each "Review & send" saves a file. Suggested sessions, a minute or two each:

| Label | Do this |
|---|---|
| `mouse-normal` / `trackpad-normal` | Use the page as you would: refresh the balance, pick a payee, type amount, date and memo, send |
| `quick` | Go straight to the form: one or two clicks and a short amount, send |
| `long` | Five minutes of ordinary use (scroll the activity list, correct typos, change your mind), then send |
| `keyboard-only` | Tab, type, Enter. No pointer |
| `password-manager`, `dictation`, `ime` | Only if you normally use them |

Write down with each one: mouse or trackpad (and the mouse's polling rate if known), any browser extensions enabled, operating system. `captures/` is git-ignored: it holds a real person's behavioural timing. Never commit it or send it anywhere.

What to look at first: the share of pointer moves with more than one coalesced sample (the `mot.no_coalesced` baseline), mouse and key hold medians, and keydown delivery latency (the baseline `key.instant_delivery` is waiting for).

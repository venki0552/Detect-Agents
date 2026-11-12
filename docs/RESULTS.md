# Measured results

All numbers come from this repo's own harness. They show what the rules catch; they do **not** establish false-positive rates on real customers. Only calibration on real human sessions can do that (see `CALIBRATION.md`).

## 1. Real browser automation (`npm run attack`)

Environment: Chromium 141 via Playwright 1.56, Linux container without a GPU (so `env.software_renderer` fires in every run; ignore it). Scenarios with random input were repeated at least 5 times.

| # | Scenario | Decision on a transfer | Verdict | Rules that fired (excluding software renderer) |
|---|---|---|---|---|
| A | Stock Playwright, headless, `click`/`fill`/`selectOption`/`type` | **block** | agent (100) | `env.webdriver`, `env.headless_ua`, `evt.untrusted` (`selectOption` dispatches untrusted input), `env.agent_vm_profile` |
| B | Stealth flags (`--disable-blink-features=AutomationControlled`, real UA) + xdotool-style input: frozen pointer, single-jump moves, instant clicks, 12 ms typing | **step_up** | agent (88–95), 10/10 runs | `mot.jump_arrival`, `tim.fixed_hold`, `tim.still_gaps`, `key.metronome`, `key.fixed_hold` |
| C | Stealth + humanized input: Bezier paths, eased timing, off-centre clicks, uniform random delays | **step_up** | suspect (66) in 11/12 runs, agent (78) once | `mot.no_coalesced`, `tim.uniform_random_holds` or `key.uniform_random`, `key.no_rollover` |
| D | Script injection: `element.click()`, value + `dispatchEvent` | **block** | agent (100) | `evt.untrusted` |
| E | DOM agent that fills every text field | **block** | agent (100) | `dom.canary`, `evt.text_without_keys` |
| F | Typing into a background tab | allow | **inconclusive** | Playwright emulates focus and visibility, so the tab never became hidden. Unit-tested only |
| G | Humanized (C) + highlight overlay injected via DevTools Protocol (`innerHTML`) | **step_up** | agent (82–88), 5/5 | C's rules + `dom.injected_html` (no source file), `dom.foreign_nodes` |
| H | Humanized (C) + MV3 extension drawing overlays (isolated + main world) | **step_up** | agent (74–88), 5/5 | C's rules + `dom.injected_html` (by `chrome-extension`), `dom.foreign_nodes` |

What this shows:
- **Anything automation-flagged or script-driven** (A, D, E) is stopped outright.
- **Non-humanized OS-style input** (B) is reliably `agent`.
- **A carefully humanized agent** (C) usually lands on `suspect`, which still forces step-up on money movement. Page-injection signals (G, H) push it to `agent`.

## 2. Synthetic sweep (`npm run sweep`, 300–500 seeds per profile)

| Profile | human | suspect | agent |
|---|---|---|---|
| Human, mouse | 100% | 0% | 0% |
| Human, trackpad (few coalesced samples) | 100% | 0% | 0% |
| Keyboard-only / screen reader | 100% | 0% | 0% |
| Human + password-manager autofill | 100% | 0% | 0% |
| Human using voice dictation | 0% | 100% | 0% |
| xdotool screenshot loop | 0% | 0% | 100% |
| pyautogui (linear tween, fixed typing) | 0% | 0% | 100% |
| Humanized agent (Bezier + uniform random delays) | ~0.3% | ~5% | ~95% |
| CDP DOM agent | 0% | 0% | 100% |

**Caveat:** the synthetic humans (`test/unit/traces.ts`) were written by the same author as the rules. A 0% false-positive figure here is a sanity check that the rules are internally consistent, **not** evidence about real users.

## 3. Signal probes (`bench/probe-signals.mjs`, `bench/probe-ext.mjs`)

| Probe | Result | Used? |
|---|---|---|
| Trusted Types report-only + Playwright `evaluate` doing `innerHTML` | Violation reported, `sourceFile` empty | Yes: `dom.injected_html` |
| Trusted Types + MV3 main-world content script doing `innerHTML` | Violation reported, `sourceFile` = `chrome-extension` (no id) | Yes |
| Trusted Types + MV3 isolated-world content script doing `innerHTML` | **No** violation (isolated worlds are exempt from page CSP) | Covered instead by `dom.foreign_nodes` |
| `:autofill` after Playwright `fill()` | `false` | Yes: separates autofill from CDP fill |
| `VisibilityStateEntry` | Present in Chromium 141 | Yes: hidden-period timeline |
| Event Timing `interactionId` for DevTools-Protocol input | Real ids assigned (e.g. 4720, 4734) | **No**: not a separator |
| Keydown delivery latency (`performance.now() − event.timeStamp`) under DevTools Protocol | 0.1–1.2 ms, median 0.3 ms (n=43) | Experimental, off, until there's a human baseline |
| `env.cdp_runtime` console-serialisation trick | Never fired on Chromium 141 | Kept for older browsers; likely dead |
| WebMCP `SubmitEvent.agentInvoked` | Not present in Chromium 141 (needs 146+ with a flag) | Feature-detected, unit-tested only |

## 4. Main-thread cost (`npm run bench`)

| What | Cost |
|---|---|
| Per pointermove | ~0.3–2 µs |
| Per keystroke | ~0.5–1.5 µs |
| Per click | ~10–17 µs (one `getBoundingClientRect`) |
| Synchronous init | under 1 ms (was 6–18 ms before environment checks moved to a background task) |
| Environment checks | one background-priority task, lands ~20–100 ms after init |
| Batch serialisation | ~0.02 ms |
| In-browser debug scoring (`onLocalScore`, off in production) | ~0.5–5 ms |

Measured on a fast container with synthetic events; expect several times slower on low-end phones. That's still microseconds per event.

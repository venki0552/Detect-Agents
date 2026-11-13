# Measured results

All numbers come from this repo's own harness. They show what the rules catch; they do **not** establish false-positive rates on real customers. Only calibration on real human sessions can do that (see `CALIBRATION.md`).

Every table says which browser and machine produced it. Results differ between browser versions (see §3), so never quote a number without its environment.

## 1. Real browser automation (`npm run attack`)

### v0.3 — 2026-11-12

Environment: **Chrome for Testing 158.0.8127.18**, driven by Playwright 1.56.0 through `CHROMIUM_PATH` (the bundled build for that Playwright version was not installed), macOS on Apple silicon **with a GPU** (so `env.software_renderer` does not fire). Demo bank with session binding and transaction-bound tokens. Scenarios with random input were run 6 times (one full run plus five repeats, the repeats in parallel).

| # | Scenario | Decision on a transfer | Verdict | Rules that fired |
|---|---|---|---|---|
| A | Stock Playwright, headless, `click`/`fill`/`selectOption`/`type` | **block** | agent (100) | `env.webdriver`, `env.headless_ua`, `evt.untrusted` |
| B | Stealth flags + xdotool-style input: frozen pointer, single-jump moves, instant clicks, 12 ms typing | **step_up** | agent (92), 6/6 | `mot.jump_arrival`, `tim.fixed_hold`, `tim.still_gaps`, `key.metronome`, `key.fixed_hold` |
| C | Stealth + humanized input: Bezier paths, eased timing, off-centre clicks, **uniform** random delays | **step_up** | suspect (61–64) 5/6, agent (75) once | `mot.no_coalesced`, `tim.uniform_random_holds` or `key.uniform_random`, `key.no_rollover` |
| D | Script injection: `element.click()`, value + `dispatchEvent` | **block** | agent (100) | `evt.untrusted` |
| E | DOM agent that fills every text field | **block** | agent (100) | `dom.canary`, `evt.text_without_keys` |
| F | Typing into a background tab | step_up | unknown — **inconclusive** | Playwright emulates focus and visibility, so the tab never became hidden. Unit-tested only. (It steps up because 2 clicks and 6 keys are too little evidence for `human`.) |
| G | Humanized (C) + highlight overlay injected via DevTools Protocol (`innerHTML`) | **step_up** | agent (80–87), 6/6 | C's rules + `dom.injected_html` (no source file), `dom.foreign_nodes` |
| H | Humanized (C) + MV3 extension drawing overlays (isolated + main world) | **step_up** | **suspect (51–68), 6/6** | C's rules + `dom.foreign_nodes`. `dom.injected_html` did **not** fire: see §3 |
| I | Short robotic session: 2 teleport clicks with instant release, 12 ms typing | **step_up** | unknown (0), 6/6. After `mot.teleport_press` was switched on (D37): **suspect (45)**, 1 run | Originally none: too few samples for any statistical rule. Now `mot.teleport_press`. Before v0.3 this pattern scored `human` in the unit reproduction |
| J | A token for the same action and the same transfer, minted in another session, presented to the API | **refused** (`binding`), 5/5 | n/a | `authorize()` session-binding check |

What this shows:
- **Anything automation-flagged or script-driven** (A, D, E) is stopped outright.
- **Non-humanized OS-style input** (B) is reliably `agent`.
- **A humanized agent using uniform random delays** (C) lands on `suspect`, which forces step-up on money movement. An injected overlay (G) pushes it to `agent`.
- **Too little evidence is not `human`** (I), and a token cannot be moved between sessions (J).

What this does **not** show:
- **A humanized agent with log-normal delays and key rollover.** In the unit reproduction it scores `human` (35, only `mot.no_coalesced`). It is not in this harness as a passing scenario because it does not pass. See `THREAT-MODEL.md` and `DECISIONS.md` D13.
- **Any OS-level input tool, or any agent product other than the one measured below.** Every scenario in this table is Playwright driving the DevTools Protocol.
- **Any human in this table.** One real person was measured separately (below); that is one person.

### A real agent in a real browser — 2026-11-12

Not Playwright. **Claude in Chrome** (the browser extension, driven by Claude Code) operating the user's own **Google Chrome 157.0.8103.51** on macOS, on the demo bank in capture mode (`npm run demo:capture`). One machine, two runs: an observation, not a rate.

| Run | What the agent did | Decision on the transfer | Verdict | Rules that fired |
|---|---|---|---|---|
| 1 | Its normal tools: click, type, and its form-fill tool for the payee `<select>` | **block** | agent (100) | `evt.untrusted` (the form-fill tool dispatches an `input` event with `isTrusted=false`), plus everything in run 2 |
| 2 | Mouse and keyboard only | **step_up** | agent (83) | `mot.jump_arrival` 5/5, `tim.fixed_hold` (median 1.4 ms), `key.fixed_hold` (median 0 ms), `key.no_rollover` (0/44), `dom.foreign_nodes` (1 `div`) |

What the raw trace showed (run 2):

| Signal | Measured |
|---|---|
| Environment | Clean: no webdriver flag, no automation globals, no tampering, real GPU. As the threat model predicted, nothing in `env` gives it away |
| Pointer | Exactly **one** `pointermove` per click, then the press. 1 coalesced sample |
| Button hold | 1–3 ms |
| Click position | Within 3 px of the target centre, not exactly on it (2 of 5 within 1.5 px, so `mot.centred_clicks` did not fire) |
| Typing | Key intervals: median **0.1 ms**, 90th percentile 0.2 ms. Key hold: 0 ms. `key.metronome` did **not** fire: the pauses between fields make the interval CV large (4.45) |
| Keydown delivery latency | 0–0.7 ms, median 0.2 ms (the experimental `key.instant_delivery` rule would have fired; it is off) |
| Page integrity | One foreign `div` 12–17 ms after load (an extension-injected node). No Trusted Types report |
| Honeypots | Not touched. They are `aria-hidden`, and the agent's page reader did not list them |

Reading it: this agent makes no attempt to look human, and is caught by four independent behaviours. That is the easy case. It says nothing about an agent that humanizes its input, and one run of one product on one machine is not a detection rate.

### A real human in a real browser — 2026-11-12

The first human ever measured against these rules: the maintainer, by hand, in the same Chrome 157 on the same Mac (Apple M5 Max, 1920×1080 display), using a mouse and keyboard on the demo in capture mode. **One person, two short sessions. It is a sanity check and a first baseline, not a false-positive rate.**

| Session | Evidence | Decision on the transfer | Verdict | Rules that fired |
|---|---|---|---|---|
| 1 | 6 mouse clicks, 2 typed keys, 145 → 485 pointer moves | **allow** | human (0), later human (35) | `mot.no_coalesced` once the session passed 150 moves |
| 2 | 6 → 8 mouse clicks, 17 typed keys, 185 → 346 moves | **allow** | human (35), later human (0) | `mot.no_coalesced` at 185 moves; not at 258 or 346 |

Human next to agent, same browser, same machine, same page:

| Signal | Human (this person) | Claude in Chrome | Separates? |
|---|---|---|---|
| Mouse button hold | 79–135 ms (median ~100) | 1–3 ms | Yes, by two orders of magnitude |
| Pointer moves in the 500 ms before a click | 3–24 | 1 | Yes |
| Arrival at the click | Travelled there, 0/6 jumps | 5/5 single jumps | Yes |
| Click offset from target centre | 8–324 px | 0–3 px | Yes |
| Key hold | 55–137 ms (median 82) | 0 ms | Yes |
| Key interval | median 284 ms | median 0.1 ms | Yes |
| Key rollover | 7% of pairs | 0% | Weak (few keys) |
| **Keydown delivery latency** | **1.4–13 ms, median 2.3 (n = 17)** | **0–0.7 ms, median 0.2 (n = 44)** | **Yes, no overlap.** First hardware baseline for the experimental `key.instant_delivery` rule (threshold 0.5 ms): it would not have fired on the human and did fire on the agent |
| **Pointer moves carrying > 1 coalesced sample** | **1.4%–2.3%** (events at ~76 Hz) | 0% (5 moves) | **No.** See below |
| Foreign DOM nodes | none | one `div` | The node appears only while the extension is acting on the tab |

Two findings from this one session:

1. **`mot.no_coalesced` fires on a real human on this hardware.** Its premise is that hardware mice deliver several samples per frame. This person's mouse delivered one sample per event 98% of the time, so the session sat right on the rule's 2% threshold and flipped in and out as moves accumulated (1.4% of 485: fired; 1.6% of 185: fired; 2.3% of 258: not; 2.0% of 346: not). Alone it is 35 points, below `suspect`, and the verdict stayed `human`. Together with any other Tier 2 hit (a benign extension's node, software rendering, a careful typist with no rollover) it would have been `suspect`, a step-up. This is the only rule that catches a well-humanized agent, and on this device it does not separate humans from agents. Open question D32.
2. **A real click on a native `<select>` produces a 0 ms button "hold".** The page receives `mousedown` and `mouseup` with the same timestamp when the OS popup opens. Fixed the same day (D31): presses on `<select>` are no longer recorded as holds. Before the fix a form with several dropdowns could have pushed a person's median hold under the `tim.fixed_hold` limit.

### One agent click at the end of a human session — 2026-11-12

The case that matters most, observed for real. The maintainer filled the transfer form by hand, then opened the Claude in Chrome side panel and asked it to click "Review & send". **The transfer was allowed: verdict `human`, score 12.**

What the trace held for that one click:

| | |
|---|---|
| Pointer | The person's mouse left the page at the top edge. 40 s later a single `pointermove` landed on the button, flagged as a re-entry |
| Press | 1 ms after that move; released 1 ms later |
| Position | 0.3 px from the button's exact centre |
| Page | A foreign `div` appeared 6 s before the click (the extension's indicator: no id, no class, no attributes, a closed shadow root, so it cannot be named) |
| Window | Lost focus when the person went to the side panel; regained it 1 ms before the press |

Why nothing fired: every behavioural rule is a statistic over 3–5 or more samples, and the recent-window pass looks at the last 8 actions, 7 of which were the person's. `mot.jump_arrival` also exempts a pointer that re-enters the page, which is exactly what the agent's move looked like after the person's mouse had left.

Re-scored with the new rule `mot.teleport_press` (one click with no pointer travel and no button hold; experimental at first, on by default since D37):

| Capture | Before | With `mot.teleport_press` on |
|---|---|---|
| Human fills the form, agent clicks send | allow (human, 12) | **step_up** (suspect, 52) |
| The person's own sessions (6 captures, 17 mouse clicks) | allow | allow, rule did not fire |
| Claude in Chrome driving alone (2 transfers, 10 clicks) | block / step_up | same; rule fired on all 10 clicks |
| Synthetic sweep, 500 seeds each: mouse, trackpad, long, keyboard-only, autofill, dictation | — | 0 fires in 3,000 sessions |

**The Chrome banner** ("… started debugging this browser") is drawn by the browser outside the page; page JavaScript cannot see it (D7). The extension's own in-page node can be seen but not identified, and many benign extensions add nodes of the same shape. The click is the evidence, not the banner.

### v0.2 — 2026-11-12 (earlier the same day, different environment)

Environment: Chromium 141 via Playwright 1.56, Linux container **without a GPU** (`env.software_renderer` fired in every run and is omitted below). Kept for comparison; A–G agree with v0.3.

| # | Decision | Verdict | Difference from v0.3 |
|---|---|---|---|
| A | block | agent (100) | Also `env.agent_vm_profile` (software GPU, Linux, small screen) |
| B | step_up | agent (88–95), 10/10 | Same rules |
| C | step_up | suspect (66) 11/12, agent (78) once | Same rules; scores include the software-renderer weight |
| D, E | block | agent (100) | Same |
| F | allow | inconclusive | Was `allow`: under the old floor 8 interactions were enough for `human` |
| G | step_up | agent (82–88), 5/5 | Same |
| H | step_up | **agent (74–88), 5/5** | `dom.injected_html` fired with source `chrome-extension`. It no longer does on Chrome 158 |

## 2. Synthetic sweep (`npm run sweep`, 500 seeds per profile) — v0.3

| Profile | human | unknown | suspect | agent |
|---|---|---|---|---|
| Human, mouse (14 actions) | 100% | 0% | 0% | 0% |
| Human, trackpad (few coalesced samples) | 100% | 0% | 0% | 0% |
| Human, long session (40 actions) | 100% | 0% | 0% | 0% |
| **Human, short session (3 actions)** | 45.8% | **54.2%** | 0% | 0% |
| Human session, then an xdotool-style agent takes over | 0% | 0% | 0% | **100%** |
| Keyboard-only / screen reader | 99.2% | 0.8% | 0% | 0% |
| Human + password-manager autofill (native) | 100% | 0% | 0% | 0% |
| Human using voice dictation | 0% | 0% | 100% | 0% |
| xdotool screenshot loop | 0% | 0% | 0% | 100% |
| pyautogui (linear tween, fixed typing) | 0% | 0% | 0% | 100% |
| Humanized agent (Bezier + **uniform** random delays) | 0% | 0% | 4.4% | 95.6% |
| CDP DOM agent | 0% | 0% | 0% | 100% |

Reading it:
- The **short-session row is the cost of the v0.3 evidence floor** (D14): more than half of 3-action sessions are `unknown`, which means a step-up on `high` actions. Before v0.3 they were `human`.
- The **takeover row is the v0.3 recent-window pass** (D15). Before v0.3 this profile was `human`.
- Additional reproductions on the pre-v0.3 code, now unit tests: a 300-action human session passed through the server's stream caps scored `suspect` (67) because evicted pointer history was read as teleporting (now `human`); a complete 60 s human trace posted in one request was accepted and scored `human` (now dropped; decision `step_up`).

**Caveat:** the synthetic humans (`test/unit/traces.ts`) were written by the same author as the rules. A 0% false-positive figure here is a sanity check that the rules are internally consistent, **not** evidence about real users.

## 3. Signal probes

| Probe | Result | Browser | Used? |
|---|---|---|---|
| Trusted Types report-only + Playwright `evaluate` doing `innerHTML` | Violation reported, `sourceFile` empty | Chromium 141, Chrome 158 | Yes: `dom.injected_html` |
| Trusted Types + MV3 **main-world** content script doing `innerHTML` | Violation reported, `sourceFile` = `chrome-extension` (no id) | Chromium 141 | Yes |
| Same probe | **No violation reported at all** (the script ran: its node is in the DOM) | **Chrome for Testing 158** | The signal is blind to extensions on this version. Only `dom.foreign_nodes` sees them |
| Trusted Types + MV3 isolated-world content script doing `innerHTML` | No violation (isolated worlds are exempt from page CSP) | Chromium 141, Chrome 158 | Covered instead by `dom.foreign_nodes` |
| 80 `innerHTML` calls by the page's own inline script, then one via `evaluate` | The injected one is still reported; none of the page's are shipped | Chrome 158 | Yes: page-origin reports no longer use up the 50-report budget (v0.3) |
| Touch tap (`touchscreen.tap`, touch-enabled context) | Compatibility `mousedown` and `mouseup` carry the **same timestamp** (hold 0 ms) | Chrome 158 | Yes: `btn.pt = 'touch'` excludes them from hold-time rules (v0.3) |
| Real key press, then DevTools-Protocol `Input.insertText` | The injected text is an `insertText` input event with no keydown of its own | Chrome 158 | Yes: one printable keydown pays for one `insertText` (v0.3) |
| Two overlapping flushes, the first delayed 400 ms | Pre-v0.3 collector: statuses `200, 409` (the delayed batch is rejected and lost). v0.3: `200, 200` | Chrome 158 | Yes: flushes are serialised |
| `:autofill` after Playwright `fill()` | `false` | Chromium 141 | Yes: separates autofill from CDP fill |
| `VisibilityStateEntry` | Present | Chromium 141 | Yes: hidden-period timeline |
| Event Timing `interactionId` for DevTools-Protocol input | Real ids assigned (e.g. 4720, 4734) | Chromium 141 | **No**: not a separator |
| Keydown delivery latency (`performance.now() − event.timeStamp`) under DevTools Protocol | 0.1–1.2 ms, median 0.3 ms (n=43) | Chromium 141 | Experimental, off, until there's a human baseline |
| `env.cdp_runtime` console-serialisation trick | Never fired | Chromium 141, Chrome 158 | Kept for older browsers; likely dead |
| WebMCP `SubmitEvent.agentInvoked` | Not present (needs 146+ with a flag) | Chromium 141 | Feature-detected, unit-tested only |

Not measured, and stated as such where the code relies on it: real password-manager extensions (D21 is based on their published behaviour), real on-screen keyboards on phones, Safari, Firefox, and window occlusion under VDI.

## 4. Cost

### Main thread (`npm run bench`) — v0.3, Chrome 158, Apple M5 Max

| What | Cost |
|---|---|
| Per pointermove | ~0.25 µs |
| Per keystroke (dispatched on an input, including the mask check) | ~0.5 µs |
| Per click (one `getBoundingClientRect`, mask and field checks) | ~3 µs |
| Synchronous init | 0.2–0.4 ms |
| Environment checks | one background-priority task, lands ~7–9 ms after init |
| Batch serialisation | ~0.01 ms |
| In-browser debug scoring (`onLocalScore`, off in production) | 0.2–0.9 ms |
| Bundle (IIFE, minified, gzip) | 13.8 KB (was 11.9 KB in v0.2) |

This machine is several times faster than the v0.2 container (which measured 0.3–2 µs per move, 10–17 µs per click), so the two sets are **not** a before/after comparison. Expect an order of magnitude more on low-end phones; that is still microseconds per event.

### Server

| What | Cost |
|---|---|
| Feature extraction on an adversarial trace at the stream caps | ~10 ms (was 86 ms on a comparable trace before the quadratic paths were removed; a unit test fails above 25 ms) |
| Scoring per `/decide` | Two feature passes (session and recent window) |
| Memory per session, worst case | ~16,500 events, roughly 1.5 MB |

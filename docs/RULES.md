# Rule catalog

From `src/core/rules.ts` (v0.3, 34 rules). Thresholds are in each rule's `test()`; they are **starting points** until calibrated on real human sessions (see `CALIBRATION.md`).

- **Tier 1**: hard evidence; one hit means `agent`, and it is **latched for the rest of the session** (evicting old events cannot erase it).
- **Tier 2**: weights combine as `1 − Π(1 − w/100)`. `agent` needs score ≥ 70 and ≥ 2 categories; `suspect` needs ≥ 40.
- **Experimental**: off unless enabled with `scoreConfig.experimental: ['<id>']` (or `['all']`).

How rules are applied (v0.3):

- **Twice.** Every rule runs on the whole session and again on the **last 8 actions** alone. The worse verdict wins, so a clean history cannot dilute a robotic takeover. A rule's minimum sample has to make sense in an 8-action window.
- **`human` is not "nothing fired".** It needs an environment snapshot and either ≥ 5 mouse/pen clicks or ≥ 20 typing intervals, so that the rules below could have fired. Otherwise the verdict is `unknown`.
- **Eviction-aware.** Once a stream has been trimmed, rules that need it only judge events after the trim point. "No pointer move before this click" is not "teleport" if the moves were evicted.
- **Not evidence:** clicks with `detail === 0` (keyboard, assistive tech), touch clicks, the compatibility mouse events of a touch tap, clicks in masked regions, native autofill, one-time-code fields, IME composition, and script events on credential/identity fields (password managers).

| Rule | Tier | Category | Weight | What it catches | Known false-positive sources |
|---|---|---|---|---|---|
| `env.webdriver` | 1 | automation | decisive | navigator.webdriver is true (WebDriver / CDP automation flag). | None expected for real users (QA testers on test automation only). |
| `env.webdriver_patched` | 1 | automation | decisive | navigator.webdriver was patched (own property, or top frame and fresh iframe disagree) — stealth plugins do this. | None expected. |
| `env.automation_globals` | 1 | automation | decisive | Globals injected by Playwright, Puppeteer, Selenium/ChromeDriver, PhantomJS or Nightmare. | None expected. |
| `env.headless_ua` | 1 | automation | decisive | User agent says HeadlessChrome. | None expected. |
| `evt.untrusted` | 1 | events | decisive | Script-dispatched (isTrusted=false) clicks, keys or input that the app itself did not chain from a real event. Script events on credential/identity fields (password-manager fills) are excluded. Inside masked regions it counts the collector's `script-in-mask` markers instead of events. | **The broadest false-positive surface of any Tier 1 rule.** App code calling `el.click()` or dispatching `input` from a timer or after a fetch (events within 100 ms of a trusted event are ignored). Password managers filling a field that has no `autocomplete` token and is not a password input. **Assistive and productivity extensions that activate controls by script** (keyboard-navigation, voice-control, form-filler extensions). Not measured on real users; open question D28 on whether this should block. |
| `evt.input_while_hidden` | 1 | events | decisive | Keystrokes or text input arrived while the tab was hidden — a human cannot type into a background tab. Uses the browser's visibility timeline when present; the handler-time flag only as a fallback. | Chrome's window-occlusion tracking has marked visible windows as hidden under some VDI/remote software; a user typing there would hit this. Unmeasured: calibrate under VDI before trusting it. |
| `dom.canary` | 1 | dom | decisive | A honeypot element that is invisible and hidden from screen readers was clicked, focused or filled. | Very aggressive autofill extensions (the field is `autocomplete=off`, carries the ignore attributes of 1Password, LastPass, Bitwarden and Dashlane, and `:autofill` fills are excluded). |
| `dom.agent_marker` | 1 | dom | decisive | An element matching a configured agent-overlay selector was injected into the page. | Only as good as the configured selectors. |
| `agent.webmcp_declared` | 1 | declared | decisive (cooperative) | The browser reported an agent acting through WebMCP (SubmitEvent.agentInvoked, toolactivated/toolcancel). Cooperative agent: steps up, never blocks. | Not a false positive: the browser reports a real agent. Routed to the cooperative lane. |
| `env.cdp_runtime` | 2 | automation | 45 | Chrome DevTools Protocol Runtime domain appears active (Playwright/Puppeteer, or a human with DevTools open). | Humans with DevTools open. Likely dead on current Chrome. |
| `env.native_tampered` | 2 | automation | 35 | Native browser functions were replaced by JavaScript (stealth tools; also some privacy extensions). | Anti-fingerprinting / privacy extensions that patch prototypes. |
| `dom.injected_html` | 2 | dom | 40 | Trusted Types (report-only) caught HTML or script injected through a string sink by the DevTools Protocol or a main-world extension script. Needs the CSP report-only header; benign extensions can trigger it too. | Benign extensions that inject HTML from the main world (reports only say `chrome-extension`, never which one); bookmarklets and a developer's console (no source file). **Coverage note:** on Chrome 158 main-world extension scripts produced no report, so this rule only sees DevTools-Protocol injection there. |
| `dom.foreign_nodes` | 2 | dom | 12 | Elements inserted outside the app roots by something other than the app (extensions, agent overlays). Known benign extensions are ignored. | Benign extensions not on the allowlist (grammar tools, coupon tools, translators). Weight is deliberately low. |
| `env.agent_vm_profile` | 2 | environment | 30 | Software GPU + Linux + a small fixed resolution typical of agent VMs/containers (e.g. 1024×768). | Linux users on VMs or old hardware with software rendering at 1024×768/1280×800. |
| `env.software_renderer` | 2 | environment | 12 | Software WebGL renderer (cloud browsers, VMs, remote desktop). | VMs, remote desktop, Citrix/VDI users (common in banks!), GPU blocklisted drivers. |
| `evt.text_without_keys` | 2 | events | 40 | Text inserted as typing (insertText) with no keystroke of its own — CDP insertText / fill(). One printable keydown pays for one insertion; modifier keys and shortcuts pay for none. Dictation does this too. | Voice dictation (lands on `suspect` → step-up). Emoji pickers and text expanders that insert several characters per key press. Autofill, OTP and IME are excluded. |
| `evt.input_while_unfocused` | 2 | events | 35 | Keys or text input while the window did not have focus. | Screen-sharing or remote-assistance tools; input-method candidate windows that take focus on some Linux desktops. |
| `evt.click_while_hidden` | 2 | events | 40 | Clicks delivered while the document was hidden. | Rare; some remote-control tools. |
| `mot.no_coalesced` | 2 | motion | 35 | Hardware mice deliver several samples per frame (getCoalescedEvents > 1); injected input almost never does. | Trackpads and some low-rate mice may report few coalesced samples. **Measured on the first real human (mouse, Mac, Chrome 157): only 1.4%–2.3% of moves carried more than one sample, so this rule fired on a real person.** Its threshold is not valid for that device. Open question D32. |
| `mot.jump_arrival` | 2 | motion | 45 | The pointer arrived at the clicked spot in a single jump (or never moved) instead of travelling there. Only clicks whose pointer history is still in the trace are judged. | Pointer leaving and re-entering the window or a masked region (handled via `re` flag), tablets in mouse mode, remote desktop. **Gap:** a click at a position the pointer never moved to (raw DevTools-Protocol press without a move) is skipped, to avoid convicting window re-activation. |
| `mot.teleport_press` | 2 | motion | 45 · **experimental, off** | On **one** click, the pointer appeared at the target in a single jump (or without ever moving) **and** the button was released within 8 ms of being pressed: no travel and no hold. It needs no pattern, so it covers a single robotic action after a human did everything else. Measured in real Chrome: Claude in Chrome 11/11 clicks, one real human 0/17. | Unknown until measured: trackpad tap-to-click that lands with no pointer travel, remote desktop that delivers a jump and a press/release in one packet, switch-access and dwell tools that both warp the pointer and click instantly. A short hold after real travel does **not** fire; nor does a jump with a normal hold. Off by default until more people are measured (D33). |
| `mot.centred_clicks` | 2 | motion | 35 | Clicks land within 1.5 px of the exact centre of the target, repeatedly. | Very small targets (excluded below 24 px). |
| `mot.ruler_straight` | 2 | motion | 30 | Pointer paths are ruler-straight (path/direct distance ≤ 1.01). | Drawing tablets / pens in absolute mode; rare. |
| `mot.constant_speed` | 2 | motion | 30 | Pointer moves at constant speed (linear tweening) instead of accelerating and braking. | Remote-desktop smoothing; rare. |
| `tim.fixed_hold` | 2 | timing | 35 | Mouse button held for a fixed or near-zero time on every click. Touch taps are excluded (their compatibility mouse events are 0 ms apart by design). | Auto-clicker and dwell-click accessibility tools; touchpad tap-to-click (very short holds). |
| `tim.still_gaps` | 2 | timing | 40 | Long pauses with a frozen pointer, then a precise click — the screenshot → model → act loop. Pauses whose pointer history was evicted are not counted. | Users who click the same spot repeatedly after reading (e.g. "Next"). Requires ≥ 70% of long gaps. |
| `tim.metronome_gaps` | 2 | timing | 20 | Gaps between actions cluster tightly (model-latency band). | Rhythmic workflows (data entry); low weight. |
| `tim.uncaused_scroll` | 2 | timing | 25 | The page scrolled with no wheel, touch, key or drag before it (scrollTo / scrollIntoView by an agent). | App code that scrolls to errors without a click/key nearby; find-in-page. |
| `tim.uniform_random_holds` | 2 | timing | 30 | Hold times look drawn from random(a, b): flat histogram (excess kurtosis < −0.9, \|skew\| < 0.35). Human timing is right-skewed. | Small samples (min 25 mouse / 25 key holds). |
| `key.metronome` | 2 | keyboard | 40 | Keystroke intervals almost constant (xdotool type defaults to 12 ms; Playwright type uses a fixed delay). | Hardware macro keyboards; rare. |
| `key.fixed_hold` | 2 | keyboard | 35 | Keys held for a fixed or near-zero time. | Some on-screen keyboards and switch-access tools; **phone virtual keyboards that send key events back to back** (not measured on real devices). |
| `key.uniform_random` | 2 | keyboard | 35 | Keystroke intervals look drawn from random(a, b): flat histogram instead of right-skewed. | Small samples (min 30 intervals). |
| `key.instant_delivery` | 2 | keyboard | 30 · **experimental, off** | Keydown reaches the page almost instantly after its timestamp (median < 0.5 ms). DevTools Protocol keys measured 0.1–1.2 ms (median 0.3); hardware keys travel the OS input pipeline. Needs a real-human baseline. | Unknown until measured on real hardware. Off by default. |
| `key.no_rollover` | 2 | keyboard | 15 | Never presses the next key before releasing the previous one over a long typing run. | Slow, careful typists. Low weight for that reason. |

## What the rules do not catch

Stated here so nobody reads the table as complete. Details in `THREAT-MODEL.md`.

| Not caught | Why | What covers it |
|---|---|---|
| Humanized agent with log-normal delays, key rollover, curved paths | Only `mot.no_coalesced` (35) is left; one category, below `suspect` | `critical` step-up; per-device calibration (roadmap) |
| Fabricated telemetry fed in real time | The client supplies the data | `critical` step-up, session binding, transaction-bound tokens |
| Touch input of any kind | No touch rules | Sessions are `unknown` → step-up on `high` |
| Keyboard-navigation agents (Tab / Enter) with little typing | Navigation keys are excluded from typing rhythm | Usually `unknown` → step-up on `high` |
| One or two robotic actions after a human filled the form | Below every statistical rule's minimum sample. **Observed for real on 2026-11-12: a person filled the form, Claude in Chrome clicked "Review & send", the transfer was allowed** | `mot.teleport_press` judges a single click and would have stepped it up, but it is experimental and off by default (D33). Otherwise: `critical` on the action |
| Script events timed within 100 ms of a real user event | Treated as app-chained | Roadmap: same-task flag |
| Script fills of credential/identity fields | Exempt so password managers are not convicted | By design (D21) |

## Why these signals work (short version)

| Signal family | Human | Agent |
|---|---|---|
| Event origin | `isTrusted` true, generated by hardware | Script-dispatched events are `isTrusted=false`; DevTools-Protocol input is trusted, so other families are needed |
| Coalesced samples | Mice report at 125–1000 Hz, so several samples land in one frame | Injected moves arrive one at a time |
| Arrival at target | The pointer travels there along a curve, with overshoot and correction | Jumps there in one event, or never moves |
| Click geometry | Off-centre, varies | Dead centre (DOM agents compute the bounding-box centre) |
| Path and speed | Curved, bell-shaped speed (accelerate then brake), tremor | Straight lines, constant speed (linear tweens) |
| Hold times | ~50–150 ms, right-skewed | ~0 ms or fixed; humanizers use `random(a, b)`, which gives a flat histogram |
| Between actions | Continuous micro-movement while reading | Frozen pointer during the screenshot → model → act loop |
| Typing | Irregular, right-skewed intervals, frequent key rollover | Metronome intervals (xdotool defaults to 12 ms), no rollover |
| Page integrity | No HTML injected through string sinks | Overlays injected via DevTools Protocol or main-world extension scripts (Trusted Types reports) |
| Visibility | Can't type into a hidden tab | DevTools Protocol can |

## Adding a rule

See the checklist in `CLAUDE.md` → "Adding or changing a rule". Every rule needs unit tests on the agent it targets **and** on the human, trackpad, keyboard-only, autofill, dictation and IME traces (including a long session that has been through eviction, and the 8-action recent window), a sweep run, a real-browser scenario with the browser version recorded, an entry in this file with its false-positive sources, and a dated entry in `DECISIONS.md`.

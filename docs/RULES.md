# Rule catalog

Generated from `src/core/rules.ts` (v0.2, 33 rules). Thresholds are in each rule's `test()`; they are **starting points** until calibrated on real human sessions (see `CALIBRATION.md`).

- **Tier 1**: hard evidence; one hit means `agent`.
- **Tier 2**: weights combine as `1 − Π(1 − w/100)`. `agent` needs score ≥ 70 and ≥ 2 categories; `suspect` needs ≥ 40.
- **Experimental**: off unless enabled with `scoreConfig.experimental: ['<id>']` (or `['all']`).

| Rule | Tier | Category | Weight | What it catches | Known false-positive sources |
|---|---|---|---|---|---|
| `env.webdriver` | 1 | automation | decisive | navigator.webdriver is true (WebDriver / CDP automation flag). | None expected for real users (QA testers on test automation only). |
| `env.webdriver_patched` | 1 | automation | decisive | navigator.webdriver was patched (own property, or top frame and fresh iframe disagree) — stealth plugins do this. | None expected. |
| `env.automation_globals` | 1 | automation | decisive | Globals injected by Playwright, Puppeteer, Selenium/ChromeDriver, PhantomJS or Nightmare. | None expected. |
| `env.headless_ua` | 1 | automation | decisive | User agent says HeadlessChrome. | None expected. |
| `evt.untrusted` | 1 | events | decisive | Script-dispatched (isTrusted=false) clicks, keys or input that the app itself did not chain from a real event. | App code calling `el.click()` outside a real event handler. Events within 100 ms of a trusted event are ignored to cover the common case. |
| `evt.input_while_hidden` | 1 | events | decisive | Keystrokes or text input arrived while the tab was hidden — a human cannot type into a background tab. | None expected; a human cannot type into a hidden tab. |
| `dom.canary` | 1 | dom | decisive | A honeypot element that is invisible and hidden from screen readers was clicked, focused or filled. | Very aggressive autofill extensions (field is `autocomplete=off`, ignored by 1Password/LastPass attributes, and `:autofill` fills are excluded). |
| `dom.agent_marker` | 1 | dom | decisive | An element matching a configured agent-overlay selector was injected into the page. | Only as good as the configured selectors. |
| `agent.webmcp_declared` | 1 | declared | decisive (cooperative) | The browser reported an agent acting through WebMCP (SubmitEvent.agentInvoked, toolactivated/toolcancel). Cooperative agent: steps up, never blocks. | Not a false positive: the browser reports a real agent. Routed to the cooperative lane. |
| `env.cdp_runtime` | 2 | automation | 45 | Chrome DevTools Protocol Runtime domain appears active (Playwright/Puppeteer, or a human with DevTools open). | Humans with DevTools open. Likely dead on current Chrome. |
| `env.native_tampered` | 2 | automation | 35 | Native browser functions were replaced by JavaScript (stealth tools; also some privacy extensions). | Anti-fingerprinting / privacy extensions that patch prototypes. |
| `dom.injected_html` | 2 | dom | 40 | Trusted Types (report-only) caught HTML or script injected through a string sink by the DevTools Protocol or a main-world extension script. Needs the CSP report-only header; benign extensions can trigger it too. | Benign extensions that inject HTML from the main world (reports only say `chrome-extension`, never which one). Requires the report-only header. |
| `dom.foreign_nodes` | 2 | dom | 12 | Elements inserted outside the app roots by something other than the app (extensions, agent overlays). Known benign extensions are ignored. | Benign extensions not on the allowlist (grammar tools, coupon tools, translators). Weight is deliberately low. |
| `env.agent_vm_profile` | 2 | environment | 30 | Software GPU + Linux + a small fixed resolution typical of agent VMs/containers (e.g. 1024×768). | Linux users on VMs or old hardware with software rendering at 1024×768/1280×800. |
| `env.software_renderer` | 2 | environment | 12 | Software WebGL renderer (cloud browsers, VMs, remote desktop). | VMs, remote desktop, Citrix/VDI users (common in banks!), GPU blocklisted drivers. |
| `evt.text_without_keys` | 2 | events | 40 | Text inserted as typing (insertText) with no keystroke before it — CDP insertText / fill(). Dictation does this too. | Voice dictation (lands on `suspect` → step-up). Autofill, OTP and IME are excluded. |
| `evt.input_while_unfocused` | 2 | events | 35 | Keys or text input while the window did not have focus. | Screen-sharing or remote-assistance tools; rare. |
| `evt.click_while_hidden` | 2 | events | 40 | Clicks delivered while the document was hidden. | Rare; some remote-control tools. |
| `mot.no_coalesced` | 2 | motion | 35 | Hardware mice deliver several samples per frame (getCoalescedEvents > 1); injected input almost never does. | Trackpads and some low-rate mice may report few coalesced samples. Must be calibrated per device class. |
| `mot.jump_arrival` | 2 | motion | 45 | The pointer arrived at the clicked spot in a single jump (or never moved) instead of travelling there. | Pointer leaving and re-entering the window (handled via `re` flag), tablets in mouse mode, remote desktop. |
| `mot.centred_clicks` | 2 | motion | 35 | Clicks land within 1.5 px of the exact centre of the target, repeatedly. | Very small targets (excluded below 24 px). |
| `mot.ruler_straight` | 2 | motion | 30 | Pointer paths are ruler-straight (path/direct distance ≤ 1.01). | Drawing tablets / pens in absolute mode; rare. |
| `mot.constant_speed` | 2 | motion | 30 | Pointer moves at constant speed (linear tweening) instead of accelerating and braking. | Remote-desktop smoothing; rare. |
| `tim.fixed_hold` | 2 | timing | 35 | Mouse button held for a fixed or near-zero time on every click. | Auto-clicker and dwell-click accessibility tools; touchpad tap-to-click (very short holds). |
| `tim.still_gaps` | 2 | timing | 40 | Long pauses with a frozen pointer, then a precise click — the screenshot → model → act loop. | Users who click the same spot repeatedly after reading (e.g. "Next"). Requires ≥ 70% of long gaps. |
| `tim.metronome_gaps` | 2 | timing | 20 | Gaps between actions cluster tightly (model-latency band). | Rhythmic workflows (data entry); low weight. |
| `tim.uncaused_scroll` | 2 | timing | 25 | The page scrolled with no wheel, touch, key or drag before it (scrollTo / scrollIntoView by an agent). | App code that scrolls to errors without a click/key nearby; find-in-page. |
| `tim.uniform_random_holds` | 2 | timing | 30 | Hold times look drawn from random(a, b): flat histogram (excess kurtosis < −0.9, \|skew\| < 0.35). Human timing is right-skewed. | Small samples (min 25 mouse / 25 key holds). |
| `key.metronome` | 2 | keyboard | 40 | Keystroke intervals almost constant (xdotool type defaults to 12 ms; Playwright type uses a fixed delay). | Hardware macro keyboards; rare. |
| `key.fixed_hold` | 2 | keyboard | 35 | Keys held for a fixed or near-zero time. | Some on-screen keyboards and switch-access tools. |
| `key.uniform_random` | 2 | keyboard | 35 | Keystroke intervals look drawn from random(a, b): flat histogram instead of right-skewed. | Small samples (min 30 intervals). |
| `key.instant_delivery` | 2 | keyboard | 30 · **experimental, off** | Keydown reaches the page almost instantly after its timestamp (median < 0.5 ms). DevTools Protocol keys measured 0.1–1.2 ms (median 0.3); hardware keys travel the OS input pipeline. Needs a real-human baseline. | Unknown until measured on real hardware. Off by default. |
| `key.no_rollover` | 2 | keyboard | 15 | Never presses the next key before releasing the previous one over a long typing run. | Slow, careful typists. Low weight for that reason. |

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

See the checklist in `CLAUDE.md` → "Adding or changing a rule". Every rule needs unit tests on the agent it targets **and** on the human, trackpad, keyboard-only, autofill, dictation and IME traces, a sweep run, a real-browser scenario, and an entry in this file with its false-positive sources.

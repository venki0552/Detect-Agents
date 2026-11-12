# Threat model

## What we protect

High-risk actions in a signed-in session (money movement, payee changes, password and profile changes) from being performed by an AI agent or automation **without the account holder's live approval**.

We are *not* trying to block all agents. Users will increasingly delegate to agents on purpose. The goal is that an agent can't move money or change the account unless a human passes a step-up check.

## The honest summary

Read this before the tables.

1. **Everything the detector knows comes from a browser the attacker may control.** The server validates it, clocks it and refuses to forget it, but it cannot make it true. A patient attacker who talks to the endpoints directly can feed a fabricated human session in real time and receive a `human` verdict.
2. **A well-humanized agent is also `human` today.** With log-normal delays, overlapping key presses and curved paths, the only rule left is `mot.no_coalesced` (weight 35), which is below the `suspect` line on purpose (trackpads). Measured on a synthetic trace: `human`, score 35.
3. **So the verdict is a risk signal, not an authorization.** It decides *how much friction* an action gets. The control that holds against 1 and 2 is the one that does not depend on client data: **`critical` actions always require the account holder's passkey, bound to the exact transaction.**
4. **What the detector is good at:** agents that do not try to hide (the large majority of agent traffic), automation frameworks, script-driven extensions, screenshot loops with tool defaults, and an agent taking over a session a human started. Those are caught reliably in our harness. It raises the cost of everything else.

If you classify money movement as `high` instead of `critical`, you are accepting points 1 and 2 as residual risk.

## Attackers and how each layer covers them

| Attacker / agent type | How it drives the page | What catches it | Strength |
|---|---|---|---|
| Stock automation (Playwright, Puppeteer, Selenium) | Launches its own browser; DevTools Protocol | `navigator.webdriver`, headless UA, automation globals, untrusted events from helpers like `selectOption` | High |
| Stealth automation (patched webdriver, real UA) | Same, with patches | Webdriver patch detection (own property, iframe mismatch), native tampering, then behavior (jump arrival, fixed holds, metronome typing, centred clicks, keyless text) | Medium–high |
| Content-script / extension agents | Isolated-world scripts calling `element.click()`, setting values | `evt.untrusted`, honeypots, `dom.foreign_nodes` for overlays | High on ordinary fields. **Not on credential fields**: script fills of password/`autocomplete` identity fields are exempt so password managers are not convicted (D21) |
| DevTools-Protocol page scripts drawing overlays | `innerHTML` and similar string sinks | `dom.injected_html` (Trusted Types report-only), `dom.foreign_nodes` | Medium–high |
| Main-world extension scripts drawing overlays | Same sinks, from an extension | `dom.foreign_nodes` only on current Chrome: a main-world extension script produced **no** Trusted Types report on Chrome 158 (it did on 141) | Low–medium |
| Extension agents using the debugger API (e.g. Claude in Chrome, Gemini in Chrome) | Trusted DevTools-Protocol input in the user's real browser | Behavior rules; the browser's "is debugging" bar is **not visible to the page** and can be hidden with a flag | **Measured for Claude in Chrome (Chrome 157, 2026-11-12, 2 runs): `block` when it used its form-fill tool, `agent` (83) → `step_up` on mouse and keyboard alone.** Its environment is clean (no webdriver flag); it is caught by one move per click, 1–3 ms button holds, 0 ms key holds and 0.1 ms typing intervals. Nothing stops a future version from humanizing those. Other products unmeasured |
| Screenshot loop + OS input (xdotool, pyautogui, CGEvent, local LLMs) | Real OS events, no browser traces | Coalesced-sample density, frozen pointer between actions, jump arrival, fixed holds, metronome typing, uniform-random timing | Medium for plain tools, weaker vs humanized |
| Humanized agents using `random(a, b)` delays | Any of the above with human-like noise | Distribution-shape rules, coalesced density, page-injection signals | Usually `suspect` → step-up |
| Humanized agents using log-normal delays and key rollover | Same, with better statistics | `mot.no_coalesced` only | **Not detected: `human`.** Covered only by `critical` step-up |
| Agent takes over a session a human started | Human browses, agent performs the transfer | Recent-window pass: the last 8 actions are scored on their own (D15) | High when the agent takes ≥ 5 robotic actions; none when it takes one or two |
| Short robotic session | Two or three scripted clicks, a little typing | No rule has enough samples; the verdict is `unknown`, never `human` (D14) | Step-up on `high`; **`allow` on `medium`** |
| Forged telemetry | Attacker posts fabricated batches to `/ad/collect` | Server clock bounds (D17) force real-time pacing; session binding (D18) stops fresh-session laundering | **Not prevented.** Slowed only. Covered by `critical` step-up and transaction-bound tokens |
| Collector suppressed | Requests to `/ad/*` blocked | No telemetry → step-up on `medium` and above (D20) | High for total silence; an env snapshot plus one event is `unknown` → `allow` on `medium` |
| Relayed token | A token earned in one session is presented in another, or for another transfer | `sub` binding, `ctx` binding, single use (D18, D19) | High with `bind` and `ctx` in use; none without them |
| Touch emulation | DevTools-Protocol touch events or device emulation | No touch rules exist; touch-only sessions are `unknown` (D22) | Step-up on `high`; nothing on `medium` |
| Keyboard-navigation agent | Tab / Enter / Space via the DevTools Protocol, little typing | Navigation keys are excluded from typing rhythm; such sessions are usually `unknown` (D14) | Step-up on `high`; nothing on `medium` |
| Agent in a VM/container | Xvfb + xdotool, cloud browsers | Software GPU + Linux + small fixed resolution | Supporting signal |
| Copied browser profile / stolen session | Profile moved to another machine | **Not covered.** `bind` ties detection to the app session, not to the device. Needs Device Bound Session Credentials or device continuity; see roadmap | — |
| Cooperative agents using WebMCP | Browser's agent API | `agentInvoked` / `toolactivated`: routed to a declared lane (read allowed, writes step up) | High (when shipped by browsers) |
| Accessibility-API agents (UI Automation, AX) | Activate controls without pointer movement | Hard: indistinguishable from screen readers by design. Step-up covers money movement | Low (deliberately) |

## Assumptions

- The attacker fully controls the browser: they can read the bundle, patch functions, block requests and replay old payloads.
- The server, its secret and the bank's API are trusted.
- A passkey with user verification (biometric/PIN on the user's device) can't be completed by the agent without the human.

## Defenses against tampering with the SDK itself

| Attack | Defense |
|---|---|
| Patch the collector to report "human" | The browser never reports verdicts; the server scores raw events |
| Fabricate raw events that look human | **Not preventable.** Events ahead of the server's clock are dropped, so a history must be fed in real time (D17); with `bind`, the fabricated session cannot replace a flagged one (D18). `critical` actions step up regardless (D13) |
| Block the collector entirely | No telemetry steps up on everything above `low` (D20) |
| Send just enough to look inconclusive | `unknown` steps up on `high` and `critical`. It is `allow` on `medium`: do not put anything that must hold on `medium` |
| Shed evidence: flood a stream, re-send a clean environment, ask for a new session | Tier 1 hits are latched before eviction, environment flags only turn on, one session per app session with `bind` (D16, D18) |
| Launder by navigating (clock restarts on each page) | Every page load is rebased onto one server timeline (D17) |
| Replay an old batch | Per-page-load nonce, strictly increasing `seq` |
| Reuse a decision token | Single use by token id, 120 s TTL (D19). Per process until the shared store exists |
| Use a token for a different transfer, or in a different session | `ctx` (transaction hash recomputed by the API) and `sub` (session binding) (D18, D19) |
| Forge a token | HMAC-SHA256, secret ≥ 32 characters, constant-time comparison, strict two-part format |
| Unknown action or policy typo | Treated as `high`; invalid policy refuses to start (D12) |
| Drive the endpoints from another site | JSON content type required (forces a CORS preflight), `Sec-Fetch-Site: cross-site` refused |
| Learn which rule fired | `exposeReasons: false` in production (refuses to start otherwise). The rules themselves are public; see `SECURITY.md` |
| Flood with garbage or expensive traces | Body cap (512 KB), per-stream caps (~16,500 events per session), session cap enforced at insert with LRU eviction, linear-time scoring. **Rate limiting is not built in** |
| Tamper with the collector in the page (remove listeners, register earlier ones, edit `autocomplete` attributes) | **Not preventable** from inside the page. Missing evidence fails closed to `unknown`; it cannot produce `human` |

## Out of scope (v0.3)

- Network-level bot management and rate limiting (IP reputation, TLS/JA4 fingerprints, request rates): use your edge provider. The endpoints assume it.
- Performing the step-up (passkey, app approval): the integrator's, by decision (D29). The SDK signals that one is needed and accepts `stepUpVerified` afterwards.
- Rate limiting: the deployment's, by decision (D30).
- Detection on touch devices and native apps: no rules yet; sessions fail closed to step-up on `high`.
- Session binding / cookie theft (DBSC, device continuity): roadmap.
- Native mobile apps: roadmap (Android/iOS SDKs).
- Full obfuscation or polymorphic builds of the collector: roadmap; the design doesn't depend on secrecy.
- Detecting *which* agent product is in use (except via configured `agentMarkers` or declared WebMCP tools).

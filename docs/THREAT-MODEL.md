# Threat model

## What we protect

High-risk actions in a signed-in session (money movement, payee changes, password and profile changes) from being performed by an AI agent or automation **without the account holder's live approval**.

We are *not* trying to block all agents. Users will increasingly delegate to agents on purpose. The goal is that an agent can't move money or change the account unless a human passes a step-up check.

## Attackers and how each layer covers them

| Attacker / agent type | How it drives the page | What catches it | Strength |
|---|---|---|---|
| Stock automation (Playwright, Puppeteer, Selenium) | Launches its own browser; DevTools Protocol | `navigator.webdriver`, headless UA, automation globals, untrusted events from helpers like `selectOption` | High |
| Stealth automation (patched webdriver, real UA) | Same, with patches | Webdriver patch detection (own property, iframe mismatch), native tampering, then behavior (jump arrival, fixed holds, metronome typing, centred clicks, keyless text) | Medium–high |
| Content-script / extension agents | Isolated-world scripts calling `element.click()`, setting values | `evt.untrusted`, honeypots, `dom.foreign_nodes` for overlays | High |
| Main-world extension scripts / CDP page scripts drawing overlays | `innerHTML` and similar string sinks | `dom.injected_html` (Trusted Types report-only), `dom.foreign_nodes` | Medium–high |
| Extension agents using the debugger API (e.g. Claude in Chrome, Gemini in Chrome) | Trusted DevTools-Protocol input in the user's real browser | Behavior rules; the browser's "is debugging" bar is **not visible to the page** and can be hidden with a flag | Medium |
| Screenshot loop + OS input (xdotool, pyautogui, CGEvent, local LLMs) | Real OS events, no browser traces | Coalesced-sample density, frozen pointer between actions, jump arrival, fixed holds, metronome typing, uniform-random timing | Medium for plain tools, weaker vs humanized |
| Humanized agents (Bezier motion, random delays) | Any of the above with human-like noise | Distribution-shape rules, coalesced density, page-injection signals | Usually `suspect` → **step-up is the real control** |
| Agent in a VM/container | Xvfb + xdotool, cloud browsers | Software GPU + Linux + small fixed resolution | Supporting signal |
| Copied browser profile / stolen session | Profile moved to another machine | **Not covered by v0.2.** Needs server-side session binding (DBSC, device continuity); see roadmap | — |
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
| Block the collector entirely | No data means `unknown`, which steps up on high-sensitivity actions |
| Replay an old batch or decision | Per-session nonce, strictly increasing `seq`, token TTL (120 s) bound to sid + action |
| Forge a token | HMAC-SHA256 with a server secret; constant-time comparison |
| Learn which rule fired | `exposeReasons: false` in production |
| Flood with garbage | Body size cap (512 KB), per-stream caps, strict field validation |

## Out of scope (v0.2)

- Network-level bot management (IP reputation, TLS/JA4 fingerprints): use your edge provider.
- Session binding / cookie theft (DBSC, device continuity): roadmap.
- Native mobile apps: roadmap (Android/iOS SDKs).
- Full obfuscation or polymorphic builds of the collector: roadmap; the design doesn't depend on secrecy.
- Detecting *which* agent product is in use (except via configured `agentMarkers` or declared WebMCP tools).

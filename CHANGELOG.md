# Changelog

## 0.3.0 (2026-11-12)

A full logic review, then the first measurements against a real agent and a real human. Every fix was reproduced with a failing test first; the reasoning, evidence and cost of each is in `docs/DECISIONS.md` D12–D32. No rules were added or re-weighted.

**Breaking**
- `secret` must be at least 32 characters (was 16). An array rotates: the first signs, all verify.
- An invalid `policy` value throws at startup. Unknown or malformed action names are `high`.
- `exposeReasons` and `debug` throw at startup when `NODE_ENV=production`.
- Endpoints require `Content-Type: application/json` and refuse `Sec-Fetch-Site: cross-site` (set `allowCrossSite` to opt out).
- `human` is harder to get (see below); `unknown × high` step-ups will be more frequent. A session that sent no telemetry now steps up on `medium` too.
- `onDecision` receives a different object: the server's own session id or `null`, plus `sensitivity`, `scope`, `jti`, `dropped`.
- `ScoreResult` gains `scope`; `mergeBatch`'s third parameter is a per-stream cap record.

**Fixed: fail-open and evasion**
- Action names such as `constructor` or a policy typo produced `allow` for `suspect` and `unknown` (D12).
- A short, plainly robotic session scored `human` because no rule had enough samples: `human` now needs an environment snapshot and ≥ 5 mouse clicks or ≥ 20 typing intervals (D14).
- A long human session diluted an agent takeover to `human`: the last 8 actions are now scored on their own and the worse verdict wins (D15).
- Tier 1 evidence aged out of long sessions, and a later batch could overwrite an automation flag: Tier 1 hits are latched, environment flags are monotonic (D16).
- A complete fabricated session could be posted in one request: the server now rebases every page load onto its own clock and drops events that could not have happened yet (D17). Also fixes timestamp collisions between page loads on multi-page sites.
- A flagged client could ask for a fresh session, and a token could be used in another user's session: new `bind` option (D18).
- A token authorized unlimited actions for 120 s and nothing could turn a `step_up` into an action: tokens are single use, can be bound to a transaction (`ctx`), and are checked with one call, `authorize()` (D19).
- A session that sent nothing was treated better than no session (D20).
- Text injected right after any key press, including a modifier, was not counted as keyless (D25).
- The app's own `innerHTML` use exhausted the Trusted Types report budget and blinded `dom.injected_html` (D26).

**Fixed: false positives**
- Evicted pointer history made old clicks look like teleports: a 300-action human session scored `suspect` (D16).
- Password-manager extensions fill with script events, which were Tier 1: script events on credential/identity fields are now exempt (D21).
- Touch taps emit `mousedown`/`mouseup` 0 ms apart, which fired `tim.fixed_hold` (D22).
- The handler-time `document.hidden` flag could convict on a dispatch race: the browser's visibility timeline now wins where it exists (D23).
- An app-chained synthetic click became Tier 1 once the trusted event that chained it was evicted (D16).
- A real click on a native `<select>` gave a 0 ms press/release pair (found in the first real human session): presses on `<select>` are no longer recorded as button holds (D31).

**New**
- `critical` sensitivity: always steps up, whatever the verdict (D13).
- `authorize()`, `contextHash()` (server) and `AgentDetect.contextHash()` (client), `stats()`, `subOf()`.
- `maskSelectors` / `data-ad-mask`: no click geometry, pointer path or key timing is recorded on PIN pads (D24).
- `autofillFields` option; honeypot field carries Bitwarden and Dashlane ignore attributes.
- Collector: serialised flushes, re-open after 403, `decide()` fails closed (D27).
- Per-stream caps, LRU session cap enforced at insert, linear-time feature extraction (86 ms → ~10 ms on an adversarial trace) (D26).
- Real-session tooling: `npm run demo:capture` prints every decision and saves the session's trace; `?fresh=1&label=` gives a new, named session per page load; `npm run replay` re-scores captures with the current rules.
- Tests: 66 unit tests (was 21), including the server over real HTTP; `npm run test:browser`, 15 collector tests in real Chromium; attack scenarios I (short robotic session) and J (token relay); sweep profiles for long, short and takeover sessions.
- `CHROMIUM_PATH` and `ATTACK_PORT` for the browser runs; `bench/main-thread.mjs` no longer has a hard-coded path.

**New experimental rule (off by default)**
- `mot.teleport_press`: one click with no pointer travel and no button hold. Added after a real test in which a person filled the form and Claude in Chrome clicked "Review & send": the transfer was allowed. With the rule on, that capture is `step_up`; the person's own sessions are unaffected (D33). 34 rules.

**Security reviews of the v0.3 commits (D34, D35)**
- Nothing per-event leaves a masked region. A script acting on its own inside one leaves a coarse, rate-limited `script-in-mask` marker that `evt.untrusted` counts; an app's own mirrored events and password-manager fills leave nothing (D35, correcting D34).
- A field's autofill class is fixed when the page first shows it, so retagging the amount field `autocomplete="username"` no longer exempts a script fill.
- The token replay cache is rationed per principal (`maxUsedTokensPerPrincipal`, default 2,000; `maxUsedTokens`, default 200,000), so one caller cannot lock everyone out when `bind` is set. Tokens minted with no session are not remembered (D35).

**Scope decisions**
- Performing the step-up (passkey or otherwise) is the integrator's; the SDK only signals that one is needed (D29). Rate limiting is not a product feature (D30).

**Measured for the first time**
- A real agent: Claude in Chrome on Chrome 157 → `block` when it used its form-fill tool, `agent` 83 → `step_up` on mouse and keyboard only.
- A real human (the maintainer, mouse, Mac, Chrome 157) → `human`, transfer allowed.
- Keydown delivery latency: human 1.4–13 ms (median 2.3), Claude in Chrome 0–0.7 ms (median 0.2). First hardware baseline for the experimental `key.instant_delivery` rule.

**Measured, not fixed**
- `mot.no_coalesced` fired on the real human: 1.4%–2.3% of their pointer moves carried more than one sample, and the threshold is 2%. The verdict stayed `human`. Open question D32.
- On Chrome for Testing 158 a main-world extension script produces no Trusted Types report (it did on Chromium 141). Harness scenario H is `suspect` there instead of `agent`.
- A humanized agent with log-normal delays and key rollover scores `human` (35).
- Claude in Chrome types with a median key interval of 0.1 ms; `key.metronome` does not fire on that (only `key.fixed_hold` does). A burst-speed rule is on the roadmap.

## 0.2.0 (2026-11-12)

Signals taken from Chrome's Modern Web Guidance, each validated in Chromium 141 first.

- **New** `dom.injected_html`: Trusted Types report-only catches HTML injected via DevTools Protocol or main-world extension scripts. Server exports `TRUSTED_TYPES_REPORT_ONLY` header value.
- **New** `dom.foreign_nodes`: elements injected outside app roots (agent/extension overlays), with a benign-extension allowlist.
- **New** `agent.webmcp_declared`: WebMCP `agentInvoked` / `toolactivated` / `toolcancel` → cooperative lane (read allowed, state changes step up).
- **New** `key.instant_delivery` (experimental, off): keydown delivery latency.
- **Fewer false positives:** `:autofill`, one-time-code fields and IME composition (`isComposing`, `keyCode 229`, 50 ms after `compositionend`) are excluded from keyless-text and canary rules.
- **Visibility timeline** from `VisibilityStateEntry` feeds hidden-tab rules.
- **Performance:** environment checks run at background priority; synchronous init went from 6–18 ms to under 1 ms.
- **Harness:** scenarios G (overlay via DevTools Protocol) and H (agent-style extension) → `agent` 5/5 each.
- 21 unit tests.

## 0.1.0 (2026-11-10)

- Browser collector, isomorphic rules engine (30 rules), Node scoring server with nonce/sequence checks and HMAC decision tokens, decision policy by action sensitivity.
- Demo bank, synthetic trace generators and sweep, Playwright attack harness (scenarios A–F), main-thread benchmark.

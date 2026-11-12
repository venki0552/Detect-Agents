# Roadmap

Status today: **v0.3 alpha** (2026-11-12). 34 rules, browser collector, Node scoring server, demo bank, 63 unit tests, 12 real-browser collector tests, a 10-scenario Playwright attack harness, a capture-and-replay mode for real sessions, and one real agent product measured (Claude in Chrome). **Thresholds are unvalidated on real humans, and no production deployment should let a verdict block or allow anything until P0 is done.**

Part 1 says what exists. Part 2 says what does not, in priority order. Part 3 is the production-readiness checklist: what a bank has to see before this gates real money.

Priorities: **P0** blocks any production use · **P1** needed for a credible first adopter · **P2** strengthens detection · **P3** later.

## 1. What is implemented

| Area | Implemented | Since | Verified by |
|---|---|---|---|
| Collector | Pointer, button, click, key-timing, input-type, scroll, focus, visibility, DOM-integrity and environment streams; honeypot link and field; passive capture-phase listeners; background-priority environment checks | v0.1–v0.2 | `npm run bench`, `npm run test:browser` |
| Collector privacy | No key values, no input values, no page text. **Masked regions** (`data-ad-mask`): no click geometry, pointer path or key timing | v0.1, mask v0.3 | browser test "masked region (PIN pad)…" |
| Collector transport | Batches with nonce + increasing sequence; **serialised flushes**; **re-open after 403**; `decide()` **fails closed**; reports its clock to the server | v0.1, hardened v0.3 | browser tests |
| Sanitizer | Every client field clamped or whitelisted, including `pt`, `af`, `mk` | v0.1, v0.3 | `rules.test.ts`, `soundness.test.ts` |
| Server timeline | **Clock rebase per page load**; events ahead of the server clock or far before the page opened are dropped and counted | v0.3 | `server.test.ts` |
| Evidence integrity | **Latched Tier 1 hits**, **monotonic environment flags**, **eviction watermark** so eviction cannot create or erase evidence | v0.3 | `server.test.ts`, `soundness.test.ts` |
| Scoring | 34 rules in two tiers; two-category gate; **`human` needs testable evidence**; **recent-window pass** against dilution; linear-time feature extraction | v0.1, soundness v0.3 | `rules.test.ts`, `soundness.test.ts`, `npm run sweep` |
| Decision policy | `low` / `medium` / `high` / **`critical`**; policy validated at startup; unknown anything → `high`; **no telemetry → step up above `low`** | v0.1, v0.3 | `soundness.test.ts`, `server.test.ts` |
| Tokens | HMAC-SHA256, 120 s TTL; **token id, single use, transaction context, session binding, strict parsing, secret rotation, `authorize()`** | v0.1, v0.3 | `server.test.ts`, attack scenario J |
| Session binding | **`bind(req)`**: one detection session per app session; no laundering by re-opening; no token relay | v0.3 | `server.test.ts`, attack scenario J |
| Request hygiene | JSON-only, Fetch-Metadata cross-site refusal, body cap, per-stream caps, LRU session cap at insert, sanitized audit hook, production guard on `exposeReasons`/`debug` | v0.3 | `server.test.ts` |
| Accessibility exclusions | Keyboard/AT clicks (`detail === 0`), native autofill, one-time-code fields, IME; **password-manager script fills**; **touch compatibility mouse events** | v0.2, v0.3 | unit + browser tests |
| Harness | Attack scenarios A–J against the demo bank; synthetic sweep with long-session, short-session and takeover profiles | v0.1–v0.3 | `docs/RESULTS.md` |

## 2. What is not implemented

### P0: before anything blocks or allows a real customer

| # | Work | Why | Done when |
|---|---|---|---|
| 1 | **Step-up signalling contract, API-driven.** `decideFor(req, action, ctx)` so the bank's API (not the page) asks for the decision and answers the UI with "step-up required"; a documented response shape; `authorize(…, { stepUpVerified })` stays the way back in. **How the step-up is performed (passkey, app approval, OTP) is the integrator's**: out of product scope, D29 | Today the page calls `decide()` itself; the signal works but lives in page code the agent controls | The demo's API returns the step-up signal and completes on `stepUpVerified` from a stub; documented in `INTEGRATION.md` |
| 2 | **Shadow-mode calibration kit**: a `mode: 'shadow'` server option (decisions are logged, the API always proceeds), a per-rule firing-rate report split by device class and by `scope` (session vs recent window), and a script to replay logged traces through new thresholds | Every threshold is a guess until measured on real humans. The v0.3 evidence floor and recent-window pass are uncalibrated too | Report shows each Tier 2 rule ≤ 0.1% on humans, each Tier 1 rule 0%, and the step-up rate per action |
| 3 | **Real human dataset**: consented sessions across mouse, trackpad, touch, keyboard-only, screen reader, voice control, dictation, IME (CJK, Indic), remote desktop/VDI, password-manager extensions | Replaces the synthetic humans as the false-positive benchmark | ≥ 1,000 sessions per device class |
| 4 | **Accessibility validation** with real assistive-tech users (JAWS, NVDA, VoiceOver, Dragon, switch access, dwell-click, voice-control and keyboard-navigation browser extensions) | Banks can't ship anything that flags disabled users. Open question D28: script-driven assistive extensions currently hit Tier 1 `evt.untrusted` | No AT profile reaches `agent`; a decision on whether `evt.untrusted` blocks or steps up |
| 5 | **Privacy & legal review** (BIPA, GDPR, CCPA), plus disclosure/consent text and data-retention defaults. Include the decision on masking password fields (D24) | Behavioral timing may be treated as biometric data | Written guidance in `docs/PRIVACY.md` |
| 6 | **Verify the default path against ad-blocker lists** (`/ad/collect`, `agent-detect.js`) and pick a neutral default | A blocked collector turns the user into `unknown`, which now steps up on `medium` and `high` | Tested against EasyList, EasyPrivacy and uBlock Origin defaults |

### P1: first adopter

| # | Work | Notes |
|---|---|---|
| 7 | **Pluggable store** (interface + Redis adapter) holding sessions, **latched Tier 1 hits, the binding index and the token replay cache** | In-memory only works on one instance. Single use (D19) and stickiness (D16) are per process until this lands. Use a compact encoding: worst case is ~1.5 MB per session today |
| 8 | *(removed)* Rate limiting | **Out of product scope, D30**: handled by the deployment's own means. The endpoints assume it exists |
| 9 | **Out-of-band notify + kill switch reference**: webhook to the bank's push service; "This wasn't me" ends the session and freezes payments | `notify` currently only returns the decision |
| 10 | **Sidecar package**: Docker image + config file for non-Node backends, including an HTTP `authorize` endpoint so Java/.NET APIs do not re-implement the checks | Most banks run Java/.NET. Hand-written verifiers get single use, `ctx` and binding wrong |
| 11 | **Token verifiers** for Java, .NET, Python, Go with shared test vectors covering `v`, `jti`, `ctx`, `sub` | The Java/C# snippets in `INTEGRATION.md` verify the signature only |
| 12 | **Lean production bundle** without in-browser scoring (`core/rules` is not needed client-side) | Smaller, and stops shipping the rule code to every visitor |
| 13 | **Real-agent harness**: Claude in Chrome (measured once by hand, 2026-11-12), Gemini in Chrome, browser-use + local model, xdotool and pyautogui loops on a real desktop (macOS, Windows), plus real password-manager extensions (D21) | Current harness is Playwright-only; OS-level agents and extensions are simulated |
| 14 | **`agentMarkers` list** from harness observations | Ships empty today |
| 15 | **Package and release hygiene**: emit `.d.ts` types and add them to `exports`; npm publish with provenance and signed tags; pin GitHub Actions to commit SHAs; run `npm run test:browser` on pull requests; `npm audit` gate | TypeScript consumers get no types today; the browser tests run only in the main-branch job, and have not yet been run on the bundled Chromium build |
| 16 | **Structured audit record**: a documented, versioned schema for `onDecision` events and a join key to `authorize()` results (`jti` is already there) | Model-risk and fraud teams need a stable record of every decision and what happened to its token |

### P2: stronger detection

| # | Work | Notes |
|---|---|---|
| 17 | **Touch rules** (contact size, pressure, tap duration, scroll physics) and **per-device-class thresholds** | Touch sessions are `unknown` today (D22): every mobile-web user steps up on `high` |
| 18 | **A signal that survives humanization with log-normal timing** | Measured gap (D13): such an agent is `human`, score 35. Candidates: coalesced-sample statistics per device class, pointer event rate vs display rate, `pointerrawupdate` |
| 19 | **Split `evt.untrusted`**: same-task chaining flag collected as data, then tighten the 100 ms window; decide block vs step-up (D28) | Closes "ride on the user's own keystroke" |
| 19a | **Decide the default for `mot.teleport_press`** (experimental since 2026-11-12, D33) | Catches a single agent click after a human filled the form, the case observed for real. Needs captures from more people, including trackpad tap-to-click, before it is on by default |
| 20 | **`mot.orphan_click`**: a click where the pointer never was (no move to that position) | Raw DevTools-Protocol clicks without a move are skipped by `mot.jump_arrival` today, to avoid convicting window re-entry |
| 21 | **Navigation-key evidence**: separate IME from navigation keys in `mod`, so Tab/Enter hold times can feed `key.fixed_hold` | A keyboard-navigation agent (Tab, Enter) leaves no typing rhythm today |
| 22 | Calibrate and enable **`key.instant_delivery`** | DevTools-Protocol keys: 0.1–1.2 ms under Playwright; **0–0.7 ms, median 0.2, from Claude in Chrome in real Chrome**. First hardware baseline (one person): 1.4–13 ms, median 2.3, no overlap with the agent. Needs more people and devices before it is switched on |
| 22a | **`key.burst_speed`**: typing faster than a person can (median interval under a few ms) | Claude in Chrome typed with a median interval of 0.1 ms. `key.metronome` did not fire (pauses between fields inflate the CV); only `key.fixed_hold` caught it |
| 23 | **Re-measure extension detection on current Chrome** | On Chrome for Testing 158 a main-world extension script produced no Trusted Types report (it did on Chromium 141). Only `dom.foreign_nodes` sees extension overlays there |
| 24 | **WebMCP live test** on Chromium 146+ with the flag | Cooperative-agent lane is unit-tested only |
| 25 | **Verified-agent lane**: Web Bot Auth (HTTP Message Signatures, RFC 9421) verification on the server; per-agent limited permissions | For agents that identify themselves at the HTTP layer |
| 26 | **Session binding to the device**: Device Bound Session Credentials + device continuity | Covers copied profiles and stolen sessions; the natural value for `bind` |
| 27 | **Background-tab and occlusion rules validated headed** in real Chrome, including under VDI | Playwright emulates visibility; window-occlusion false positives are unmeasured (D23) |
| 28 | `fetchLater()` transport for the last batch; split the environment check into smaller tasks | Main-thread and delivery polish |
| 29 | **Mobile SDKs** (Android, iOS) | Desktop web is the current focus |

### P3: later

- Optional decision-model layer on numeric features and reason codes only, never raw text. See `DECISIONS.md` D4.
- Polymorphic or obfuscated collector builds.
- "My agents" registry: users approve agents they use on purpose, to avoid alert fatigue.
- Federated threshold updates across deployments (weights only, no data sharing).
- Asymmetric token signatures, so APIs verify without holding the signing key.
- A desktop "hardened bank browser" track (OS-level injected-input flags, screen-capture exclusion). A separate product; see the threat model.

## 3. Production-readiness checklist

What has to be true before a verdict from this SDK gates a real customer's action. "Have" means it exists in this repo today.

| Requirement | Have? | Gap |
|---|---|---|
| Money movement cannot complete on a `human` verdict alone | Yes: `critical` always signals step-up | Performing the step-up is the integrator's (D29); the API-driven signal is P0 #1 |
| Authorization is bound to the exact transaction and usable once | Yes (`ctx`, `jti`, `authorize()`) | Single use is per process until P1 #7 |
| Detection state is tied to the authenticated session | Yes, when `bind` is configured | Not on by default; device binding is P2 #26 |
| False-positive rates measured on real users, per device class and assistive technology | **No** | P0 #2–4 |
| Privacy and legal sign-off | **No** | P0 #5 |
| Runs on more than one instance | **No** | P1 #7 |
| Abuse protection on the endpoints | Body cap, stream caps, session cap, JSON-only, same-site | Rate limiting is deliberately not in the product (D30): the deployment must provide it |
| Every decision is auditable and explainable | Yes (rule ids, evidence, scope, token id) | Stable schema is P1 #16 |
| Non-Node backends can enforce correctly | Partly (signature-only snippets) | P1 #10–11 |
| Supply chain: zero runtime dependencies, reproducible build, provenance | Zero dependencies: yes | Provenance, pinned actions, types: P1 #15 |
| Coverage of the agents customers actually use | Playwright simulations, plus **one real agent measured: Claude in Chrome on Chrome 157** (blocked / `agent`, see `RESULTS.md` §1) | Other products and OS-level tools: P1 #13 |
| At least one real human measured | **One** (the maintainer, mouse, Mac): `human`, transfer allowed. `mot.no_coalesced` fired on them (D32) | More people and devices: `npm run demo:capture`, see `CALIBRATION.md` §6 |
| Mobile web | **No** rules; fails closed to step-up | P2 #17 |

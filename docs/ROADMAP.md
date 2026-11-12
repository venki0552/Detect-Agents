# Roadmap

Status today: **v0.2 alpha**. 33 rules, browser collector, Node scoring server, demo bank, 21 unit tests, 8-scenario Playwright attack harness. Thresholds are unvalidated on real humans.

Priorities: **P0** blocks any production use · **P1** needed for a credible first adopter · **P2** strengthens detection · **P3** later.

## P0: before anything blocks a real customer

| # | Work | Why | Done when |
|---|---|---|---|
| 1 | **Shadow-mode calibration kit**: a `mode: 'shadow'` server option (always `allow`, log decisions), a per-rule firing-rate report, and a script to replay logged traces through new thresholds | Every threshold is a guess until measured on real humans | Report shows each Tier 2 rule ≤ 0.1% on humans, each Tier 1 rule 0% |
| 2 | **Real human dataset**: consented sessions across mouse, trackpad, touch, keyboard-only, screen reader, voice control, dictation, IME (CJK, Indic) | Replaces the synthetic humans as the false-positive benchmark | ≥ 1,000 sessions per device class |
| 3 | **Accessibility validation** with real assistive-tech users (JAWS, NVDA, VoiceOver, Dragon, switch access, dwell-click) | Banks can't ship anything that flags disabled users | No AT profile reaches `agent` |
| 4 | **Privacy & legal review** (BIPA, GDPR, CCPA), plus disclosure/consent text and data-retention defaults | Behavioral timing may be treated as biometric data | Written guidance in `docs/PRIVACY.md` |

## P1: first adopter

| # | Work | Notes |
|---|---|---|
| 5 | **Pluggable session store** (Redis adapter; interface for others) | In-memory store only works on one instance |
| 6 | **Sidecar package**: Docker image + config file for non-Node backends | Most banks run Java/.NET |
| 7 | **Token verifiers** for Java, .NET, Python, Go, with test vectors | Format: `base64url(json).base64url(HMAC-SHA256)` |
| 8 | **Passkey step-up reference flow**: WebAuthn reauthentication with `allowCredentials` limited to the signed-in user; verify the credential's user id matches the session | Turns `step_up` into a working control |
| 9 | **Out-of-band notify + kill switch reference**: webhook to the bank's push service; "This wasn't me" ends the session and freezes payments | `notify` currently only returns the decision |
| 10 | **Lean production bundle** without in-browser scoring (`core/rules` is not needed client-side) | Smaller (~12 KB gzip now) and hides the rule code from casual readers |
| 11 | **Real-desktop agent harness**: Claude in Chrome, Gemini in Chrome, browser-use + local model (Ollama), xdotool and pyautogui screenshot loops on a real desktop, on macOS and Windows | Current harness is Playwright-only; OS-level agents are simulated |
| 12 | **`agentMarkers` list** from harness observations (overlay selectors of known agent products) | Ships empty today |
| 13 | **npm publish + CI release** (provenance, signed tags) | |

## P2: stronger detection

| # | Work | Notes |
|---|---|---|
| 14 | Calibrate and enable **`key.instant_delivery`** (keydown delivery latency) | DevTools-Protocol keys: 0.1–1.2 ms; need the hardware baseline |
| 15 | **WebMCP live test** on Chromium 146+ with the flag; add `consequentialHint` / no `toolautosubmit` guidance for transfer tools | Cooperative-agent lane is unit-tested only |
| 16 | **Verified-agent lane**: Web Bot Auth (RFC 9421 signatures) verification on the server; per-agent limited permissions | For agents that identify themselves at the HTTP layer |
| 17 | **Session binding**: Chrome Device Bound Session Credentials (DBSC) support + device continuity checks | Covers copied profiles and stolen sessions |
| 18 | **Background-tab rules validated headed** in real Chrome | Playwright emulates visibility |
| 19 | **Split the environment check** into smaller background tasks; `fetchLater()` transport for reliable last batches | Main-thread polish |
| 20 | **Mobile SDKs** (Android: accessibility-service and `FLAG_SECURE` signals; iOS) | Desktop web is the current focus |
| 21 | **Per-device-class thresholds** (mouse vs trackpad vs touch) | Reduces false positives from coalescing differences |

## P3: later

- Optional decision-model layer (for example an open-weight model fine-tuned per bank on numeric features and reason codes only, never raw text). See `DECISIONS.md` D4.
- Polymorphic or obfuscated collector builds.
- "My agents" registry: users approve agents they use on purpose, to avoid alert fatigue.
- Federated threshold updates across deployments (weights only, no data sharing).
- A desktop "hardened bank browser" track (OS-level injected-input flags, screen-capture exclusion). A separate product; see the threat model.

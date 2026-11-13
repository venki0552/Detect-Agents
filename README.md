# agent-detect

**Tell whether a human or an AI agent is driving a sensitive web session, and decide what to do before money moves.**

> **Status: alpha (v0.3). Not production-ready.** It works against real automation in our harness, but its thresholds have **not** been calibrated on real human sessions, it has been measured against one real agent product and no real humans, and the session store is single-instance. Run it in shadow mode first ([docs/CALIBRATION.md](docs/CALIBRATION.md)); see what is and isn't implemented in [docs/ROADMAP.md](docs/ROADMAP.md).

AI agents now operate real browsers: extensions like Claude in Chrome and Gemini in Chrome, Playwright-based agents, and screenshot-and-click loops driving the OS mouse. Edge bot management sees the user's own device, IP and session, so it often can't tell. `agent-detect` looks at **how the page is being driven**, with 34 plain-code rules (no ML model), and returns a decision per action:

```
browser collector (~14 KB gzip)        your server (Node, zero deps)                 your API
raw timing + geometry only     ──►     sanitize → clock → features → 34 rules         authorize(token): signed, single-use,
no key values, no input text           verdict × action sensitivity → decision  ──►   bound to this session and
                                       allow | notify | step_up | block               this exact transaction
```

- **The browser only collects; the server decides.** The agent controls the browser, so nothing it reports is trusted. The server validates every field, owns the clock, never lets evidence be erased, and treats a silent collector as a reason to step up.
- **The verdict is a risk signal, not an authorization.** Telemetry can be forged, and a well-humanized agent can look human (see "Known limits"). Detection decides how much friction an action gets. For actions that must never happen without the account holder, mark them `critical`: they always require a passkey, whatever the verdict.
- **Explainable.** Every verdict comes with rule ids and evidence for audit, kept server-side.
- **Accessibility-aware.** Keyboard-only, screen-reader, autofill, password-manager, OTP, IME and touch input are excluded from the rules they'd otherwise trip.
- **Decisions are written down.** [docs/DECISIONS.md](docs/DECISIONS.md) records every design decision with its date, the evidence, and what it costs.

## Results so far

Real Playwright automation against the demo bank (Chrome for Testing 158, 2026-11-12, 6 runs of each randomised scenario):

| Attack | Decision on a transfer |
|---|---|
| Stock Playwright | **block** (webdriver, headless, untrusted events) |
| Stealth flags + xdotool-style input (frozen pointer, jumps, 12 ms typing) | **step_up**, agent, 6/6 |
| Stealth + humanized input (Bezier paths, **uniform** random delays) | **step_up**, suspect in 5/6, agent once |
| Humanized + overlay injected via DevTools Protocol | **step_up**, agent, 6/6 |
| Humanized + agent-style browser extension | **step_up**, suspect, 6/6 |
| Script injection (`element.click()`, `dispatchEvent`) | **block** |
| DOM agent filling every field | **block** (honeypot) |
| Short robotic session (2 instant clicks, 12 ms typing) | **step_up**, unknown, 6/6: too little evidence is never `human` |
| A token minted in another session, same action and amount | **refused** by the API, 5/5 |

**A real agent in a real browser:** Claude in Chrome driving Chrome 157 on the demo was **blocked** when it used its form-fill tool (script event), and was `agent` (83) → **step_up** using mouse and keyboard only. Two runs, one machine.

**One agent click after a human filled the form** (also real): the transfer was **allowed**. A rule that judges a single click (`mot.teleport_press`) was added for it and now steps that capture up; it is on by default, ahead of measurements on trackpads and remote desktop.

Synthetic, not in a browser: a human session followed by an agent takeover is `agent` in 500/500 seeds. **And the one that gets through:** a humanized agent using log-normal delays and overlapping key presses scores `human`. That is why `critical` exists.

Full method, synthetic sweeps, signal probes and cost: [docs/RESULTS.md](docs/RESULTS.md).

## Quick start

```bash
npm install
npm run build
npm test          # 69 unit tests: rules, scoring soundness, server over real HTTP
npm run test:browser   # 15 collector tests in real Chromium
npm run demo      # fictional bank at http://localhost:8787 with a live session panel
npm run attack    # the attack scenarios above (needs Playwright's Chromium, or CHROMIUM_PATH=/path/to/chrome)
```

**Browser:**

```html
<script src="/agent-detect.js"></script>
<script>
  const ad = AgentDetect.AgentDetect.init({ endpoint: '/ad', appRoots: ['#app'] });
  const ctx = await AgentDetect.AgentDetect.contextHash(payeeId, amount, 'USD');   // bind the decision to this transfer
  const { decision, token } = await ad.decide('transfer', ctx);                    // allow | notify | step_up | block
</script>
```

**Server (Node):**

```ts
import { createAgentDetect, contextHash } from 'agent-detect/server';
const ad = createAgentDetect({
  secret: process.env.AD_SECRET!,                        // >= 32 characters
  policy: { view_balance: 'low', add_payee: 'high', transfer: 'critical' },
  bind: (req) => appSessionId(req),                      // your authenticated session
});
// in your HTTP handler:   if (await ad.handle(req, res)) return;
// in your transfer API:   const a = ad.authorize(token, { action: 'transfer', ctx: contextHash(payeeId, amount, 'USD'), req, stepUpVerified });
//                         if (!a.ok) reject();
```

Also send `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` on those pages. It blocks nothing and turns on injection detection.

Java/.NET backends, the sidecar setup, token format and decision wiring: [docs/INTEGRATION.md](docs/INTEGRATION.md).

## What it looks at

| Family | Examples |
|---|---|
| Automation flags | `navigator.webdriver`, stealth patches, Playwright/Selenium globals, headless UA |
| Event origin | Script-dispatched (`isTrusted=false`) events, input while the tab is hidden |
| Page integrity | Honeypots, HTML injected via DevTools Protocol or extensions (Trusted Types reports), foreign overlays |
| Motion | Coalesced hardware samples, teleporting pointer, dead-centre clicks, ruler-straight paths, constant speed |
| Timing | Fixed button holds, frozen pointer between actions (screenshot loop), uniform-random delays |
| Keyboard | Metronome typing, fixed key holds, no key rollover, text without keystrokes |
| Declared agents | WebMCP `agentInvoked` / `toolactivated`: a cooperative lane (read allowed, writes step up) |

All 34 rules with thresholds and known false-positive sources: [docs/RULES.md](docs/RULES.md).

## Docs

| Doc | For |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Components, data flow, scoring, token format |
| [RULES](docs/RULES.md) | Rule catalog and false-positive sources |
| [RESULTS](docs/RESULTS.md) | Everything measured so far, with caveats |
| [THREAT-MODEL](docs/THREAT-MODEL.md) | Which attacker each layer covers; out of scope |
| [DECISIONS](docs/DECISIONS.md) | Dated decision log: why it's built this way, the evidence, rejected options, open questions |
| [ROADMAP](docs/ROADMAP.md) | What is implemented, what is not, and the production-readiness checklist |
| [CALIBRATION](docs/CALIBRATION.md) | Shadow mode and per-rule false-positive targets |
| [INTEGRATION](docs/INTEGRATION.md) | Wiring it into a real app and backend |
| [PRIVACY](docs/PRIVACY.md) | What is and isn't collected |
| [LEGAL-REVIEW](docs/LEGAL-REVIEW.md) | Engineering review of the privacy and legal position (EU, UK, US), with a deployer checklist and questions for counsel. Not legal advice |
| [CLAUDE.md](CLAUDE.md) | Instructions for coding agents working in this repo, including how to record decisions |

## Known limits

Stated plainly; the full list is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

- **Telemetry can be forged.** A client that talks to the endpoints directly can feed a fabricated human session in real time. The server makes that slow and makes it stick to one session; it cannot make it impossible.
- **A well-humanized agent can be `human`.** With uniform random delays it is `suspect`; with log-normal delays and key rollover it is `human` (score 35). Classify money movement as `critical`.
- **Not calibrated on real humans.** Trackpads, remote desktop/VDI, dictation, script-driven assistive extensions and password managers on unlabelled fields are the likeliest false positives. Short sessions and all touch sessions are `unknown`, so they step up on `high` actions.
- **The SDK signals that a step-up is needed; it does not perform it.** How you step up (passkey, app approval) and rate limiting are deliberately left to the integrator.
- **Single instance.** Sessions, latched evidence and the token replay cache are in memory.
- **No touch rules, no mobile SDK.** Copied browser profiles and stolen sessions need device binding (roadmap).
- **Tested mostly with Playwright.** One real agent product (Claude in Chrome) has been measured, twice, and one real human (verdict `human`, transfer allowed; one rule fired on them, see RESULTS). No OS-level tool, no other agent. On Chrome 158 the Trusted Types signal no longer sees extension scripts.
- WebMCP and background-tab rules are unit-tested only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New rules need evidence: unit tests on agents **and** on human/accessibility traces, a real-browser scenario, documented false-positive sources, and a dated entry in the decision log. Security issues: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)

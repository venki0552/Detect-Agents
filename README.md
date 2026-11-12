# agent-detect

**Tell whether a human or an AI agent is driving a sensitive web session, and decide what to do before money moves.**

> **Status: alpha (v0.2).** It works against real automation in our harness, but its thresholds have **not** been calibrated on real human sessions yet. Run it in shadow mode first ([docs/CALIBRATION.md](docs/CALIBRATION.md)).

AI agents now operate real browsers: extensions like Claude in Chrome and Gemini in Chrome, Playwright-based agents, and screenshot-and-click loops driving the OS mouse. Edge bot management sees the user's own device, IP and session, so it often can't tell. `agent-detect` looks at **how the page is being driven**, with 33 plain-code rules (no ML model), and returns a decision per action:

```
browser collector (~12 KB gzip)        your server (Node, zero deps)                 your API
raw timing + geometry only     ──►     sanitize → features → 33 rules → verdict       verifies a signed,
no key values, no input text           verdict × action sensitivity → decision  ──►   short-lived token
                                       allow | notify | step_up | block
```

- **The browser only collects; the server decides.** The agent controls the browser, so nothing it reports is trusted. Patching or blocking the collector gets you `unknown`, which steps up on high-risk actions.
- **Detection slows attackers; step-up stops them.** A careful humanized agent may reach only `suspect`, which still forces a passkey before a transfer.
- **Explainable.** Every verdict comes with rule ids and evidence for audit, kept server-side.
- **Accessibility-aware.** Keyboard-only, screen-reader, autofill, OTP and IME input are excluded from the rules they'd otherwise trip.

## Results so far

Real Playwright automation against the demo bank (Chromium 141):

| Attack | Decision on a transfer |
|---|---|
| Stock Playwright | **block** (webdriver, headless, untrusted events) |
| Stealth flags + xdotool-style input (frozen pointer, jumps, 12 ms typing) | **step_up**, agent, 10/10 runs |
| Stealth + humanized input (Bezier paths, random delays) | **step_up**, suspect in 11/12 runs |
| Humanized + overlay injected via DevTools Protocol | **step_up**, agent, 5/5 |
| Humanized + agent-style browser extension | **step_up**, agent, 5/5 |
| Script injection (`element.click()`, `dispatchEvent`) | **block** |
| DOM agent filling every field | **block** (honeypot) |

Full method, synthetic sweeps, signal probes and main-thread cost: [docs/RESULTS.md](docs/RESULTS.md).

## Quick start

```bash
npm install
npm run build
npm test          # 21 unit tests
npm run demo      # fictional bank at http://localhost:8787 with a live session panel
npm run attack    # the attack scenarios above (needs Playwright's Chromium)
```

**Browser:**

```html
<script src="/agent-detect.js"></script>
<script>
  const ad = AgentDetect.AgentDetect.init({ endpoint: '/ad', appRoots: ['#app'] });
  const { decision, token } = await ad.decide('transfer');   // allow | notify | step_up | block
</script>
```

**Server (Node):**

```ts
import { createAgentDetect } from 'agent-detect/server';
const ad = createAgentDetect({ secret: process.env.AD_SECRET!, policy: { transfer: 'high', view_balance: 'low' } });
// in your HTTP handler:   if (await ad.handle(req, res)) return;
// in your transfer API:   const p = ad.verifyToken(token); if (p?.decision !== 'allow' || p.action !== 'transfer') reject();
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

All 33 rules with thresholds and known false-positive sources: [docs/RULES.md](docs/RULES.md).

## Docs

| Doc | For |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Components, data flow, scoring, token format |
| [RULES](docs/RULES.md) | Rule catalog and false-positive sources |
| [RESULTS](docs/RESULTS.md) | Everything measured so far, with caveats |
| [THREAT-MODEL](docs/THREAT-MODEL.md) | Which attacker each layer covers; out of scope |
| [DECISIONS](docs/DECISIONS.md) | Why it's built this way; rejected options |
| [ROADMAP](docs/ROADMAP.md) | What's next (P0: calibration on real humans) |
| [CALIBRATION](docs/CALIBRATION.md) | Shadow mode and per-rule false-positive targets |
| [INTEGRATION](docs/INTEGRATION.md) | Wiring it into a real app and backend |
| [PRIVACY](docs/PRIVACY.md) | What is and isn't collected; legal notes |
| [CLAUDE.md](CLAUDE.md) | Instructions for coding agents working in this repo |

## Known limits

- Not calibrated on real humans yet; trackpads, remote desktop/VDI and dictation are the likeliest false-positive sources.
- A carefully humanized agent usually reaches `suspect`, not `agent`. Step-up is the control that holds.
- Copied browser profiles and stolen sessions need server-side session binding (roadmap).
- The in-memory session store is single-instance; use Redis in production (roadmap).
- WebMCP and background-tab rules are unit-tested only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New rules need evidence: unit tests on agents **and** on human/accessibility traces, a real-browser scenario, and documented false-positive sources. Security issues: [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE)

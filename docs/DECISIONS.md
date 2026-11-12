# Design decisions

Each entry records what was chosen, what was rejected, and why. Read this before proposing a change in the same area.

## D1. Detect and respond per action, don't block sessions

**Chosen:** score the session continuously, but act only at sensitive actions, tiered by sensitivity: log → out-of-band notify → hold + passkey step-up.

**Rejected:**
- **Blocking all agents:** users will legitimately delegate. Visa's Trusted Agent Protocol, Mastercard Agent Pay and Web Bot Auth all point toward verified agents with limited permissions.
- **Notify-only:** for money movement, the money is gone before the customer reads the alert.

## D2. The server decides; the browser only collects

**Rejected:** an in-browser verdict, or storing a fingerprint or flag on the client. The agent controls that browser: it can read, delete or forge anything stored there. On the user's own machine, the "agent's fingerprint" *is* the user's device.

## D3. Out-of-band alerts, not in-page banners

**Rejected:** showing "an agent is accessing your account" in the page. The agent sees and dismisses it. SMS with links or phone numbers also looks like phishing.

**Chosen:** push to the bank's official app with a one-tap "This wasn't me" that kills the session and freezes payments (to be built; see roadmap). Wording stays neutral ("automated activity detected"), because accessibility tools can trigger signals too.

## D4. Rules, not a model (v0.x)

**Rejected for the real-time path:**
- **A generative LLM as the scorer:** attacker-controlled telemetry fields enable prompt injection; latency and cost per session; non-deterministic output is hard to defend under bank model-risk governance (SR 11-7).
- **Hosted decision models (e.g. TypeSafe Jev):** a hosted API (banks won't send telemetry out), and its own docs say injected text can move answers.
- **Open-weight decision models (e.g. Cloudflare Clef-flash)** stay a possible **later** layer on top of numeric features, fine-tuned per bank on-prem. Not needed to ship.

**Chosen:** plain-code rules with explicit thresholds and reason codes. That makes them explainable, auditable, fast, and free of training-data provenance questions.

## D5. Two-category gate for Tier 2

**Chosen:** an `agent` verdict from weighted rules needs score ≥ 70 **and** hits in ≥ 2 independent categories. No single noisy signal (for example trackpad coalescing) can convict on its own.

## D6. Detection slows attackers; step-up stops them

Accepted trade-off: a carefully humanized agent will often reach only `suspect`. Its decision for high-sensitivity actions is still `step_up`, and the passkey can't be completed without the human. This is the control that holds as agents improve.

## D7. Banners and browser UI are not signals

Chrome's "is being debugged / controlled" bars are drawn outside the page. JavaScript can't see them, and a local attacker can suppress them (`--silent-debugger-extension-api`). So we detect *how the page is being driven*, not the banner.

## D8. Don't use session-replay tools as the training/data source

**Rejected:** PostHog/rrweb-style recorders as the collector. They throttle `mousemove` to ~50 ms (~20 Hz versus 125–1000 Hz hardware), don't record keydown timing, `isTrusted` or coalesced counts, and their self-hosted option is not bank-grade. Fine for visually debugging harness runs only.

## D9. Accessibility first

Keyboard-only and screen-reader clicks (`detail === 0`) are excluded from motion rules. Autofill (`:autofill`), one-time-code fields and IME composition are excluded from keyless-text rules. Dictation can reach `suspect` (step-up), never `agent`. Hiding forms from the accessibility tree or rendering them in canvas to break agents is **rejected**: screenshot agents still work, and it locks out disabled users (ADA exposure).

## D10. Signals taken from Chrome's Modern Web Guidance (v0.2)

We adopted the signals that **measurably** worked in a real browser: Trusted Types report-only, `:autofill`, one-time-code, IME rules, `VisibilityStateEntry`, WebMCP declared agents, and background scheduling.

We rejected the ones that didn't: Event Timing `interactionId` (assigned to DevTools-Protocol input too). Keydown delivery latency ships experimental and off until there's a human baseline. See `RESULTS.md` §3.

## D11. Zero runtime dependencies, Apache-2.0

The SDK runs inside bank pages and backends, where every dependency is a supply-chain review item. Apache-2.0 was chosen for its explicit patent grant, which matters to enterprise adopters. The maintainer may relicense before first public release.

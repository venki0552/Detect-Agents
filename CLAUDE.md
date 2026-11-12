# CLAUDE.md — agent-detect

Instructions for Claude Code (and other coding agents) working in this repository. Read this before changing anything.

## What this project is

`agent-detect` tells a sensitive web app (a bank first) whether a session is driven by a **human or an AI agent**, and decides what to do before a risky action: `allow`, `notify`, `step_up` (passkey) or `block`.

- **No ML model.** Every decision comes from a plain-code rule with an explicit threshold, so every verdict can be explained and audited.
- **The browser only collects. The server decides.** The agent controls the same browser the collector runs in, so nothing the browser says is trusted. The bank's API acts only on a server-signed, short-lived decision token.
- **Detection slows attackers down; step-up stops them.** A careful humanized agent is expected to reach only `suspect`. That's fine, because `suspect` still forces a passkey before money moves.

Status: **alpha (v0.2)**. Thresholds are calibrated only on synthetic data and real automation. They have never been calibrated on real human sessions. See `docs/ROADMAP.md`.

## Commands

```bash
npm install
npm run typecheck   # tsc, strict, no emit
npm test            # unit tests (node:test via tsx) — must stay green
npm run build       # dist/agent-detect.iife.js, dist/agent-detect.esm.js, dist/server.js
npm run demo        # fictional bank on http://localhost:8787 (needs build first)
npm run attack      # real Playwright attacks against the demo (needs build + Chromium)
npm run sweep       # 500-seed synthetic sweep per profile (sanity check, not evidence)
npm run bench       # main-thread cost in Chromium
```

Useful env for the attack harness: `SCENARIOS=humanized,overlayViaCdp` (run a subset), `HEADED=1` (headed, use `xvfb-run` on Linux), `ATTACK_JSON=path.json` (save results).

## Layout

```
src/core/     types, stats, features, rules, score — isomorphic (browser + Node), pure functions, no DOM
src/client/   env.ts (one-shot environment checks), index.ts (collector + transport)
src/server/   sanitizer, session store, /ad endpoints, decision policy, HMAC tokens
demo/         fictional "Harbor Demo Bank" page + demo server
test/unit/    rules.test.ts, traces.ts (synthetic generators), sweep.ts
test/e2e/     attack.ts (Playwright attack scenarios A–H), ext-agent/ (test extension fixture)
bench/        main-thread benchmark and research probes (probe-signals, probe-ext)
docs/         architecture, rules, results, threat model, decisions, roadmap, calibration, integration, privacy
```

Data flow: collector → `POST /ad/collect` batches (nonce + increasing seq) → server `sanitizeBatch` → `mergeBatch` into the session trace → `extractFeatures` → `evaluateRules` → `scoreFeatures` → `decide(verdict, sensitivity)` → HMAC token → bank API calls `verifyToken`.

## Non-negotiable rules

1. **Privacy contract.** The collector must never record key values, input values, page text, URLs with PII, or anything that identifies the user. Keys are timestamps plus a per-press id only (no stable per-key id, so frequency analysis is impossible). Input events carry `inputType` only. If a new signal needs content, it doesn't go in.
2. **Server is authoritative.** Never add a code path where the browser's own verdict gates an action. `localScore()` is debug/UX only. The server fails closed: missing data means `unknown`, and `unknown` steps up on high-sensitivity actions.
3. **Zero runtime dependencies** in `src/`. Dev dependencies are fine.
4. **No `innerHTML` or other string sinks in the SDK.** The SDK itself must stay Trusted-Types-clean, or it pollutes the `dom.injected_html` signal.
5. **Never block the main thread.** Event listeners are `passive` and capture-phase, and do O(1) work. Anything heavier runs through `background()` (scheduler.postTask → requestIdleCallback → setTimeout). Re-run `npm run bench` after collector changes.
6. **Validate everything server-side.** Every new field the client sends needs a clamp/whitelist in `sanitizeBatch`, plus a sanitizer test.
7. **`exposeReasons` stays `false` in production.** Telling the browser which rule fired teaches attackers.
8. **Accessibility is a requirement.** Keyboard-only, screen-reader, voice-control, dictation, autofill and IME users must never be convicted. Clicks with `detail === 0` are excluded from motion rules. Dictation may reach `suspect` (step-up), never `agent`.

## Adding or changing a rule

A rule is a pull request with evidence, not just code:

1. Add it to `RULES` in `src/core/rules.ts`: `id` (`<category-prefix>.<name>`), `tier`, `category`, `weight`, `description`, `test()` returning evidence text or `null`.
   - **Tier 1** = hard evidence of automation, near-zero false positives possible. One hit means `agent`.
   - **Tier 2** = weighted. `agent` needs score ≥ 70 **and** ≥ 2 distinct categories.
   - Uncalibrated rules get `experimental: true` (off unless enabled via `scoreConfig.experimental`).
2. If it needs new data: add the type in `types.ts`, collect it in `client/index.ts`, sanitize it in `server/index.ts`, and compute it in `features.ts`.
3. Add unit tests in `test/unit/rules.test.ts`: it fires on the target agent trace, and **does not fire** on humans, trackpad, keyboard-only, autofill, dictation and IME traces.
4. Run `npm run sweep` and confirm the human profiles stay at 0% `agent`.
5. Prove it in a real browser: add or extend a scenario in `test/e2e/attack.ts`, and record results in `docs/RESULTS.md` (repeat runs ≥ 5 for anything random).
6. Document it in `docs/RULES.md`, including its **known false-positive sources**.
7. **Don't tune thresholds to make our own synthetic tests pass.** The synthetic humans and the rules share an author, so passing them is a sanity check only. Real thresholds come from calibration (`docs/CALIBRATION.md`).

## Testing notes and gotchas

- Playwright **emulates focus and visibility**: background-tab scenarios can't be reproduced with it (scenario F is inconclusive by design). Test those headed in real Chrome.
- The test container has no GPU, so `env.software_renderer` fires in every e2e run. Ignore it when reading results.
- `env.cdp_runtime` (console serialisation trick) never fired on Chromium 141; it's likely dead.
- Event Timing `interactionId` is assigned to DevTools-Protocol input too. It's not a signal, so don't re-add it.
- Trusted Types: Playwright `evaluate` + `innerHTML` reports with an empty `sourceFile`; MV3 main-world scripts report as `chrome-extension` (no id). Isolated-world content scripts are **exempt**, so only `dom.foreign_nodes` sees their overlays.
- WebMCP (`agentInvoked`, `toolactivated`) needs Chromium 146+ behind a flag: feature-detected, unit-tested only.
- Synthetic sweep numbers are not evidence of real false-positive rates. Never present them as such.

## Style

- TypeScript strict; small pure functions in `core/`; no classes outside the collector.
- Comments explain *why* (the attack or false positive a line handles), not what.
- Keep payload fields short (`t`, `tr`, `bg`) because they cross the network constantly.
- Docs are plain and specific: numbers first, caveats stated, no marketing.

## Where to look next

- `docs/ROADMAP.md`: prioritized work (P0 is human-session calibration).
- `docs/DECISIONS.md`: why things are the way they are, including rejected options. Read it before proposing an ML scorer, client-side fingerprints or in-page alerts.
- `docs/THREAT-MODEL.md`: which attacker each layer covers and what is out of scope.

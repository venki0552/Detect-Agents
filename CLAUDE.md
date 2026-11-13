# CLAUDE.md — agent-detect

Instructions for Claude Code (and other coding agents) working in this repository. Read this before changing anything.

## What this project is

`agent-detect` tells a sensitive web app (a bank first) whether a session is driven by a **human or an AI agent**, and decides what to do before a risky action: `allow`, `notify`, `step_up` (passkey) or `block`.

- **No ML model.** Every decision comes from a plain-code rule with an explicit threshold, so every verdict can be explained and audited.
- **The browser only collects. The server decides.** The agent controls the same browser the collector runs in, so nothing the browser says is trusted. The bank's API acts only on a server-signed, short-lived decision token.
- **Detection slows attackers down; step-up stops them.** A humanized agent that uses `random(a, b)` delays reaches `suspect`, which forces a passkey. One that uses log-normal delays and overlapping key presses reaches **`human`** (measured, see `docs/DECISIONS.md` D13). So a `human` verdict is evidence, not proof: actions that must never happen without the account holder are `critical`, which always steps up.
- **The client tells a story; the server decides how much of it to believe.** The server validates every field, owns the clock, never lets evidence be erased, and treats silence as worse than being seen.

Status: **alpha (v0.3)**. Thresholds are calibrated only on synthetic data and real automation. They have never been calibrated on real human sessions. See `docs/ROADMAP.md`.

## The decision log is part of the code

**Every decision is recorded in `docs/DECISIONS.md`, with the date and time, in the same change that implements it.** This is how the next person or model learns why the code is the way it is.

- **Before you change behaviour:** search `docs/DECISIONS.md` for the area. If your idea is under "Rejected" or in D28 ("considered and deliberately not done"), you need new evidence to reopen it; say what the evidence is.
- **When you decide something** (a threshold, a default, a trade-off, a rejected option, something left undone on purpose): add `## D<n>` using the template at the top of that file. Fill in every field: `Decided` (local date, time, UTC offset — run `date "+%Y-%m-%d %H:%M %Z"`), `By` (who or which model, and who asked), `Context`, `Options considered`, `Chosen`, `Why`, **`How it was decided`** (the test, command or number; write "Not measured" if nothing was), `Consequences / cost`, `Revisit when`. Add a row to the index table.
- **Never rewrite an old entry's meaning.** To reverse a decision, add a new entry that says "Supersedes D<n>" and set the old one's status to `superseded by D<m>`.
- **Be honest in it.** State what was not measured and what got worse. An entry that only lists benefits is incomplete.
- Then update `CHANGELOG.md`, and the doc that describes the behaviour (`ARCHITECTURE`, `RULES`, `THREAT-MODEL`, `INTEGRATION`, `PRIVACY`, `RESULTS`, `ROADMAP`).

## Commands

```bash
npm install
npm run typecheck   # tsc, strict, no emit
npm test            # unit tests (node:test via tsx): rules, scoring soundness, server over real HTTP — must stay green
npm run build       # dist/agent-detect.iife.js, dist/agent-detect.esm.js, dist/server.js
npm run test:browser  # collector tests in real Chromium against the real server (builds first)
npm run demo        # fictional bank on http://localhost:8787 (needs build first)
npm run attack      # real Playwright attacks against the demo (needs build + Chromium)
npm run sweep       # 500-seed synthetic sweep per profile (sanity check, not evidence)
npm run demo:capture  # demo that prints every decision and saves the session trace to captures/ (git-ignored); experimental rules are ON here
AD_EXPERIMENTAL=all npm run replay   # re-score captures with experimental rules on
npm run replay      # re-score everything in captures/ with the current rules
npm run bench       # main-thread cost in Chromium
```

Useful env for the browser runs: `SCENARIOS=humanized,overlayViaCdp` (run a subset), `HEADED=1` (headed, use `xvfb-run` on Linux), `ATTACK_JSON=path.json` (save results), `ATTACK_PORT=8801` (run several harnesses in parallel), `CHROMIUM_PATH=/path/to/chrome` (use a specific browser binary when Playwright's bundled build is not installed; applies to `attack`, `test:browser` and `bench`).

## Layout

```
src/core/     types, stats, features, rules, score — isomorphic (browser + Node), pure functions, no DOM
src/client/   env.ts (one-shot environment checks), index.ts (collector + transport)
src/server/   sanitizer, clock rebase, session store, /ad endpoints, decision policy, tokens, authorize()
demo/         fictional "Harbor Demo Bank" page + demo server (session binding, transaction-bound tokens)
test/unit/    rules.test.ts (rules), soundness.test.ts (what the scorer may conclude), server.test.ts (HTTP trust boundary),
              traces.ts (synthetic generators), sweep.ts
test/e2e/     attack.ts (Playwright attack scenarios A–J), collector.test.ts (what the collector puts on the wire),
              launch.ts (browser options), ext-agent/ (test extension fixture)
bench/        main-thread benchmark and research probes (probe-signals, probe-ext)
docs/         architecture, rules, results, threat model, decisions, roadmap, calibration, integration, privacy
```

Data flow: collector → `POST /ad/session` (reports its clock) → `POST /ad/collect` batches (nonce + increasing seq) → server `sanitizeBatch` → `rebase` onto the server's timeline (drops impossible timestamps) → `appendBatch` → latch Tier 1 hits if a stream is about to be evicted → `trimTrace` → at `/ad/decide`: `scoreTrace` (`extractFeatures` → `evaluateRules` → `scoreFeatures`, for the whole session **and** the last 8 actions; worse wins) → `decide(verdict, sensitivity)` → HMAC token `{v, jti, iat, exp, sid, sub, action, decision, ctx}` → bank API calls `ad.authorize(token, { action, ctx, req })`.

## Non-negotiable rules

1. **Privacy contract.** The collector must never record key values, input values, page text, URLs with PII, or anything that identifies the user. Keys are timestamps plus a per-press id only (no stable per-key id, so frequency analysis is impossible). Input events carry `inputType` only. If a new signal needs content, it doesn't go in.
2. **Server is authoritative.** Never add a code path where the browser's own verdict gates an action. `localScore()` is debug/UX only. The server fails closed: missing data means `unknown`, and `unknown` steps up on high-sensitivity actions. A session that sent no telemetry steps up on everything above `low`. Anything unrecognised (action name, sensitivity, token shape) is treated as the strictest case, never the loosest.
3. **Zero runtime dependencies** in `src/`. Dev dependencies are fine.
4. **No `innerHTML` or other string sinks in the SDK.** The SDK itself must stay Trusted-Types-clean, or it pollutes the `dom.injected_html` signal.
5. **Never block the main thread.** Event listeners are `passive` and capture-phase, and do O(1) work. Anything heavier runs through `background()` (scheduler.postTask → requestIdleCallback → setTimeout). Re-run `npm run bench` after collector changes.
6. **Validate everything server-side.** Every new field the client sends needs a clamp/whitelist in `sanitizeBatch`, plus a sanitizer test.
7. **`exposeReasons` stays `false` in production.** Telling the browser which rule fired teaches attackers.
8. **Accessibility is a requirement.** Keyboard-only, screen-reader, voice-control, dictation, autofill and IME users must never be convicted. Clicks with `detail === 0` are excluded from motion rules. Dictation may reach `suspect` (step-up), never `agent`. Password-manager fills (script events on credential fields, `af`) and touch taps (compatibility mouse events, `pt: 'touch'`) are not evidence.
9. **`human` is a claim, and it needs evidence.** Never return `human` because nothing fired. It requires an environment snapshot and enough samples that a rule could have fired (D14). If you add an input modality with no rules (touch, pen, voice), its sessions are `unknown` until it has rules.
10. **Evidence is monotonic.** More activity may add evidence; it must never remove it (Tier 1 hits are latched, environment flags only turn on) and a storage limit must never be read as behaviour (use `trace.cut`; "no event in the trace" is not "nothing happened" once a stream has been evicted) (D16).
11. **The server owns the clock.** Never score a client timestamp that has not been through `rebase` (D17). Never let the client choose which session it is when `bind` is configured (D18).
12. **Tokens are checked in one place.** New API-side checks go into `authorize()`, not into documentation for integrators to remember (D19). `allow` and `notify` proceed; `step_up` only with a verified step-up; `block` never.
13. **Mask what is content.** Where a position or a rhythm *is* the secret (PIN pads, virtual keyboards), nothing measurable may leave the browser (`data-ad-mask`, D24).
14. **Never recognise a person.** The product answers "human or automation?" for the current session. No per-user behavioural template, no comparison against a stored profile, no linking across sessions. The legal position (GDPR Art. 9, US biometric statutes) depends on that purpose; a "does this match the customer's usual behaviour" feature is a different product and needs a new legal analysis first (D39, `docs/LEGAL-REVIEW.md`).

## Adding or changing a rule

A rule is a pull request with evidence, not just code:

1. Add it to `RULES` in `src/core/rules.ts`: `id` (`<category-prefix>.<name>`), `tier`, `category`, `weight`, `description`, `test()` returning evidence text or `null`.
   - **Tier 1** = hard evidence of automation, near-zero false positives possible. One hit means `agent`.
   - **Tier 2** = weighted. `agent` needs score ≥ 70 **and** ≥ 2 distinct categories.
   - Uncalibrated rules get `experimental: true` (off unless enabled via `scoreConfig.experimental`). The one exception so far is `mot.teleport_press`, switched on by the maintainer (D37); do not treat it as a precedent.
2. If it needs new data: add the type in `types.ts`, collect it in `client/index.ts`, sanitize it in `server/index.ts`, and compute it in `features.ts`.
3. Write the tests first and watch them fail (`test/unit/rules.test.ts`): it fires on the target agent trace, and **does not fire** on humans, trackpad, keyboard-only, autofill, dictation and IME traces. Also check it on a **long** session passed through `mergeBatch` (eviction) and in the **recent window** (it will run on the last 8 actions alone, so its minimum sample must make sense there).
4. Run `npm run sweep` and confirm the human profiles stay at 0% `agent`, including `human-long`.
5. Prove it in a real browser: add or extend a scenario in `test/e2e/attack.ts`, and record results in `docs/RESULTS.md` (repeat runs ≥ 5 for anything random).
6. Document it in `docs/RULES.md`, including its **known false-positive sources**, and add a `docs/DECISIONS.md` entry (see above).
7. **Don't tune thresholds to make our own synthetic tests pass.** The synthetic humans and the rules share an author, so passing them is a sanity check only. Real thresholds come from calibration (`docs/CALIBRATION.md`).

## Testing notes and gotchas

- Playwright **emulates focus and visibility**: background-tab scenarios can't be reproduced with it (scenario F is inconclusive by design). Test those headed in real Chrome.
- Playwright needs the Chromium build that matches its version (`npx playwright install chromium`). If that is not installed, point `CHROMIUM_PATH` at another Chromium/Chrome-for-Testing binary. **Record the browser version with every result**: behaviour differs between versions (next bullet).
- CI's browser job is pinned to `ubuntu-24.04`: Playwright refuses to install on an Ubuntu release it does not know, and `ubuntu-latest` moves. Change the pin and the Playwright version together (D36).
- On a machine without a GPU `env.software_renderer` fires in every e2e run; ignore it there. On a machine with a GPU it does not.
- `env.cdp_runtime` (console serialisation trick) never fired on Chromium 141; it's likely dead.
- Event Timing `interactionId` is assigned to DevTools-Protocol input too. It's not a signal, so don't re-add it.
- Trusted Types: Playwright `evaluate` + `innerHTML` reports with an empty `sourceFile` (Chromium 141 and 158). MV3 **main-world** content scripts reported as `chrome-extension` (no id) on Chromium 141, but produced **no report at all on Chrome for Testing 158** (measured 2026-11-12). Isolated-world content scripts are exempt on both. So on current Chrome only `dom.foreign_nodes` sees extension overlays; do not rely on `dom.injected_html` for extensions.
- The collector drops Trusted Types reports from the page's own code and from third-party scripts before its 50-report budget. Don't "simplify" that: an app that sets `innerHTML` on a timer would otherwise blind the signal.
- A touch tap fires `mousedown` and `mouseup` with the **same timestamp** (measured). Anything that reads button hold times must skip `pt: 'touch'`.
- Tests that post a synthetic trace over HTTP will see most of it dropped: the server refuses events stamped ahead of its own clock (D17). Inject the trace into `ad._session(sid).trace` instead, as `server.test.ts` does.
- A test that leaves an `http.Server` listening hangs `node --test` forever. Create everything inside `try` and close in `finally`.
- Real sessions: `npm run demo:capture`, then open `http://127.0.0.1:8787/?fresh=1&label=<name>` (a new session, saved under that label). `captures/` holds real people's behavioural timing: it is git-ignored and must never be committed or sent anywhere.
- A real agent in real Chrome (Claude in Chrome, Chrome 157): environment clean, one pointer move per click, 1–3 ms button holds, 0 ms key holds, typing at ~0.1 ms per key, keydown delivery 0–0.7 ms. Its form-fill tool dispatches an untrusted `input` event (Tier 1).
- First real human measured (2026-11-12, mouse, Mac, Chrome 157): mouse holds 79–135 ms, key holds 55–137 ms, keydown delivery 1.4–13 ms, and **only ~2% of pointer moves with more than one coalesced sample**, so `mot.no_coalesced` fired on a real person. Do not raise that rule's weight; see D32. A real click on a native `<select>` gives `mousedown`/`mouseup` at the same timestamp (D31).
- When editing a file from a script, read it fully before opening it for writing. `open(p,'w').write(open(p).read()…)` empties the file first (this destroyed `CHANGELOG.md` once on 2026-11-12; it was rebuilt from a backup).
- The `re` flag (first move after the pointer left the page) is not proof of a human re-entry: when a person moves their mouse to an agent's side panel, the agent's single synthetic move is flagged `re`. Ratio rules may give it the benefit of the doubt; a rule that judges one click must not (D33).
- Claude in Chrome's in-page indicator is a bare `div` (no id, class, attributes; closed shadow root) appended to `body`. It cannot be used as an `agentMarkers` selector.
- A field's autofill class is cached when first seen (`fieldClass`); don't go back to reading the attribute at event time (D34). In a masked region **no** per-event record leaves the browser, trusted or not: a script acting alone leaves a coarse `script-in-mask` marker, decided client-side. Recording untrusted events there was tried and leaked the person's key rhythm through the app's mirrored events (D35).
- A fix made in response to a review gets the same checks as any change: re-read the non-negotiable rules against the new code path. Two review fixes on 2026-11-12 needed fixing themselves (D35).
- `npm test` covers no browser code. After any change to `src/client/`, run `npm run test:browser` and `npm run bench`.
- WebMCP (`agentInvoked`, `toolactivated`) needs Chromium 146+ behind a flag: feature-detected, unit-tested only.
- Synthetic sweep numbers are not evidence of real false-positive rates. Never present them as such.

## Style

- TypeScript strict; small pure functions in `core/`; no classes outside the collector.
- Comments explain *why* (the attack or false positive a line handles), not what.
- Keep payload fields short (`t`, `tr`, `bg`) because they cross the network constantly.
- Docs are plain and specific: numbers first, caveats stated, no marketing.

## Where to look next

- `docs/DECISIONS.md`: why things are the way they are, with dates, evidence and rejected options. Read it before proposing an ML scorer, client-side fingerprints, in-page alerts, a looser `human` floor, or a change to which rules block. **D28 lists what was considered and deliberately not done.**
- `docs/ROADMAP.md`: what is implemented and what is not, by priority (P0: API-driven step-up signal, shadow mode, human-session calibration). **Out of product scope by decision:** performing the step-up (D29) and rate limiting (D30). Don't build either here.
- `docs/LEGAL-REVIEW.md`: the privacy and legal position and what a deployer must do. Read it before adding any new data field, any storage, or any hosted mode.
- `docs/THREAT-MODEL.md`: which attacker each layer covers, the residual risks stated plainly, and what is out of scope.

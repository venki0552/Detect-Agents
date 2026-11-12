# Contributing

Thanks for helping. This project protects real people's money, so contributions are held to an evidence bar.

## Setup

```bash
npm install
npm run typecheck && npm test && npm run build
npm run test:browser   # collector tests in real Chromium
npm run demo      # http://localhost:8787
npm run attack    # needs Chromium (Playwright), or CHROMIUM_PATH=/path/to/chrome
```

Node 22+.

## Ground rules

- **Zero runtime dependencies** in `src/`.
- **Privacy contract:** never collect key values, input values or page text (see `docs/PRIVACY.md`).
- **The server decides:** no client-side verdict may gate an action.
- **Accessibility:** a change must not convict keyboard-only, screen-reader, voice/dictation, autofill or IME users.
- **`human` needs evidence; evidence is never erased; unknown means strict.** See the non-negotiable rules in `CLAUDE.md`.
- **Write the failing test first.** Every fix in this repo has a test that reproduced the problem on the old code.
- **Record the decision.** Any change in behaviour adds a dated entry to `docs/DECISIONS.md` (template at the top of that file): what, why, how it was decided, what it costs.
- Read `CLAUDE.md` (written for coding agents, useful for humans too) and `docs/DECISIONS.md` before proposing architectural changes.

## Proposing a new rule

Open a "Rule proposal" issue first, then a pull request with:

1. The rule in `src/core/rules.ts` (tier, category, weight, threshold, description).
2. Unit tests: fires on the target agent trace; **doesn't fire** on the human, trackpad, keyboard-only, autofill, dictation and IME traces.
3. `npm run sweep`: human profiles stay at 0% `agent`.
4. A real-browser scenario in `test/e2e/attack.ts`, with repeated-run results added to `docs/RESULTS.md`.
5. A row in `docs/RULES.md`, **including known false-positive sources**.
6. An entry in `docs/DECISIONS.md`.

New or uncalibrated signals land as `experimental: true` (off by default).

## Real human data

Never commit recordings of real people. Calibration data stays with whoever collected it, under their consent and privacy terms.

## Pull requests

- Keep them focused; include before/after harness numbers for detection changes.
- CI must pass (typecheck, tests, build). Run `npm run test:browser` yourself after touching `src/client/`; CI does not run it yet.
- By contributing you agree your contribution is licensed under the repository's license (Apache-2.0).

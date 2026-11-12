## What & why

## Checklist
- [ ] `npm run typecheck && npm test && npm run build` pass
- [ ] Privacy contract kept (no key/input values, no page text)
- [ ] No new runtime dependencies
- [ ] Behaviour change? Failing test written first, and a dated entry added to `docs/DECISIONS.md` (what, why, how it was decided, cost)
- [ ] Touched `src/client/`? `npm run test:browser` and `npm run bench` run
- [ ] For rule changes: unit tests on agent **and** human/trackpad/keyboard-only/autofill/dictation/IME traces, `npm run sweep`, harness results in `docs/RESULTS.md`, row in `docs/RULES.md`

# bench/

| Script | What it does |
|---|---|
| `main-thread.mjs` | Measures per-event, init and scoring cost of the collector in Chromium (`npm run bench`) |
| `probe-signals.mjs` | Research probe: Event Timing, Trusted Types, `:autofill`, visibility entries and delivery latency under DevTools-Protocol input |
| `probe-ext.mjs` + `ext-agent/` | Research probe: does an MV3 extension's isolated / main-world overlay trigger Trusted Types reports? |

Results are recorded in `docs/RESULTS.md` §3–4.

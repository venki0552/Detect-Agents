# bench/

| Script | What it does |
|---|---|
| `main-thread.mjs` | Measures per-event, init and scoring cost of the collector in Chromium (`npm run bench`) |
| `probe-signals.mjs` | Research probe: Event Timing, Trusted Types, `:autofill`, visibility entries and delivery latency under DevTools-Protocol input |
| `probe-ext.mjs` + `ext-agent/` | Research probe: does an MV3 extension's isolated / main-world overlay trigger Trusted Types reports? |

Results are recorded in `docs/RESULTS.md` §3–4, with the browser version and machine. `CHROMIUM_PATH=/path/to/chrome` selects the browser binary.

`probe-signals.mjs` and `probe-ext.mjs` were written for Chromium 141 in a Linux container; re-run them on the browser you care about before relying on a probe result (the extension probe gives a different answer on Chrome 158).

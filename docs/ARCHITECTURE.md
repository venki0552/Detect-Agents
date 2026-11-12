# Architecture

## The three parts

```
 Browser                                Your backend                               Your API
 ───────                                ────────────                               ────────
 agent-detect.js (collector)            agent-detect server module                 transfer / payee / password
   • env checks (background task)         • POST /ad/session  → sid, nonce           • verifyToken(token)
   • passive input listeners              • POST /ad/collect  → sanitize + merge     • act only on a fresh "allow"
   • DOM / CSP / WebMCP listeners         • POST /ad/decide   → score → decision       for this exact action
   • batches every 1.5–3 s                     + HMAC token
   • decide(action) before risky steps
```

**Trust boundary:** everything left of the server is attacker-controlled. The collector can be patched, blocked or replayed, so the server:
- validates every field (`sanitizeBatch`),
- enforces a per-session nonce and a strictly increasing batch sequence (stops replay and out-of-order injection),
- scores from raw events, never from client-computed verdicts,
- fails closed: no session or too little evidence means `unknown`, which steps up on high-sensitivity actions,
- unknown action names default to `high` sensitivity.

## Collector (`src/client/`)

| Stream | Fields | Notes |
|---|---|---|
| `ptr` (pointermove) | t, x, y, c (coalesced sample count), tr (isTrusted), pt, re (re-entered doc) | `getCoalescedEvents()` length is the key hardware-vs-injected signal |
| `btn` (mousedown/up) | t, k, tr | Hold-time analysis |
| `click` | t, x, y, tr, det (detail), dx/dy (offset from target centre), w/h, pre, bg, pt | `det === 0` = keyboard/assistive tech, excluded from motion rules |
| `key` | t, k, tr, s (per-press id), rep, mod, bg, l (delivery latency) | **No key values.** `s` only pairs down/up |
| `input` | t, it (inputType), tr, kd (ms since keydown), comp (IME), bg, src (autofill / OTP) | **No values** |
| `scroll` | t, dy, cause | Was there a wheel/touch/key/drag/click before it? |
| `focus` | t, hid, foc | Handler-time visibility/focus |
| `vis` | t, hid | Browser `VisibilityStateEntry` timeline (exact; Chromium) or `visibilitychange` fallback |
| `dom` | t, kind, tag, by | Foreign nodes, agent markers, canary hits, Trusted Types sink reports, WebMCP events |
| `env` (once) | webdriver flags, automation globals, native tampering, renderer, screen, platform… | Collected at background priority |

Timestamps use `event.timeStamp` relative to collector start (same clock as `performance.now()`).

**Main-thread cost** (Chromium, measured): ~0.3–2 µs per pointermove, ~0.5–1.5 µs per key, ~10–17 µs per click (one `getBoundingClientRect`), under 1 ms synchronous init. Environment checks (~6–18 ms) run as one background-priority task. Batch serialisation is ~0.02 ms.

**Honeypots:** a hidden, `aria-hidden`, off-screen link is injected automatically, and `AgentDetect.canaryField()` returns a hidden form field for the app to place. Both are invisible to people and screen readers and skipped by autofill (`:autofill` check), so any interaction is automation.

## Server (`src/server/`)

- `createAgentDetect(options)` returns `{ handle, evaluate, verifyToken, close }`. `handle(req, res)` serves the three endpoints under `basePath` (default `/ad`).
- **Session store:** an in-memory `Map` with idle expiry (30 min) and a cap (50k). **Replace it with Redis or similar** for more than one instance.
- **Streams are capped** at 5,000 events each per session, so memory stays bounded.
- **Decision token:** `base64url(JSON{sid, action, decision, exp}) + "." + base64url(HMAC-SHA256(secret, body))`. The TTL defaults to 120 s. The bank's API checks the signature, expiry, action name and `decision === 'allow'`.
- `onDecision` hook for audit logs. `exposeReasons` (demo only) returns rule ids and evidence to the browser.
- `TRUSTED_TYPES_REPORT_ONLY` is the header value to send on pages using the SDK. It blocks nothing and makes the browser report string-sink injections.

## Scoring (`src/core/`)

1. `extractFeatures(trace)`: ~60 numeric features (coalesced share, jump arrivals, centred clicks, path straightness, speed variation, hold times, still gaps, interval CV/skew/kurtosis, rollover, hidden-period input, sink reports…).
2. `evaluateRules(features, cfg)`: 30+ rules (see `docs/RULES.md`). Disabled and experimental rules are skipped unless enabled.
3. `scoreFeatures`:
   - any Tier 1 hit → `agent` (score 100). If the only Tier 1 hits are `declared` (WebMCP), the result is marked `declared`.
   - Tier 2: `score = 1 − Π(1 − wᵢ/100)`
   - `agent` if score ≥ 70 **and** ≥ 2 distinct Tier 2 categories; `suspect` if ≥ 40
   - `human` if ≥ 8 interactions or ≥ 200 mouse moves; otherwise `unknown`
4. `decide(result, sensitivity)`:

| | low | medium | high |
|---|---|---|---|
| declared (WebMCP) | allow | step_up | step_up |
| Tier 1 hit | notify | block | block |
| agent | notify | step_up | step_up |
| suspect | allow | notify | step_up |
| unknown | allow | allow | step_up |
| human | allow | allow | allow |

`notify` means an **out-of-band** alert (push to the bank's app). Never show it in the page, because the agent can see and dismiss it.

## Deployment shapes

- **Node backend:** mount `handle()` in the existing server.
- **Java / .NET / other backends:** run the module as a small sidecar behind the same origin (for example a `/ad/*` route at the gateway). The API only needs HMAC token verification (see `docs/INTEGRATION.md`).
- **On-prem per bank:** no external calls; all scoring is local. That fits banks that won't send session telemetry to a SaaS.

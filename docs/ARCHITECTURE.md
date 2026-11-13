# Architecture

## The three parts

```
 Browser                                Your backend                               Your API
 ───────                                ────────────                               ────────
 agent-detect.js (collector)            agent-detect server module                 transfer / payee / password
   • env checks (background task)         • POST /ad/session  → sid, nonce           • authorize(token, {action, ctx, req})
   • passive input listeners              • POST /ad/collect  → sanitize → rebase    • recomputes ctx from the request
   • DOM / CSP / WebMCP listeners                                 → append → latch     it is about to execute
   • batches every 1.5–3 s                • POST /ad/decide   → score → decision     • proceeds on allow / notify, or on
   • decide(action, ctx) before                + HMAC token                             step_up after a verified passkey
     risky steps
```

**Trust boundary:** everything left of the server is attacker-controlled. The collector can be patched, blocked, replayed or bypassed, so the server:
- validates every field (`sanitizeBatch`),
- owns the clock: each page load is rebased onto one session timeline, and events the client could not have seen yet are dropped (`rebase`),
- enforces a per-page-load nonce and a strictly increasing batch sequence,
- never lets evidence be erased: Tier 1 hits are latched, environment flags only turn on, and eviction is recorded so it cannot be read as behaviour,
- scores from raw events, never from client-computed verdicts,
- fails closed: no telemetry steps up on everything above `low`; too little evidence means `unknown`, which steps up on `high` and `critical`; unknown action names are `high`,
- with `bind` configured, ties the detection session and every token to the app's authenticated session.

What it cannot do is make the events true. See "The honest summary" in `THREAT-MODEL.md`.

## Collector (`src/client/`)

| Stream | Fields | Notes |
|---|---|---|
| `ptr` (pointermove) | t, x, y, c (coalesced sample count), tr (isTrusted), pt, re (re-entered doc) | `getCoalescedEvents()` length is the key hardware-vs-injected signal |
| `btn` (mousedown/up) | t, k, tr, pt | Hold-time analysis. `pt: 'touch'` marks the compatibility events a tap emits (0 ms apart) so they are not read as a robotic hold |
| `click` | t, x, y, tr, det (detail), dx/dy (offset from target centre), w/h, pre, bg, pt, af, mk | `det === 0` = keyboard/assistive tech, excluded from motion rules. `mk` = inside a masked region: geometry withheld |
| `key` | t, k, tr, s (per-press id), rep, mod, bg, l (delivery latency), af | **No key values.** `s` only pairs down/up. Not recorded inside masked regions |
| `input` | t, it (inputType), tr, kd (ms since the printable keydown that produced it), comp (IME), bg, src (autofill / OTP), af | **No values.** One keydown pays for one `insertText` |
| `scroll` | t, dy, cause | Was there a wheel/touch/key/drag/click before it? |
| `focus` | t, hid, foc | Handler-time visibility/focus |
| `vis` | t, hid | Browser `VisibilityStateEntry` timeline (exact; Chromium) or `visibilitychange` fallback |
| `dom` | t, kind, tag, by | Foreign nodes, agent markers, canary hits, Trusted Types sink reports, WebMCP events |
| `env` (once) | webdriver flags, automation globals, native tampering, renderer, screen, platform… | Collected at background priority |

`af` appears only on script-dispatched (untrusted) events whose target is a credential or identity field (password input, `autocomplete` token, or `autofillFields`): that is what a password manager does, and it is not evidence.

Timestamps use `event.timeStamp` relative to collector start (same clock as `performance.now()`). That clock restarts on every page load, so the collector reports its current reading (`ct`) when it calls `/session`, and the server converts every event to milliseconds since the session was created.

**Masked regions.** Elements matching `maskSelectors` (default `[data-ad-mask]`) are for on-screen PIN pads and similar: inside them clicks carry no coordinates or size, pointer moves and key/input events are not recorded at all.

**Transport.** Flushes are queued, never concurrent. A 403 from `/collect` (server restarted, session expired, another page load took the nonce) triggers one re-open. `decide()` returns `step_up` on any failure.

**Main-thread cost** (v0.2, Chromium 141 in a container): ~0.3–2 µs per pointermove, ~0.5–1.5 µs per key, ~10–17 µs per click (one `getBoundingClientRect`), under 1 ms synchronous init. Environment checks (~6–18 ms) run as one background-priority task. Batch serialisation is ~0.02 ms. The v0.3 collector adds a mask check per key and click; its numbers, on a faster machine, are in `RESULTS.md` §4.

**Honeypots:** a hidden, `aria-hidden`, off-screen link is injected automatically, and `AgentDetect.canaryField()` returns a hidden form field for the app to place. Both are invisible to people and screen readers and skipped by autofill (`:autofill` check), so any interaction is automation.

## Server (`src/server/`)

- `createAgentDetect(options)` returns `{ handle, evaluate, authorize, verifyToken, subOf, stats, close }`. `handle(req, res)` serves the three endpoints under `basePath` (default `/ad`). Requests must be `application/json`; requests the browser labels `Sec-Fetch-Site: cross-site` are refused.
- **`bind(req)`** (optional, required in production): returns the caller's app-session id. With it there is one detection session per app session, the client cannot swap sessions, and tokens carry a keyed hash of the binding (`sub`).
- **Session store:** an in-memory `Map` with idle expiry (30 min) and a cap (default 50,000, enforced at insert, least recently used evicted). **Single instance only**: sessions, latched hits and the token replay cache all live here.
- **Streams are capped** per session: `ptr` 5,000, `key`/`input` 3,000, `btn` 2,000, `click`/`scroll` 1,000, `focus`/`dom`/`vis` 500. Worst case about 16,500 events (~1.5 MB). Over the cap a stream is trimmed to 80% and the latest evicted timestamp is kept in `trace.cut`. Before trimming a stream that can carry Tier 1 evidence the server scores once and latches any Tier 1 hit.
- **Timeline:** `t' = t + (openAt − ct)`. Events more than 5 s ahead of the server clock, or more than 10 s before the page's `/session` call, are dropped and counted (`dropped.future`, `dropped.stale`); old visibility entries are clamped instead, so the page's initial state survives.
- **Decision token:** `base64url(JSON{v, jti, iat, exp, sid, sub?, action, decision, ctx?}) + "." + base64url(HMAC-SHA256(secret, body))`. TTL 120 s. `secret` must be ≥ 32 characters; an array rotates (first signs, all verify).
- **`authorize(token, { action, ctx, req | binding, stepUpVerified })`** is the check the bank's API makes: signature, expiry, action, transaction context (both directions), session binding, decision (`allow`/`notify` proceed, `step_up` only when `stepUpVerified` is true, `block` never), then single use by `jti`. Returns `{ ok, reason }`.
- `onDecision` hook for audit logs: server session id (or null), action, sensitivity, decision, verdict, score, rule ids, scope, token id, drop counters. `exposeReasons` and `debug` are demo only and refuse to start with `NODE_ENV=production`.
- `TRUSTED_TYPES_REPORT_ONLY` is the header value to send on pages using the SDK. It blocks nothing and makes the browser report string-sink injections.

## Scoring (`src/core/`)

1. `extractFeatures(trace)`: ~60 numeric features (coalesced share, jump arrivals, centred clicks, path straightness, speed variation, hold times, still gaps, interval CV/skew/kurtosis, rollover, hidden-period input, sink reports…).
2. `evaluateRules(features, cfg)`: 30+ rules (see `docs/RULES.md`). Disabled and experimental rules are skipped unless enabled.
3. `scoreFeatures`:
   - any Tier 1 hit, now or latched earlier in the session → `agent` (score 100). If the only Tier 1 hits are `declared` (WebMCP), the result is marked `declared`.
   - Tier 2: `score = 1 − Π(1 − wᵢ/100)`
   - `agent` if score ≥ 70 **and** ≥ 2 distinct Tier 2 categories; `suspect` if ≥ 40
   - `human` only if an environment snapshot arrived **and** there are ≥ 8 interactions **and** one input family is testable: ≥ 5 mouse/pen clicks or ≥ 20 typing intervals. Otherwise `unknown`. Pointer movement alone is not evidence.
4. `scoreTrace` runs step 1–3 twice: on the whole session and on the **last 8 actions** (clicks and typing bursts, with a 3 s lead-in). The worse verdict wins; the recent pass can only raise a verdict to `suspect` or `agent`. `result.scope` is `session` or `recent`.
5. `decide(result, sensitivity)`:

| | low | medium | high | critical |
|---|---|---|---|---|
| declared (WebMCP) | allow | step_up | step_up | step_up |
| Tier 1 hit | notify | block | block | block |
| agent | notify | step_up | step_up | step_up |
| suspect | allow | notify | step_up | step_up |
| unknown | allow | allow | step_up | step_up |
| human | allow | allow | allow | **step_up** |
| *no telemetry at all* | allow | step_up | step_up | step_up |

`critical` never returns `allow`: it is for actions where a wrong `human` is not acceptable. An unrecognised sensitivity is treated as `high`.

The "Tier 1 hit" row is the default. `onTier1` lets a deployment make any Tier 1 rule (or all of them) return `step_up` instead of `block`; if several fired, one that blocks is enough to block (D38).

`notify` means proceed **and** send an out-of-band alert (push to the bank's app). Never show it in the page, because the agent can see and dismiss it.

## Deployment shapes

- **Node backend:** mount `handle()` in the existing server.
- **Java / .NET / other backends:** run the module as a small sidecar behind the same origin (for example a `/ad/*` route at the gateway). The API must do everything `authorize()` does: signature, expiry, action, `ctx`, `sub`, decision and single use (see `docs/INTEGRATION.md`). A sidecar `authorize` endpoint is on the roadmap so those checks are not re-implemented per language.
- **On-prem per bank:** no external calls; all scoring is local. That fits banks that won't send session telemetry to a SaaS.

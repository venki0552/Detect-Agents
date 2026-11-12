# Changelog

## 0.2.0 (2026-11-12)

Signals taken from Chrome's Modern Web Guidance, each validated in Chromium 141 first.

- **New** `dom.injected_html`: Trusted Types report-only catches HTML injected via DevTools Protocol or main-world extension scripts. Server exports `TRUSTED_TYPES_REPORT_ONLY` header value.
- **New** `dom.foreign_nodes`: elements injected outside app roots (agent/extension overlays), with a benign-extension allowlist.
- **New** `agent.webmcp_declared`: WebMCP `agentInvoked` / `toolactivated` / `toolcancel` → cooperative lane (read allowed, state changes step up).
- **New** `key.instant_delivery` (experimental, off): keydown delivery latency.
- **Fewer false positives:** `:autofill`, one-time-code fields and IME composition (`isComposing`, `keyCode 229`, 50 ms after `compositionend`) are excluded from keyless-text and canary rules.
- **Visibility timeline** from `VisibilityStateEntry` feeds hidden-tab rules.
- **Performance:** environment checks run at background priority; synchronous init went from 6–18 ms to under 1 ms.
- **Harness:** scenarios G (overlay via DevTools Protocol) and H (agent-style extension) → `agent` 5/5 each.
- 21 unit tests.

## 0.1.0 (2026-11-10)

- Browser collector, isomorphic rules engine (30 rules), Node scoring server with nonce/sequence checks and HMAC decision tokens, decision policy by action sensitivity.
- Demo bank, synthetic trace generators and sweep, Playwright attack harness (scenarios A–F), main-thread benchmark.

# Privacy

## What the collector records

| Data | Recorded as |
|---|---|
| Pointer movement | Viewport coordinates and timestamps; number of coalesced samples |
| Clicks | Coordinates, offset from the target's centre, target size, `detail`, timestamps |
| Keystrokes | **Timestamps only**, plus a per-press number used to pair keydown with keyup. No key values, no codes, no stable per-key id |
| Text input | **`inputType` only** (e.g. `insertText`, `insertFromPaste`), whether IME composition was active, and whether the field matched `:autofill` or is a one-time-code field. **No values** |
| Scroll / focus / visibility | Deltas, timestamps, hidden/visible |
| Page integrity | Tag names of foreign nodes, honeypot interactions, Trusted Types report source class (`none` / `extension` / `page` / `other`), WebMCP tool names declared by the site |
| Environment | Automation flags, WebGL renderer string, screen size, platform, language count, touch points |

## What it never records

Key values, form values, page text, URLs with query strings, cookies, names, account numbers, or any identifier of the person beyond the server's random session id.

## Still personal data?

Possibly. Behavioral timing (typing rhythm, mouse dynamics) can be treated as **biometric data** under laws such as Illinois BIPA, and as personal data under GDPR/CCPA. Before production:

- Get legal review for each jurisdiction.
- Disclose the processing (purpose: fraud and account protection) and get consent where required.
- Set retention: keep raw traces only as long as the session (the in-memory default expires after 30 minutes of idle time) and keep decisions/audit logs per your fraud-records policy.
- Don't use the data for anything other than security (no marketing, no profiling).
- Treat calibration datasets as sensitive: consent, minimization, access control.

This document isn't legal advice.

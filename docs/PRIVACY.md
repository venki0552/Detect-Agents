# Privacy

## What the collector records

| Data | Recorded as |
|---|---|
| Pointer movement | Viewport coordinates and timestamps; number of coalesced samples |
| Clicks | Coordinates, offset from the target's centre, target size, `detail`, timestamps. **Inside a masked region: none of the geometry** |
| Keystrokes | **Timestamps only**, plus a per-press number used to pair keydown with keyup, and whether the key was a typing key. No key values, no codes, no stable per-key id. **Not recorded inside a masked region** |
| Text input | **`inputType` only** (e.g. `insertText`, `insertFromPaste`), whether IME composition was active, and whether the field matched `:autofill` or is a one-time-code field. **No values.** Not recorded inside a masked region |
| Script-dispatched events | For events with `isTrusted=false` only: one bit saying the target is a credential or identity field (password input or an `autocomplete` token). Never set on a person's own input |
| Scroll / focus / visibility | Deltas, timestamps, hidden/visible |
| Page integrity | Tag names of foreign nodes, honeypot interactions, Trusted Types report source class (`none` / `extension` / `page` / `other`), WebMCP tool names declared by the site |
| Environment | Automation flags, WebGL renderer string, screen size, platform, language count, touch points |

## What it never records

Key values, form values, page text, URLs with query strings, cookies, names, account numbers, or any identifier of the person beyond the server's random session id.

When `bind` is configured the server links the detection session to your app session. It stores and puts into tokens only a keyed hash of that id, never the id itself. The transaction context (`ctx`) is a SHA-256 hash computed in the page; nothing readable about the transaction is sent to the detection endpoints.

## Where geometry or rhythm is the secret

Two cases where "timing and geometry only" is not enough:

- **On-screen PIN pads, virtual keyboards, security-code grids.** The position of a click identifies the key. Mark these regions with `data-ad-mask` (or `maskSelectors`). Inside them the collector records no click coordinates or sizes, no pointer path and none of the person's key or input events. (If a script dispatches key or input events there on its own, the collector sends at most three markers saying so, with the time rounded to the second. Synthetic events an app fires to mirror the person's real keystrokes send nothing.) This is **your** responsibility: the collector cannot recognise a keypad by itself. Without the mask, click coordinates on a keypad are recorded.
- **Key timing in password fields.** Intervals between keystrokes carry a small amount of information about what was typed. The collector records timing in password fields by default, because typing rhythm is one of the few signals on a login page. If your privacy review objects, mask those fields too; you lose that evidence.

## Still personal data?

Possibly. Behavioral timing (typing rhythm, mouse dynamics) can be treated as **biometric data** under laws such as Illinois BIPA, and as personal data under GDPR/CCPA. Before production:

- Get legal review for each jurisdiction.
- Disclose the processing (purpose: fraud and account protection) and get consent where required.
- Set retention: keep raw traces only as long as the session (the in-memory default expires after 30 minutes of idle time) and keep decisions/audit logs per your fraud-records policy. The audit hook receives rule ids, scores and counters, not raw events.
- Don't use the data for anything other than security (no marketing, no profiling).
- Treat calibration datasets as sensitive: consent, minimization, access control.

This document isn't legal advice.

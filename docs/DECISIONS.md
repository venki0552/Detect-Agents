# Design decisions

Each entry records what was chosen, what was rejected, why, and **how the decision was reached** (what was measured or read). Read this before proposing a change in the same area: if your idea is listed under "Rejected", the reason is here, and you need new evidence to reopen it.

## How to use this log (people and coding agents)

1. **Before changing behaviour**, search this file for the area you are touching. Entries are numbered `D<n>` and never renumbered.
2. **Every decision gets an entry in the same change that implements it.** A decision is anything a future reader could reasonably have done differently: a threshold, a default, a rejected option, a trade-off, a thing deliberately left undone.
3. **Never edit the meaning of an old entry.** If a decision is reversed, add a new entry that says "Supersedes D<n>" and mark the old one `Status: superseded by D<m>`. The history is the point.
4. **Write down the evidence, not the conclusion alone.** "Measured: X" beats "we think X". If nothing was measured, say "Not measured".
5. Use this template:

```
## D<n>. <short title>
- **Decided:** YYYY-MM-DD HH:MM <timezone> · **By:** <person, or model + who asked> · **Status:** active | superseded by D<m> | open question
- **Context:** what was wrong or unknown.
- **Options considered:** each option, one line.
- **Chosen:** what we do now.
- **Why:** the reasoning.
- **How it was decided:** what was measured, reproduced or read (test name, command, number).
- **Consequences / cost:** what this makes worse, and who pays.
- **Revisit when:** the fact that would change the answer.
```

Timestamps are local time with the UTC offset. D1–D11 were written before this convention: they are dated by release (v0.1.0 on 2026-11-10, v0.2.0 on 2026-11-12) and the exact times were not recorded.

## Index

| # | Decision | Decided | Status |
|---|---|---|---|
| D1 | Detect and respond per action, don't block sessions | ≤ 2026-11-10 (v0.1) | active |
| D2 | The server decides; the browser only collects | ≤ 2026-11-10 (v0.1) | active |
| D3 | Out-of-band alerts, not in-page banners | ≤ 2026-11-10 (v0.1) | active |
| D4 | Rules, not a model | ≤ 2026-11-10 (v0.1) | active |
| D5 | Two-category gate for Tier 2 | ≤ 2026-11-10 (v0.1) | active |
| D6 | Detection slows attackers; step-up stops them | ≤ 2026-11-10 (v0.1) | active, **narrowed by D13** |
| D7 | Banners and browser UI are not signals | ≤ 2026-11-10 (v0.1) | active |
| D8 | No session-replay tools as the data source | ≤ 2026-11-10 (v0.1) | active |
| D9 | Accessibility first | ≤ 2026-11-10 (v0.1) | active, extended by D21, D22 |
| D10 | Signals from Chrome's Modern Web Guidance | 2026-11-12 (v0.2) | active |
| D11 | Zero runtime dependencies, Apache-2.0 | ≤ 2026-11-10 (v0.1) | active |
| D12 | Policy and sensitivity fail closed | 2026-11-12 00:10 EST | active |
| D13 | `critical` sensitivity: "human" is evidence, not proof | 2026-11-12 00:12 EST | active |
| D14 | "human" needs evidence the rules could test | 2026-11-12 00:14 EST | active |
| D15 | Score the most recent actions on their own (dilution) | 2026-11-12 00:16 EST | active, uncalibrated |
| D16 | Evidence cannot be erased, and eviction cannot create it | 2026-11-12 00:18 EST | active |
| D17 | The server owns the timeline | 2026-11-12 00:20 EST | active |
| D18 | Bind detection to the app's authenticated session | 2026-11-12 00:22 EST | active |
| D19 | Tokens: single use, bound to the transaction, one `authorize()` | 2026-11-12 00:24 EST | active |
| D20 | Silence is never a better deal than being seen | 2026-11-12 00:26 EST | active |
| D21 | Password-manager fills are not Tier 1 | 2026-11-12 00:28 EST | active |
| D22 | Touch: tag compatibility mouse events; no rule coverage means `unknown` | 2026-11-12 00:30 EST | active |
| D23 | The browser's visibility timeline outranks the handler-time flag | 2026-11-12 00:31 EST | active |
| D24 | Masked regions: click position on a PIN pad is content | 2026-11-12 00:32 EST | active |
| D25 | One printable keydown pays for one `insertText` | 2026-11-12 00:33 EST | active |
| D26 | Request hygiene, bounded cost, bounded memory | 2026-11-12 00:34 EST | active |
| D27 | Collector transport: serialised flush, re-open, fail closed | 2026-11-12 00:36 EST | active |
| D28 | Considered in the 2026-11-12 review and deliberately not done | 2026-11-12 00:40 EST | open questions |
| D29 | The SDK signals step-up; performing it is the integrator's | 2026-11-12 04:10 EST | active |
| D30 | Rate limiting is not a product feature | 2026-11-12 04:10 EST | active |
| D31 | Presses on a native `<select>` are not button holds | 2026-11-12 04:14 EST | active |
| D32 | `mot.no_coalesced` fires on a real human: what to do with it | 2026-11-12 04:14 EST | **open question** |
| D33 | `mot.teleport_press`: judge a single click on its own | 2026-11-12 04:20 EST | active, **experimental (off by default)** |

## D1. Detect and respond per action, don't block sessions

**Chosen:** score the session continuously, but act only at sensitive actions, tiered by sensitivity: log → out-of-band notify → hold + passkey step-up.

**Rejected:**
- **Blocking all agents:** users will legitimately delegate. Visa's Trusted Agent Protocol, Mastercard Agent Pay and Web Bot Auth all point toward verified agents with limited permissions.
- **Notify-only:** for money movement, the money is gone before the customer reads the alert.

## D2. The server decides; the browser only collects

**Rejected:** an in-browser verdict, or storing a fingerprint or flag on the client. The agent controls that browser: it can read, delete or forge anything stored there. On the user's own machine, the "agent's fingerprint" *is* the user's device.

## D3. Out-of-band alerts, not in-page banners

**Rejected:** showing "an agent is accessing your account" in the page. The agent sees and dismisses it. SMS with links or phone numbers also looks like phishing.

**Chosen:** push to the bank's official app with a one-tap "This wasn't me" that kills the session and freezes payments (to be built; see roadmap). Wording stays neutral ("automated activity detected"), because accessibility tools can trigger signals too.

## D4. Rules, not a model (v0.x)

**Rejected for the real-time path:**
- **A generative LLM as the scorer:** attacker-controlled telemetry fields enable prompt injection; latency and cost per session; non-deterministic output is hard to defend under bank model-risk governance (SR 11-7).
- **Hosted decision models (e.g. TypeSafe Jev):** a hosted API (banks won't send telemetry out), and its own docs say injected text can move answers.
- **Open-weight decision models (e.g. Cloudflare Clef-flash)** stay a possible **later** layer on top of numeric features, fine-tuned per bank on-prem. Not needed to ship.

**Chosen:** plain-code rules with explicit thresholds and reason codes. That makes them explainable, auditable, fast, and free of training-data provenance questions.

## D5. Two-category gate for Tier 2

**Chosen:** an `agent` verdict from weighted rules needs score ≥ 70 **and** hits in ≥ 2 independent categories. No single noisy signal (for example trackpad coalescing) can convict on its own.

## D6. Detection slows attackers; step-up stops them

Accepted trade-off: a carefully humanized agent will often reach only `suspect`. Its decision for high-sensitivity actions is still `step_up`, and the passkey can't be completed without the human. This is the control that holds as agents improve.

## D7. Banners and browser UI are not signals

Chrome's "is being debugged / controlled" bars are drawn outside the page. JavaScript can't see them, and a local attacker can suppress them (`--silent-debugger-extension-api`). So we detect *how the page is being driven*, not the banner.

## D8. Don't use session-replay tools as the training/data source

**Rejected:** PostHog/rrweb-style recorders as the collector. They throttle `mousemove` to ~50 ms (~20 Hz versus 125–1000 Hz hardware), don't record keydown timing, `isTrusted` or coalesced counts, and their self-hosted option is not bank-grade. Fine for visually debugging harness runs only.

## D9. Accessibility first

Keyboard-only and screen-reader clicks (`detail === 0`) are excluded from motion rules. Autofill (`:autofill`), one-time-code fields and IME composition are excluded from keyless-text rules. Dictation can reach `suspect` (step-up), never `agent`. Hiding forms from the accessibility tree or rendering them in canvas to break agents is **rejected**: screenshot agents still work, and it locks out disabled users (ADA exposure).

## D10. Signals taken from Chrome's Modern Web Guidance (v0.2)

We adopted the signals that **measurably** worked in a real browser: Trusted Types report-only, `:autofill`, one-time-code, IME rules, `VisibilityStateEntry`, WebMCP declared agents, and background scheduling.

We rejected the ones that didn't: Event Timing `interactionId` (assigned to DevTools-Protocol input too). Keydown delivery latency ships experimental and off until there's a human baseline. See `RESULTS.md` §3.

## D11. Zero runtime dependencies, Apache-2.0

The SDK runs inside bank pages and backends, where every dependency is a supply-chain review item. Apache-2.0 was chosen for its explicit patent grant, which matters to enterprise adopters. The maintainer may relicense before first public release.


---

# 2026-11-12 logic review (v0.3)

D12–D28 come from one full read of the code on 2026-11-12 (00:00–01:00 EST, UTC−05:00), requested by the maintainer and carried out by Claude (model `claude-fable-5-2`) in Claude Code. The method for every entry was the same: state the gap, reproduce it with a failing test on the unchanged code, fix it, and re-run the unit tests, the synthetic sweep and the real-browser harness. Test names are given so the evidence can be re-run. Times are the order the decisions were made in, to the nearest few minutes.

The review's one-paragraph conclusion: **the server trusted the shape of the client's story more than it should.** It validated every field, but it let the client choose the session, the clock, the amount of evidence and, through eviction and overwrites, what evidence survived. It also issued `human` when no rule had been able to test anything. Most entries below remove one of those degrees of freedom.

## D12. Policy and sensitivity fail closed

- **Decided:** 2026-11-12 00:10 EST · **By:** Claude (`claude-fable-5-2`), review requested by the maintainer · **Status:** active
- **Context:** `policy[action] ?? 'high'` read inherited properties, so the action name `constructor` (or `toString`, `__proto__`, `valueOf`) returned a function instead of a sensitivity. `decide()` then fell through every `=== 'high'` check and returned **`allow`** for `suspect` and `unknown`. A policy typo (`'hihg'`) did the same. The docs promised "unknown actions default to high".
- **Options considered:** (a) `hasOwnProperty` check only; (b) validate the policy at startup into a `Map`, and make `decide()` treat anything unrecognised as `high`; (c) both, plus restrict action names to a safe character set.
- **Chosen:** (c). `createAgentDetect` throws on an invalid policy value. Lookup is a `Map`. `decide()` maps any non-sensitivity to `high`. Action names must match `^[A-Za-z0-9_.:-]{1,64}$`, otherwise the action is `unknown` (which is `high`).
- **Why:** a configuration mistake in a security control must make it stricter, never looser. Two layers because `decide()` is also a public function.
- **How it was decided:** reproduced: `POST /ad/decide {action:"constructor"}` with no session returned `allow`. Tests: `action names that collide with Object.prototype…`, `decide(): an unrecognised sensitivity is treated as high`, `construction rejects a short secret and an invalid policy value`.
- **Consequences / cost:** a deployment with a mistyped policy now fails to start instead of running open. That is intended.
- **Revisit when:** never, short of a different policy format.

## D13. `critical` sensitivity: a "human" verdict is evidence, not proof

- **Decided:** 2026-11-12 00:12 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active. **Narrows D6.**
- **Context:** D6 says "detection slows attackers; step-up stops them". Step-up only runs when the verdict is not `human`. Two ways to reach `human` exist and neither can be closed by rules: (1) the telemetry comes from a browser the attacker may control, so a patient attacker can feed the server a fabricated human trace (D17 makes that slow, not impossible); (2) a humanized agent that draws its delays from a log-normal distribution and overlaps key presses leaves only `mot.no_coalesced` (weight 35), which is below the `suspect` threshold.
- **Options considered:** (a) keep the table and document the hole; (b) make `high` always step up (removes the point of detection for most actions and ignores D1); (c) add a fourth level for actions where being wrong is unrecoverable.
- **Chosen:** (c). `Sensitivity` gains `critical`: Tier 1 → `block`; everything else, including a clean `human`, → `step_up`. `high` is unchanged.
- **Why:** this is the only control in the system that does not depend on data the attacker supplies. It is also what payment regulation already expects for the riskiest actions (strong customer authentication with dynamic linking, PSD2 RTS Art. 5; NIST SP 800-63B reauthentication).
- **How it was decided:** measured with a synthetic log-normal humanized trace (minimum-jerk paths, log-normal holds and intervals, rollover, 1 coalesced sample): verdict `human`, score 35, only `mot.no_coalesced`. On the same day the forged-trace test showed a full fabricated history was accepted in one request before D17. Tests: `"critical" actions always need the human…`, `authorize(): step_up only passes with a verified step-up…`.
- **Consequences / cost:** the bank must classify actions honestly. Every `critical` action costs the customer a passkey prompt. The passkey reference flow does not exist yet (roadmap P0), so today `critical` and `step_up` are decisions the bank has to wire itself.
- **Revisit when:** a signal exists that the client cannot fake (for example hardware-attested input), or calibration shows `mot.no_coalesced` can carry more weight per device class.

## D14. "human" needs evidence the rules could test

- **Decided:** 2026-11-12 00:14 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** `human` required 8 interactions **or** 200 pointer moves. The rules need far more than that before they can fire (3–5 mouse clicks, 20–30 key intervals, 150 moves). So a session could be too short for any rule to run and still be called `human`. It also did not need an environment snapshot, so stripping `env` from the batches silently disabled every environment rule.
- **Options considered:** (a) leave it, since short sessions are common; (b) raise `minInteractions`; (c) require that at least one input family had enough samples for its rules to have run, and that `env` arrived.
- **Chosen:** (c). `human` = `env` present **and** ≥ 8 interactions **and** (≥ 5 mouse/pen clicks **or** ≥ 20 typing intervals). Pointer movement alone no longer counts. Otherwise `unknown`. Configurable: `minPointerClicks`, `minKeyIntervals`.
- **Why:** `human` is a positive claim that lets money move on `high` actions. "Nothing fired" only means something if something could have fired. This is the project's own rule 2 (missing data means `unknown`) applied to missing *evidence*. The numbers 5 and 20 are not tuned: they are the largest minimum sample of the click rules and the minimum of the keyboard rules.
- **How it was decided:** reproduced: 2 teleport clicks with 0 ms holds at the exact centre plus 17 keys at 12 ms scored `human` with zero hits. Real browser: attack scenario I (same pattern through Playwright) is `unknown` → `step_up`. Tests: `a short robotic session is "unknown"…`, `no environment snapshot means never "human"`, `pointer movement alone is not evidence of a human`.
- **Consequences / cost:** more step-ups for real people. Synthetic sweep, 500 seeds: a 3-action human session is `unknown` 54% of the time; keyboard-only users 0.8%. **Touch-only sessions can never be `human`** (no touch rules exist, see D22), so mobile-web customers step up on every `high` action. Keyboard-only and screen-reader users who type little are `unknown` more often than mouse users; that is extra friction, not a conviction, but it lands unevenly and must be measured in calibration.
- **Revisit when:** touch rules exist; or calibration shows the step-up rate is unacceptable, in which case lower the sensitivity of specific actions rather than this floor.

## D15. Score the most recent actions on their own (dilution)

- **Decided:** 2026-11-12 00:16 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active, **uncalibrated**
- **Context:** every Tier 2 rule is a ratio or a median over the whole session. The main scenario this project exists for is an agent taking over a session a human started. Forty human clicks followed by twelve robotic ones scored `human`: the history diluted the takeover.
- **Options considered:** (a) time window (last N seconds): an agent evades it by waiting; (b) count window (last N actions): cannot be waited out; (c) per-rule absolute counts instead of ratios: rewrites every rule; (d) several window sizes, worst wins: more false-positive surface.
- **Chosen:** (b). `scoreTrace` also scores the last 8 actions (trusted clicks and typing-burst starts, with a 3 s lead-in) and returns the worse verdict. The recent pass can only raise a verdict to `suspect` or `agent`; its `unknown` or `human` never overrides the session. `ScoreResult.scope` says which pass decided. `tailActions: 0` turns it off.
- **Why:** N = 8 is the smallest window in which the click rules can reach their own minimum samples (5 holds, 4 centred clicks, 3 gaps). It is on by default because off is a known evasion, and because the worst it can do to a real person is a step-up: only Tier 1 blocks, and Tier 1 does not depend on ratios.
- **How it was decided:** reproduced the takeover as `human` on the old code. After: sweep `takeover` profile 500/500 `agent`; `human-long (40 actions)` 500/500 `human`. Tests: `takeover: a long human session followed by a robotic agent…`, `the recent-window pass never downgrades…`.
- **Consequences / cost:** rules now run on 8-action windows at every decision, so small-sample noise matters more. Scoring costs two feature passes. An agent that takes fewer actions than a rule's minimum after the human stops is still not caught (one click on "Send" cannot be judged by behaviour).
- **Revisit when:** shadow-mode data shows the per-rule firing rate in the recent window on real humans. If it is too high, raise N before turning the pass off.

## D16. Evidence cannot be erased, and eviction cannot create it

- **Decided:** 2026-11-12 00:18 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** three separate bugs with one cause. Streams were capped at 5,000 events, oldest dropped first, each stream on its own. (1) A honeypot hit or an untrusted click simply aged out of a long session. (2) `env` was overwritten by any later batch, so a clean snapshot erased `webdriver: true`. (3) Worse, eviction *manufactured* evidence: pointer moves fill their stream in about 80 seconds, clicks last far longer, so old clicks had no moves before them and were counted as teleports and frozen-pointer gaps. A real human with a long session became `suspect`.
- **Options considered:** (a) raise the caps (delays the bug, costs memory); (b) score on every batch and keep a running verdict (too much CPU: tens of thousands of sessions flushing every 3 s); (c) latch Tier 1 hits before evicting from a stream that can carry them, merge `env` monotonically, and record an eviction watermark per stream so rules can tell "evicted" from "did not happen".
- **Chosen:** (c). `trace.cut[stream]` holds the latest evicted timestamp. `mot.jump_arrival` and `tim.still_gaps` only judge clicks whose pointer history is still present (`motionClicks`). Untrusted events too close to an evicted trusted stream are skipped (they were judged before eviction). The server scores once and latches Tier 1 hits (`Session.sticky`) before trimming `click`, `key`, `input`, `dom` or `vis`. Trimming goes to 80% of the cap so that pass runs once per fifth of a cap. `mergeEnv` ORs the automation flags and unions the lists.
- **Why:** a session's verdict must be monotonic in what it has shown: more activity can add evidence, never remove it, and a storage limit must never be read as behaviour.
- **How it was decided:** measured on the old code: a 300-action synthetic human (19,740 moves) scored `suspect` (67) with `mot.jump_arrival` and `tim.still_gaps`. Tests: `long human session: evicted pointer history…`, `an app-chained synthetic click is not convicted after the trusted key that chained it was evicted`, `Tier 1 evidence is sticky…`, `a later batch cannot overwrite an automation flag…`, `environment flags are monotonic…`.
- **Consequences / cost:** a Tier 1 hit now lasts the whole session, including a false one (for example app code calling `el.click()` from a timer). Tier 2 is still not sticky: an agent's early Tier 2 evidence can age out, which is acceptable because the recent-window pass (D15) covers the present.
- **Revisit when:** a compact store (typed arrays) makes it cheap to keep whole sessions.

## D17. The server owns the timeline

- **Decided:** 2026-11-12 00:20 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** event times were whatever the client sent, in milliseconds since *that page's* collector started. Two problems. On a multi-page site every navigation restarted the clock at 0 inside the same session, so page 2's events interleaved with page 1's: strokes were stitched across pages and an untrusted click on page 2 could look "chained" to a trusted click on page 1. And nothing tied the client's clock to real time, so a complete fabricated human session could be posted in one request the instant a session opened.
- **Options considered:** (a) client keeps one clock across pages using `performance.timeOrigin` (still client-controlled, breaks on wall-clock changes); (b) one detection session per page load (loses history, makes laundering trivial); (c) the server rebases: it knows when each page called `/session` and asks the collector what its clock read at that moment (`ct`).
- **Chosen:** (c). `t' = t + (openAt − ct)` puts every event on ms-since-session-creation. Events more than 5 s ahead of the server's clock are dropped (`dropped.future`). Events more than 10 s before the page's `/session` call are dropped (`dropped.stale`), except visibility entries, which are clamped so the page's initial hidden/visible state survives. Both counters go to the audit hook.
- **Why:** a lie about `ct` only shifts the liar's own events; it cannot buy more than the two fixed windows. Violations are dropped rather than punished because a stalled mobile uplink can make honest events look early, and dropped evidence already fails closed (`unknown`).
- **How it was decided:** tests over real HTTP: `a whole forged "human" history cannot be uploaded in one go…` (a 60 s synthetic human posted at once: the old server returned `allow` for a transfer; now ≤ 2 clicks survive and the decision is `step_up`), `each page load is placed on the session timeline…`, `ancient "pre-open" history is dropped…`. Browser test: `the /session call reports the collector clock…`.
- **Consequences / cost:** **forgery is slowed, not stopped.** An attacker can still drip-feed a fabricated trace in real time; that is what D13 and D19 are for. A `/session` request that stalls for more than 5 s on the uplink costs that page its earliest events.
- **Revisit when:** real-network data shows honest drops are common (then widen the slack and log, do not remove the bound).

## D18. Bind detection to the app's authenticated session

- **Decided:** 2026-11-12 00:22 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active (optional in code, **required in the production checklist**)
- **Context:** a detection session was identified only by an id the browser chose to send. A flagged client could ask for a fresh session and start clean. A decision token carried that id and nothing the bank's API could compare with its own session, so a token earned by a human in one account could be handed to an agent in another (relay).
- **Options considered:** (a) document it; (b) have the SDK set its own cookie (a second session system to secure, and it still is not the bank's session); (c) let the integrator say who the caller is.
- **Chosen:** (c). `bind: (req) => string | null`. When set: all three endpoints return 401 without it; there is exactly one detection session per binding and the client's `sid` is ignored on open; `/collect` and `/decide` require the session to belong to the caller; tokens carry `sub`, a keyed hash of the binding (never the raw value, which is often an HttpOnly cookie); `authorize()` requires the binding of the request it is authorizing.
- **Why:** the bank already has the only trustworthy notion of "this user's session". Reusing it closes laundering and relay with one mechanism and adds no state of our own.
- **How it was decided:** tests: `bind: endpoints refuse callers without an app session`, `bind: opening a "fresh" session does not launder a flagged one`, `bind: a token minted in one app session is useless in another`. Real browser: attack scenario J (token from another session) is refused by the demo API with `binding`.
- **Consequences / cost:** without `bind` (the default, so the SDK still runs standalone), laundering by re-opening remains possible; the integration guide says so. Pre-login pages have no app session: bind those to a pre-auth session id.
- **Revisit when:** Device Bound Session Credentials are widely available; the binding should then be the device-bound session.

## D19. Tokens: single use, bound to the transaction, one `authorize()` call

- **Decided:** 2026-11-12 00:24 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** a token said "`allow` for `transfer`" for 120 seconds. The agent in the page can read it, so one human-approved transfer authorized any number of other transfers, to any payee, for two minutes. The docs told integrators to proceed on `notify` and to "decide again" after a passkey, but the only documented API check was `decision === 'allow'`, so `notify` was refused and nothing could ever turn a `step_up` into an action. Secrets as short as 16 characters were accepted.
- **Options considered:** (a) shorten the TTL (narrows, does not close); (b) adopt JWT (a format with a long history of verification mistakes, and no zero-dependency reason to take it on); (c) keep the small HMAC format and add what was missing.
- **Chosen:** (c). Payload `{v:1, jti, iat, exp, sid, sub?, action, decision, ctx?}`. `ctx` is an opaque transaction context supplied at `/decide` (`contextHash(payee, amount, …)` on both sides) and recomputed by the API from the request it is about to execute. `authorize(token, {action, ctx, req, stepUpVerified})` is the one call an API makes: signature (any configured secret), expiry, action, ctx in both directions, binding, decision (`allow` and `notify` proceed; `step_up` only with `stepUpVerified: true`; `block` never), then single use by `jti`. Tokens must have exactly two parts. Secrets must be ≥ 32 characters; an array rotates (first signs, all verify).
- **Why:** binding the authorization to the exact amount and payee is the "dynamic linking" requirement of PSD2 strong customer authentication, and it is the right shape regardless of jurisdiction. One function, because every check an integrator has to remember is a check someone forgets (the lesson of RFC 8725). Key length follows RFC 2104 / NIST SP 800-107: an HMAC key shorter than the hash output weakens it.
- **How it was decided:** tests: `authorize(): a token works once…`, `…bound to the transaction it was issued for`, `…step_up only passes with a verified step-up, block never passes…`, `tokens: unique ids, strict format, and secret rotation`. Browser test: `decide(action, ctx) binds the token…` (client and server hash agree).
- **Consequences / cost:** the replay cache is in memory (200,000 ids, fails closed when full), so single use holds per process; several instances need a shared store (roadmap). `verifyToken()` remains for services that verify themselves, and does **not** enforce single use or the decision. Breaking: secrets of 16–31 characters are now rejected.
- **Revisit when:** the pluggable store lands (move the replay cache into it), or an asymmetric signature is needed so APIs can verify without holding the signing key.

## D20. Silence is never a better deal than being seen

- **Decided:** 2026-11-12 00:26 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** with no session at all the server stepped up on `medium`. With a session that had been opened and then sent nothing, the verdict was `unknown`, which is `allow` on `medium`. So blocking `/ad/collect` turned an `agent → step_up` into `allow`.
- **Options considered:** (a) make `unknown × medium` step up always (heavy friction: every quick, legitimate action); (b) treat a session with no telemetry exactly like no session.
- **Chosen:** (b). A session with no `env` or with zero pointer, click, key and input events, and no latched Tier 1 hit, gets the no-session answer: `allow` on `low`, `step_up` on everything else.
- **Why:** an honest collector always has something by decision time, because `decide()` flushes first and the click that triggered the action is in that flush. Total silence therefore means the collector was blocked or never ran.
- **How it was decided:** test `a session that sent no telemetry is treated like no session…` (failed on the old code with `allow`).
- **Consequences / cost:** **the residual is real and stated in the threat model:** an attacker who sends an environment snapshot and one plausible click is `unknown` with a little evidence, which is still `allow` on `medium`. Anything that must hold against a client that manipulates its telemetry has to be `high` or `critical`. Users whose ad blocker eats the collector's requests now step up on `medium` as well as `high`.
- **Revisit when:** the maintainer decides `medium` should also hold against hostile clients; that is a change to the decision table (D1), not to this rule.

## D21. Password-manager fills are not Tier 1

- **Decided:** 2026-11-12 00:28 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active. Extends D9.
- **Context:** `evt.untrusted` is Tier 1 (`block` on `medium` and above) for any script-dispatched click, key or input not chained to a trusted event. Extension password managers (Bitwarden, 1Password, LastPass and others) fill by doing exactly that from a content script: `click()`, synthetic key events, set the value, dispatch `input`. Their trigger is a click in the extension's own UI or a browser shortcut, neither of which the page sees, and autofill-on-load has no trigger at all. So a very common, legitimate tool produced the hardest verdict in the system. The only autofill the code knew about was the browser's native one (`:autofill`).
- **Options considered:** (a) demote `evt.untrusted` to Tier 2 (weakens the strongest signal against script agents on every field); (b) allowlist extensions (the page cannot identify an extension); (c) exempt by *what was filled*: credential and identity fields.
- **Chosen:** (c). The collector marks an untrusted event `af: 1` when its target is a password input, has a credential/identity `autocomplete` token (`username`, `current-password`, `one-time-code`, `cc-number`, address and name tokens…), or matches the integrator's `autofillFields` selectors. Those events are counted in `untrustedAutofill` and excluded from `evt.untrusted`. The server ignores `af` on trusted events.
- **Why:** a password manager fills the user's own credentials; an attacking agent needs the amount and the payee, which are not autofill fields. The flag is only ever set on untrusted events, so it reveals nothing about a human's typing.
- **How it was decided:** behaviour of the extensions is from their published source and documentation, **not measured here with a real extension installed**. The mechanism is tested in a real browser with script-dispatched events: `script-dispatched events are tagged by field class…`, and in unit tests: `password-manager extension fills… are not Tier 1`.
- **Consequences / cost:** a script agent that fills only credential fields is not Tier 1. A script running in the page could add `autocomplete="email"` to the amount field before filling it; that attacker can also disable the collector outright, so this does not change the trust boundary. Login forms whose username field has no `autocomplete` attribute still trip Tier 1 when a manager fills them: integrators must add the attribute (also WCAG 1.3.5) or list the field in `autofillFields`.
- **Revisit when:** a real-extension harness exists (roadmap), and see the open question in D28 about whether `evt.untrusted` should block at all.

## D22. Touch: tag compatibility mouse events; no rule coverage means `unknown`

- **Decided:** 2026-11-12 00:30 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** after a touch tap the browser dispatches `mousedown` and `mouseup` for compatibility, with the same timestamp. `btn` events had no pointer type, so every phone user produced near-zero "holds" and fired `tim.fixed_hold` after five taps. Separately, touch clicks are excluded from every motion rule, so a touch session had no behavioural rule that could fire and was `human` after 8 taps, which also made touch emulation an evasion.
- **Chosen:** `BtnEv.pt` carries the pointer type of the preceding `pointerdown`; only mouse and pen presses are holds. Touch sessions get no special case: under D14 a session with no testable input family is `unknown`.
- **Why:** the first is a plain false positive. The second is D14 applied honestly: we have no evidence about touch input, so we do not claim `human`.
- **How it was decided:** measured in Chromium with a touch context: three taps produced `btn` pairs with identical timestamps (`{"t":15,"k":"d"},{"t":15,"k":"u"}`). Tests: `touch taps: the compatibility mouse events are tagged as touch` (browser), `touch taps: the compatibility mousedown/mouseup pair… does not fire tim.fixed_hold` (unit).
- **Consequences / cost:** mobile-web users step up on every `high` action until touch rules exist. On-screen keyboards that send key events with near-zero holds can still fire `key.fixed_hold` (not measured on real devices).
- **Revisit when:** touch rules are built (contact size, pressure, tap duration) and calibrated per device class.

## D23. The browser's visibility timeline outranks the handler-time flag

- **Decided:** 2026-11-12 00:31 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** `evt.input_while_hidden` is Tier 1. It fired if the `VisibilityStateEntry` timeline said hidden **or** `document.hidden` was true when the handler ran. The handler runs after the event's timestamp; a key pressed while visible and dispatched after the tab was hidden would convict a human. The code's own comment called the timeline "immune to handler-time races" and then OR-ed the racy flag back in.
- **Chosen:** when the timeline covers an event's time, only the timeline is consulted. The handler-time flag is used where there is no timeline (non-Chromium browsers, or entries evicted).
- **Why:** a Tier 1 rule must have no known race.
- **How it was decided:** by reading the code; the race itself was **not reproduced** in a browser. Test: `the browser visibility timeline overrides a handler-time "hidden" flag…`.
- **Consequences / cost:** none known for detection: a real background-tab typing attack is hidden on both clocks. Still open: Chrome's window-occlusion tracking has marked visible windows hidden under some VDI software; a user typing there would hit Tier 1. Listed in `RULES.md` as a calibration item.
- **Revisit when:** headed tests in real Chrome under VDI are available (roadmap).

## D24. Masked regions: a click position on a PIN pad is content

- **Decided:** 2026-11-12 00:32 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** the privacy contract says no input values. Clicks are recorded with coordinates and target size. On an on-screen PIN pad or security-code grid, the coordinates *are* the digits. The pointer path to each key leaks the same thing.
- **Options considered:** (a) tell integrators not to load the SDK on such pages (they will anyway); (b) detect keypads heuristically (unreliable); (c) an explicit mask.
- **Chosen:** (c). `maskSelectors` (default `[data-ad-mask]`). Inside a masked element: clicks are sent with zero geometry and `mk: 1` (the server zeroes geometry again); pointer moves are not recorded and the first move outside is marked as a re-entry; key and input events are not recorded. Masked clicks count as interactions but are not pointer evidence.
- **Why:** rule 1 of this project is the privacy contract. An explicit attribute is the only version that can be reviewed.
- **How it was decided:** browser test `masked region (PIN pad): no click geometry, no pointer path, no key timing leaves the browser`; unit tests `masked clicks (PIN pads)…`, `sanitizer: new fields are whitelisted and clamped`.
- **Consequences / cost:** it only works if the integrator marks the region. Behaviour inside a mask cannot be judged, so an action reached only through a masked keypad should be `critical`. Not masked by default and still a residual: key **timing** in password fields (inter-key intervals carry some information about a password). Integrators whose privacy review objects can mask password fields, at the cost of typing evidence on the login page.
- **Revisit when:** a privacy review asks for password fields to be masked by default.

## D25. One printable keydown pays for one `insertText`

- **Decided:** 2026-11-12 00:33 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** `evt.text_without_keys` asks whether inserted text had a keydown within 500 ms. Any trusted keydown counted, including Shift or Tab, and one keydown excused any number of insertions. Press one key, then inject the rest of the form with the DevTools Protocol's `insertText`, and nothing was keyless.
- **Chosen:** in the collector, only a keydown that types a character (single-character `key`, not a Ctrl/Cmd shortcut; AltGr allowed) arms the pairing, and each one is consumed by the first `insertText` that follows.
- **Why:** it matches how keyboards work: one key, one inserted character (auto-repeat sends a keydown per character).
- **How it was decided:** browser test `one printable keydown pays for one insertText…`: real key then `Input.insertText` → the injected text reports `kd: -1`; Shift then `insertText` → `-1`.
- **Consequences / cost:** tools that insert several characters per key press without composition events (some text expanders) will now look keyless and can reach `suspect` like dictation does. Not measured on Safari or Firefox.
- **Revisit when:** calibration shows a real input method that breaks the one-to-one assumption.

## D26. Request hygiene, bounded cost, bounded memory

- **Decided:** 2026-11-12 00:34 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context and what was chosen** (each item was a separate small gap):
  - **Cross-site requests.** Endpoints took any content type, so another site could post to them as a "simple" request. Now `Content-Type: application/json` is required (415), which forces a CORS preflight, and `Sec-Fetch-Site: cross-site` is refused (403) unless `allowCrossSite` is set (Fetch Metadata).
  - **Session flood.** The 50,000 cap was enforced once a minute and evicted the oldest *created* session. Now the cap holds at insert time and evicts the least recently *used*.
  - **Algorithmic cost.** Feature extraction had quadratic paths (hold pairing, key-up lookup, visibility lookup, last-move-before-click). An attacker-shaped trace took 86 ms per `/decide`, on Node's only thread. All are now linear or binary search: about 10 ms at the stream caps (guarded at 25 ms by a test).
  - **Memory.** Per-stream caps replace the flat 5,000: `ptr` 5,000, `key`/`input` 3,000, `btn` 2,000, `click`/`scroll` 1,000, `focus`/`dom`/`vis` 500. Worst case is about 16,500 events, roughly 1.5 MB, per session.
  - **Audit hook.** `onDecision` received `body.sid` straight from the request (any type, any size). It now gets the server's own id or `null`, plus sensitivity, scope, `jti` and the drop counters, and an exception in the hook cannot affect the response.
  - **Nonce comparison** is constant time. JSON bodies must be objects.
  - **`exposeReasons` / `debug`** throw at startup when `NODE_ENV=production`.
  - **Weight overrides** are clamped to 0–99, so a negative weight cannot reduce a score.
  - **Trusted Types budget.** The collector's cap of 50 reports counted the app's own `innerHTML` calls, so an app that sets `innerHTML` on a timer blinded `dom.injected_html` within about a minute (the demo page did exactly this). Page-origin and third-party reports are now dropped before the cap.
- **How it was decided:** tests `requests must be JSON and same-site…`, `the session cap holds at insert time…`, `feature extraction stays fast on an adversarial trace…`, `per-session memory is bounded…`, `the audit hook never receives attacker-shaped session ids`, `exposeReasons and debug refuse to start…`, `a negative or oversized weight override…`; browser test `the page's own innerHTML use does not consume the injection-report budget…`.
- **Consequences / cost:** 50,000 sessions at the worst case is far more memory than one Node process has; the default is unchanged because typical sessions are much smaller, but `maxSessions` must be sized against the worst case. Rate limiting is still the edge's job and is now a stated deployment requirement.
- **Revisit when:** the pluggable store lands.

## D27. Collector transport: serialised flush, re-open, fail closed

- **Decided:** 2026-11-12 00:36 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** active
- **Context:** (1) `decide()` flushes while the timer flush may be in flight; the server rejects a batch that arrives after a later one, so the slower batch was lost. (2) After a server restart, a session expiry, or another tab taking the nonce, the collector received 403 forever and the user stepped up on everything until reload. (3) `decide()` returned whatever JSON came back, so an error body had no `decision` and typical page code fell through to "proceed".
- **Chosen:** flushes are queued, never concurrent (the `pagehide` beacon is the exception). A 403 triggers a re-open, at most once every 5 s, and the environment snapshot is sent again. `decide()` returns `step_up` on any network error, non-2xx status or malformed reply.
- **How it was decided:** browser tests `flushes are serialised…` (the old bundle produced statuses `200,409` in the same test), `the collector re-opens its session…`, `decide() fails closed in the page…`.
- **Consequences / cost:** the batch that drew the 403 is still lost. The page-side fail-closed is a courtesy: the API's `authorize()` is what enforces.

## D28. Considered in this review and deliberately not done

- **Decided:** 2026-11-12 00:40 EST · **By:** Claude (`claude-fable-5-2`) · **Status:** open questions for the maintainer. Each has a recommendation.

| Question | Why it was not done now | Recommendation |
|---|---|---|
| Should `evt.untrusted` **block**, or only step up? | Script-dispatched events also come from assistive and productivity extensions (keyboard-navigation extensions, voice-control extensions, form fillers) that call `el.click()`. A human using one passes a passkey; a `block` locks them out. Changing which Tier 1 rules block is a change to the decision table and to the published results (scenario D). | Split Tier 1 into "automation environment" (webdriver, headless, automation globals: block) and "script-driven input" (step up). Decide after shadow-mode data shows how often real customers hit `evt.untrusted`. |
| Tighten the 100 ms "app-chained" window to "same task as a trusted event" | Would close the "ride on the user's own keystroke" evasion, but apps that call `el.click()` from `setTimeout` or after a fetch would become Tier 1. | Ship the same-task flag as data first, measure in shadow mode, then change the rule. |
| New rules: click with no pointer move to that position (`orphan click`), touch events on a device reporting no touch points, navigation-key hold times | Each is a new rule and needs the full evidence process in `CLAUDE.md`. | Roadmap P2. |
| Change the default `basePath` from `/ad` | Paths containing `/ad/` are a likely target of ad-blocker filter lists, which would silently turn those users into `unknown`. **Not verified** against EasyList/EasyPrivacy in this review. | Verify, then pick a neutral default before 1.0. Integrators can already set `basePath` and `endpoint`. |
| Shadow mode (`mode: 'shadow'`) | Small to build, but a switch that makes every token `allow` deserves its own review. | Roadmap P0 item 1, unchanged. |
| Make the humanized log-normal agent detectable | It is not, with the current signals (D13). Raising the weight of `mot.no_coalesced` to cross the `suspect` line would convict trackpad users (D5). | Per-device-class calibration (roadmap), and classify money movement as `critical` meanwhile. |
| Mask password fields by default | Loses typing evidence on login pages. | Leave to the privacy review (D24). |

---

# 2026-11-12, later: scope decisions by the maintainer

## D29. The SDK signals that a step-up is needed; performing it is the integrator's

- **Decided:** 2026-11-12 04:10 EST · **By:** the maintainer, in conversation; recorded by Claude (`claude-fable-5-2`) · **Status:** active. Narrows the roadmap item written under D13 and D19.
- **Context:** the v0.3 review made "passkey step-up reference flow" the top P0 item, on the grounds that `step_up` and `critical` are only decisions until something completes them.
- **Options considered:** (a) build a WebAuthn reference flow in this repo; (b) stop at the signal and define the contract around it.
- **Chosen:** (b). The product's responsibility ends at saying "a step-up is needed here" and at accepting the result (`authorize(…, { stepUpVerified: true })`). Which mechanism is used (passkey, approval in the bank's app, something else) and its implementation belong to whoever integrates the SDK.
- **Why:** the maintainer's call. Banks already have step-up mechanisms and their own requirements for them; a reference flow would be a second product to secure and maintain, and would need CBOR/WebAuthn parsing in a zero-dependency codebase.
- **How it was decided:** not measured; a scoping decision.
- **Consequences / cost:** the security of the whole design still rests on that step-up being something the agent cannot complete and being tied to the transaction. That is now a requirement stated to integrators (`INTEGRATION.md` §4), not something this repo can test. The demo will keep showing a message instead of a real prompt.
- **What remains in scope:** the *signal path*. Agreed in the same conversation: the decision should reach the UI as the API's reply to the user's own action (no polling), ideally with the API asking for the decision itself (`decideFor(req, action, ctx)`, roadmap P0 #1) rather than the page.
- **Revisit when:** integrators repeatedly get the transaction binding wrong, which would argue for at least a verifier helper.

## D30. Rate limiting is not a product feature

- **Decided:** 2026-11-12 04:10 EST · **By:** the maintainer, in conversation; recorded by Claude (`claude-fable-5-2`) · **Status:** active. Supersedes roadmap P1 item 8 as written on 2026-11-12 00:40.
- **Context:** the review listed "rate limiting guidance and hooks" as P1, because `/session`, `/collect` and `/decide` have no request-rate limits and `/decide` can be used as an oracle.
- **Chosen:** no rate limiting in the SDK. It will be handled by other means in the deployment.
- **Why:** the maintainer's call; it is infrastructure the deployment already has.
- **How it was decided:** not measured; a scoping decision.
- **Consequences / cost:** the endpoints **assume** it exists. What the module does on its own is bound the cost of each request (512 KB body cap, per-stream caps, session cap at insert, linear-time scoring) and of state (LRU eviction). Without external rate limiting, a flood can still evict legitimate sessions (they then step up) and can probe `/decide` freely. This is stated in the threat model and the production checklist.
- **Revisit when:** a deployment appears that has no such layer.

---

# 2026-11-12, later: first real human session

## D31. Presses on a native `<select>` are not button holds

- **Decided:** 2026-11-12 04:14 EST · **By:** Claude (`claude-fable-5-2`), from the maintainer's own captured session · **Status:** active
- **Context:** the maintainer used the demo by hand in Chrome 157. Their mouse holds were 79–135 ms, except one of exactly 0 ms. It was the click on the payee `<select>`: when the OS popup opens, the page gets `mousedown` and `mouseup` with the same timestamp. `tim.fixed_hold` fires on a median hold under 8 ms over ≥ 5 clicks, so a person working through a form of dropdowns would have looked like an auto-clicker.
- **Options considered:** (a) raise the rule's minimum sample; (b) drop 0 ms holds in feature extraction (also drops the agent's); (c) do not record presses whose target is a `<select>`.
- **Chosen:** (c), in the collector.
- **Why:** on that element the pair carries no information about how long anyone held the button, for a human or an agent, so recording it can only mislead.
- **How it was decided:** measured in the capture (`btn d` and `btn u` both at t = 3664.6 ms, followed by the popup's `click` with `detail` 0). Browser test written first and seen failing: `presses on a native <select> are not recorded as button holds…`.
- **Consequences / cost:** an agent's press on a `<select>` is not recorded either. Custom (non-native) dropdowns are unaffected and behave like any other element.
- **Revisit when:** another native control turns out to do the same (date, colour and file pickers are unmeasured).

## D32. `mot.no_coalesced` fires on a real human: what to do with it

- **Decided:** not decided. Recorded 2026-11-12 04:14 EST by Claude (`claude-fable-5-2`) · **Status:** open question for the maintainer
- **Context:** the first real human measured (the maintainer, a mouse on an Apple M5 Max Mac, Chrome 157) had more than one coalesced sample in only 1.4%–2.3% of pointer moves, with events arriving at about 76 Hz. The rule fires below 2%. It fired twice and un-fired twice within two short sessions. The verdict stayed `human` because 35 points alone is under the `suspect` line, but one more Tier 2 hit of any kind would have made it `suspect`.
- **Why it matters:** this is the rule the threat model leans on for humanized agents (D13). On this device it does not separate a person from an agent: the person is at ~2%, an agent at 0%, and the threshold is between them with a sample of a few hundred moves.
- **Options:**
  1. **Leave it** and wait for calibration. Cost: real users on similar hardware are one benign hit from a step-up.
  2. **Make it experimental (off by default)** until it is calibrated per device class. Cost, from the harness: the humanized agent (scenario C) drops from 61 to about 41, still `suspect` but only just; the extension scenario (H) drops from 51–68 to as low as 25, which is `human`.
  3. **Lower its weight** (for example to 20). Keeps some signal, reduces how often one extra hit crosses the line. Still a guess.
  4. **Redefine it** around something that did separate in this data. Needs the full rule process and more than one human.
- **Recommendation:** option 2 or 3, decided after two or three more people on different hardware (a high-polling-rate mouse, a trackpad, Windows) have run `npm run demo:capture`. One person is not enough to change a rule, and it is enough to stop trusting this one.
- **Not known:** which mouse this was and its polling rate; whether Chrome on macOS coalesces differently from Windows; trackpads.

## D33. `mot.teleport_press`: judge a single click on its own

- **Decided:** 2026-11-12 04:20 EST · **By:** Claude (`claude-fable-5-2`), prompted by the maintainer's own test · **Status:** active as an experimental rule, off by default. Whether to switch it on by default is the maintainer's call.
- **Context:** the maintainer filled the transfer form by hand and then asked Claude in Chrome to click "Review & send". The transfer was allowed (`human`, 12). The maintainer's question: the browser shows a banner when the extension is in control, so can we not know? This is the "one robotic action after a human did everything" row that `RULES.md` already listed as not caught, now seen for real.
- **What was looked at:**
  - *The banner.* Chrome's debugging infobar is browser UI and invisible to the page (D7, unchanged).
  - *The extension's in-page node.* Inspected live: a bare `div` appended to `body`, no id, class or attributes, `display: contents`, closed shadow root. It cannot be selected reliably, the vendor can change it at will, and benign extensions inject nodes of the same shape. `dom.foreign_nodes` saw it (12 points). Rejected as a hard signal.
  - *The click.* One pointer move 1 ms before the press, a 1 ms hold, 0.3 px from centre. A person's click on the same machine: 3–24 moves in the preceding half second and a 79–135 ms hold.
- **Options considered:** (a) lower the minimum samples of the existing ratio rules (they would fire on single coincidences); (b) a marker for this product's overlay (not possible, above); (c) a rule that judges one click by two independent impossibilities at once.
- **Chosen:** (c). `mot.teleport_press`, Tier 2, motion, weight 45 (enough for `suspect` alone, so `step_up` on `high`): at least one mouse click where the pointer arrived in a single jump of ≥ 100 px, or never moved, **and** the press was released in under 8 ms. Shipped `experimental: true`.
- **A correction made by the real data:** the first version copied `mot.jump_arrival`'s exemption for a pointer re-entering the page, and missed the real click. When the person's mouse leaves for the agent's panel, the agent's one move *is* the re-entry. The per-click rule has no such exemption: a person who re-enters exactly on a target still holds the button for about 100 ms. `mot.jump_arrival` keeps its exemption.
- **Why experimental:** the project's own rule is that anything not calibrated on real humans ships off. One human has been measured. Unmeasured and plausible false positives: tap-to-click with no pointer travel, remote desktop delivering a jump and a press/release together, assistive tools that warp the pointer and click instantly.
- **How it was decided:** unit tests written first and seen failing (`one teleport-press click at the end of a human session…`, `…needs BOTH halves…`, `…does not fire on any human or accessibility profile…`). Replay of the real captures with the rule on: the human-then-agent transfer goes from `allow` to `step_up`; the person's six own captures are unchanged; Claude in Chrome alone fires on 10/10 clicks. Synthetic sweep: 0 fires in 3,000 human-profile sessions; 500/500 on the xdotool-style and DevTools-Protocol click agents; 0 on the humanized agent (it travels and holds, by design).
- **Consequences / cost:** off by default means that, today, the observed case still goes through unless the integrator enables the rule (`scoreConfig.experimental: ['mot.teleport_press']`) or marks the action `critical`. `npm run demo:capture` turns experimental rules on so they are evaluated on every captured session. An agent defeats it by adding a hold of a few tens of ms or a few moves; then it is back to needing a pattern. It does nothing for keyboard-driven or touch actions.
- **Revisit when:** three or more people on different hardware, including a trackpad with tap-to-click, have been captured with it on. If it stays silent on them, turn it on by default.

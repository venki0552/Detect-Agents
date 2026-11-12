# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report privately through GitHub's private vulnerability reporting (Security → Report a vulnerability) or email `<security-contact@example.com>`. Expect an acknowledgement within 5 business days.

In scope:
- Ways to forge or replay a decision token, or get `authorize()` to accept a token for another action, another transaction (`ctx`), another session (`sub`), a second use, or a `block` / unverified `step_up` decision
- Ways to get `allow` for a `critical` action, or for any action through a configuration that should fail closed (unknown action, malformed policy, missing telemetry)
- Ways to erase evidence the server already holds: un-latching a Tier 1 hit, clearing an environment flag, swapping sessions when `bind` is configured
- Ways to get events accepted that are stamped ahead of the server's clock, or to make page loads collide on the session timeline
- Sanitizer, sequence or nonce bypasses
- Crashes, CPU or memory exhaustion of the server module from crafted batches (scoring is expected to stay near-linear at the stream caps)
- Privacy leaks: the collector recording key values, input values or other content it promises not to, or anything measurable inside a masked region

## Not vulnerabilities

- **"I can read the rules."** The rules are public by design. The security boundary is the server plus step-up authentication, not secrecy of the collector.
- **Evading a Tier 2 rule with a humanized agent**, including reaching `human`. Known and documented (see `docs/THREAT-MODEL.md`), though better detection ideas are welcome as normal issues or pull requests.
- **Getting `human` by feeding a fabricated session in real time.** Known: the client supplies the data. The controls are `critical` step-up and transaction-bound tokens. A way to do it *instantly*, or to keep a fabricated session after a Tier 1 hit, **is** in scope.
- **Tampering with the collector from a script running in the page.** That attacker can also remove the collector. What matters is that missing evidence never produces `human`; a way to make it do so is in scope.
- Findings that need a compromised server or a leaked HMAC secret.

## Supported versions

Pre-1.0: only the latest release gets fixes.

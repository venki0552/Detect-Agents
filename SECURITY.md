# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report privately through GitHub's private vulnerability reporting (Security → Report a vulnerability) or email `<security-contact@example.com>`. Expect an acknowledgement within 5 business days.

In scope:
- Ways to forge or replay a decision token, or bypass `verifyToken`
- Ways to make the server return `allow` for a high-sensitivity action without the session's real events (e.g. sanitizer bypasses, sequence/nonce bypasses)
- Crashes or memory exhaustion of the server module from crafted batches
- Privacy leaks: the collector recording key values, input values or other content it promises not to

## Not vulnerabilities

- **"I can read the rules."** The rules are public by design. The security boundary is the server plus step-up authentication, not secrecy of the collector.
- **Evading a Tier 2 rule with a humanized agent.** Expected (see `docs/THREAT-MODEL.md`), though better detection ideas are welcome as normal issues or pull requests.
- Findings that need a compromised server or a leaked HMAC secret.

## Supported versions

Pre-1.0: only the latest release gets fixes.

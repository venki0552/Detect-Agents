# Before publishing (maintainer checklist)

## Must do

- [ ] **Employer IP check.** Read your employment / invention-assignment and outside-activity agreements before making this public. Fraud and agent detection for banks may overlap your employer's business, so get written clearance if there's any doubt. (Not legal advice.)
- [ ] **Confirm the license.** The repo ships with Apache-2.0 (explicit patent grant, enterprise-friendly). Switch to MIT now if you prefer: it's harder to change after outside contributions.
- [ ] **Pick the name.** Check that `agent-detect` is free on npm and GitHub, or use a scoped name (`@<you>/agent-detect`). Update `package.json` (`name`, `repository`, `bugs`, `homepage`) and replace every `<your-github-user>` placeholder.
- [ ] **Set the security contact** in `SECURITY.md` (an email or GitHub private vulnerability reporting).
- [ ] **Set `author`** in `package.json`.
- [ ] **Fresh-clone test:** `npm ci && npm run typecheck && npm test && npm run build`.

## Should do

- [ ] Turn on GitHub private vulnerability reporting, Dependabot, branch protection (CI required) and the Discussions tab.
- [ ] Add topics on GitHub: `bot-detection`, `ai-agents`, `fraud-prevention`, `webauthn`, `trusted-types`, `webmcp`.
- [ ] Tag `v0.2.0` and write release notes from `CHANGELOG.md`.
- [ ] Make the README's status banner prominent: **alpha, not calibrated on real users**.

## Nice to have

- [ ] Record a short demo GIF of the demo bank's session panel during an attack run.
- [ ] Write a blog post explaining the "detection slows, step-up stops" model and the Trusted Types finding.
- [ ] Open the P0/P1 roadmap items as GitHub issues labelled `help wanted`.

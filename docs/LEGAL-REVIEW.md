# Privacy and legal review

**Date:** 2026-11-12 · **Scope:** v0.3 of this repository · **Status:** an engineering review, **not legal advice**.

This was written by an AI coding assistant from the source code and from public sources checked on the date above. It maps what the software does to the rules that usually apply, lists what a deploying bank has to do, and lists the questions only a lawyer or a regulator can answer. Law in this area is moving (several items below were still in negotiation or litigation on the review date), and it differs by country and by state. **Have qualified counsel review it for each jurisdiction before production.** Where a statement rests on a secondary source or on general knowledge instead of the primary text, it says so.

## 1. Summary

| Question | Short answer | Confidence |
|---|---|---|
| Does the collector take content (what people type, read or pay)? | **No.** Verified in code (§2). Two exceptions the integrator must handle: on-screen keypads need `data-ad-mask`, and click coordinates show *where* someone clicked | High |
| Is the data personal data? | **Yes**, once it sits next to a session or a user: behaviour, device details and an online identifier | High |
| Is it "biometric data" in the strict sense (GDPR Art. 9, BIPA)? | **Probably not as used here**: it classifies human vs automation and keeps no per-person template. The argument depends on never using the data to recognise an individual | Medium. No regulator guidance is specific to behavioural biometrics |
| Is consent needed in the EU for the collector to run? | **Open.** It reads device details and stores a session id, which is inside ePrivacy Art. 5(3). Whether fraud prevention is "strictly necessary" is decided country by country | Low |
| Can a `block` be made by the software alone? | It can, technically. Whether it may is an automated-decision question (GDPR Art. 22, California ADMT rules). A step-up is much easier to defend than a block | Medium |
| Is this an "AI system" under the EU AI Act? | **Probably not**: rules written by people, no model, no inference | Medium–high |
| Biggest legal risks | (1) running it as a hosted service instead of on the bank's own servers; (2) reusing the data for anything but security; (3) uneven friction for people using assistive technology; (4) no disclosure | — |

## 2. What was verified in the code

Checked against `src/client/` and `src/core/types.ts` on the review date.

| Claim in `PRIVACY.md` | Verified? | Where |
|---|---|---|
| No key values or key codes leave the browser | Yes. `event.key` and `event.code` are read only to pair a key's press with its release and to tell a typing key from a modifier; neither is put in an event | `onKey` |
| No input values, no page text | Yes. Nothing reads `.value`, `textContent` or `innerText` of the page | whole collector |
| No URLs, cookies, referrer, user-agent string | Yes. `location.origin` is compared locally; the user-agent is tested locally for "HeadlessChrome" and only the yes/no is sent | `onViolation`, `env.ts` |
| Data goes only to the integrator's own endpoint | Yes: three same-origin requests (`/session`, `/collect`, `/decide`) | transport |
| Nothing is written to disk or logged by the server module | Yes. Sessions are in memory and expire after 30 minutes idle. The audit hook receives rule ids and scores, not events | `src/server/` |
| Masked regions send nothing measurable | Yes, since D24/D35: no click geometry, no pointer path, no key or input events | `masked`, `scriptInMask` |

What does leave the browser: timestamps and coordinates of pointer moves and clicks, target size, key press/release times with a typing-key flag, input *types*, scroll and focus changes, tag names of nodes injected by extensions, and one environment snapshot (automation flags, GPU renderer string, screen size, platform, language count, touch points).

**Findings from this check** (none is a breach of the stated contract; each is something a privacy reviewer will ask about):

1. **Tag names of injected nodes can name an extension.** A custom element such as a password manager's button reveals which product the person has installed. Only the fact that *some* foreign node appeared is used by the rules.
2. **The GPU renderer string is a device-fingerprint component.** The rules use only "software renderer or not" and one Linux/small-screen profile.
3. **The session id in `sessionStorage` is unnecessary when `bind` is configured**, because the server then identifies the session from the app session. Dropping it would remove the only thing the collector *stores* on the device.
4. **Click coordinates show where someone clicked**, which with a known layout shows what they chose (which row, which option). This is disclosed; masking is the control.
5. **Key timing is recorded in password fields** unless they are masked (D24).
6. **`npm run demo:capture` writes real sessions to disk.** It is a calibration tool, git-ignored, and anyone using it on other people needs their consent.

Items 1–3 are data-minimisation improvements that would cost little detection. They are recommendations in §7, not yet built.

## 3. A design commitment that the legal position depends on

**This software must never recognise a person.** It asks "human or automation?" for the current session. It keeps no per-user behavioural template, compares nothing against a stored profile, and links nothing across sessions.

That is what keeps it on the right side of the line drawn by GDPR Art. 9 ("for the purpose of uniquely identifying a natural person"), by the UK regulator's guidance, and by the US state definitions that turn on identification. Adding "does this typing match how this customer usually types?" would be a different product with a different legal analysis (explicit consent in most of Europe, biometric statutes in several US states). It is now a rule in `CLAUDE.md`.

## 4. European Union and United Kingdom

**Roles.** The bank that deploys the SDK on its own servers is the controller. The project is software, receives no data, and is not a processor. Anyone who hosts it for a bank becomes a processor and inherits the contract, security and transfer obligations.

**Personal data: yes.** Behavioural and device data tied to a session is personal data.

**Special category (Art. 9)?** Biometric data is special category only when processed to uniquely identify someone. The UK ICO says so directly, and lists keystroke analysis as a behavioural biometric technique when used for recognition. This SDK does not recognise anyone (§3), so the better view is that Art. 9 does not apply. Two cautions: the EDPB has published nothing specific to behavioural biometrics, and commentary treats their fit under Art. 9 as unsettled, so a national authority could take a stricter line; and the raw data *could* be used for identification by someone who chose to, which is why purpose limitation and short retention matter.

**Lawful basis.** Two candidates, to be chosen and documented by the controller: legitimate interests (GDPR Recital 47 names fraud prevention), with a written balancing test; or legal obligation, because payment providers must run transaction monitoring (PSD2 security RTS, Art. 2, which among other things refers to signs of malware in the session; stated from general knowledge of the text). The incoming Payment Services Regulation makes behaviour-based monitoring more explicit; on the review date it was reported as agreed but not yet published, and the EDPB had asked for the monitored data categories to be defined more precisely. Re-check when the final text and the EBA's technical standards are out.

**Impact assessment.** Assume a DPIA is required: systematic monitoring of behaviour, a new kind of technology, and scale. `ARCHITECTURE.md`, `PRIVACY.md`, `THREAT-MODEL.md` and this file are the inputs.

**Automated decisions (Art. 22).** A `block` produced by rules alone, with no person involved, may be a decision with a "similarly significant" effect on the customer; a `step_up` probably is not, since the customer completes the action themselves. Practical consequences:
- Prefer `step_up` to `block` wherever the evidence allows. Since D38 that is a setting (`onTier1`), per rule.
- Give a blocked customer a human route to contest it. The audit record (rule ids, evidence, token id) is what that person needs.
- Keep customer wording neutral ("this request was stopped"), as `INTEGRATION.md` already says: an accusation of being a bot is both wrong some of the time and a problem under accuracy and fairness principles.
- Fraud monitoring authorised by law is one of the Art. 22 exceptions (Recital 71 mentions fraud prevention); whether it covers a given deployment is for counsel.

**Transparency.** The privacy notice has to say that device and interaction data is processed to detect fraud and automated access, the lawful basis, and the retention period. It does not have to describe the rules.

**ePrivacy Art. 5(3) (the "cookie rule").** The collector stores one id in `sessionStorage` and reads device details. The EDPB's guidelines on the technical scope of Art. 5(3) (version 2, October 2024) read "storing" and "gaining access" broadly, so both are in scope. The Directive exempts only what is needed to transmit a communication or is strictly necessary for a service the user asked for. It has no general security or fraud exemption; older regulator guidance accepted narrowly scoped security uses, and national authorities differ (stated from general knowledge). The Commission's "Digital Omnibus" proposal would add an explicit security exemption, but on the review date the Council had only just agreed its negotiating position and Parliament had not, so it cannot be relied on. **This is the least settled point in the review.** Options: get consent; or document a strict-necessity position per country with counsel; and reduce what is stored and read (§7).

**Accessibility.** The European Accessibility Act has applied to consumer banking services since 28 June 2025 (general knowledge). Extra authentication steps that fall mainly on people using assistive technology are a discrimination risk as well as a product problem. Known today: keyboard-only users are `unknown` more often (D14), and assistive extensions that click by script trigger `evt.untrusted` (D28). `onTier1` lets a bank make that a step-up instead of a block; it still has to be measured with real users (roadmap P0).

**EU AI Act.** The definition of an AI system excludes systems based on rules defined solely by people to execute operations automatically (Recital 12; the Commission's guidelines on the definition repeat it). This SDK is exactly that. If the optional model layer on the roadmap (P3) is ever built, redo this analysis; the Act's credit-scoring high-risk category carves out fraud detection, but that carve-out was not verified in this review.

## 5. United States

**Financial institutions and GLBA.** Much of US state privacy law exempts data or institutions already covered by the Gramm-Leach-Bliley Act. That narrows several items below for a bank, but the scope of each exemption differs by statute, and it does not extend automatically to a vendor.

**Illinois BIPA.** The statute lists specific identifiers (retina or iris scan, fingerprint, voiceprint, scan of hand or face geometry; from general knowledge of the text). Typing and pointer dynamics are not on the list, and not excluded either; plaintiffs have been testing behavioural biometrics and device fingerprinting. Financial institutions subject to GLBA are exempt under section 25(c), and whether their vendors share that exemption has been litigated with mixed results. For a bank running this on its own servers the exposure looks low; for a vendor hosting it, less so.

**California.** The CCPA's definition of biometric information names keystroke patterns and rhythms where they carry identifying information (general knowledge of the statute), so the label is closer here than under BIPA, though the "sensitive" treatment turns on use for unique identification and GLBA-covered data is largely exempt. Separately, the automated-decision (ADMT) regulations approved in September 2025 cover "significant decisions", which include financial services, with compliance for existing uses due by 1 January 2027. They keep an exception from the opt-out right for technology used solely for security, fraud prevention or safety, and allow withholding details that would compromise those purposes. Risk-assessment duties may still apply.

**Wiretap and "session replay" suits (California CIPA and similar laws).** The claims target third-party tools that capture what visitors type and do. Three things separate this SDK from those tools: it takes no contents (no key values, no text); it runs on the bank's own servers, and a party to a communication cannot eavesdrop on itself (the reasoning in a 2025 Ninth Circuit session-replay decision); and no vendor can read the data. The law is unsettled, with at least one appellate memorandum reviving a session-replay claim, so two things keep the position strong: **do not offer this as a hosted service that sees customer sessions**, and disclose the monitoring.

**Other state biometric laws** (Texas, Washington, Colorado's 2025 amendments) mostly define biometric identifiers by use for identification. Not reviewed in detail.

**Unfair or deceptive practices.** Monitoring that is not disclosed is the usual trigger. Disclose it.

## 6. What a deploying bank has to do

| # | Do | Why |
|---|---|---|
| 1 | Run it on your own infrastructure; give no third party access to sessions | Keeps you the only party to the data (controller without a processor; party exception) |
| 2 | Use the data for security and fraud prevention only. No marketing, analytics, or customer profiling | Purpose limitation; keeps the Art. 9 and biometric-statute analysis where it is |
| 3 | Do not build per-customer behavioural profiles from it | §3 |
| 4 | Disclose it in the privacy notice | Transparency; UDAP; wiretap defences |
| 5 | Decide and document the lawful basis; complete a DPIA | GDPR Arts. 6, 35 |
| 6 | Take a position on ePrivacy consent per country | §4 |
| 7 | Prefer step-up to block; provide a human route to contest a block | Art. 22; ADMT rules; fairness |
| 8 | Put `data-ad-mask` on on-screen keypads; consider it for password fields | The privacy contract depends on it |
| 9 | Keep raw traces only for the session (the default); set a retention period for audit records | Storage limitation |
| 10 | Measure friction for assistive-technology users before enforcing | Accessibility law; rule 8 of this project |
| 11 | Treat any captured real sessions (calibration data) as sensitive: consent, access control, deletion | They are the rawest form of this data |

## 7. Recommended changes to the product

Not built. Each reduces what a privacy reviewer has to accept.

| Change | Effect on detection |
|---|---|
| Send "software renderer: yes/no" and a coarse device class instead of the GPU string | None on rules; rule evidence text becomes less specific |
| Send a bucket ("custom element" / "div" / "iframe" / other) instead of the tag name of foreign nodes | None on rules |
| A no-storage mode when `bind` is configured (no `sessionStorage` id) | None |
| An option to mask password fields by default | Loses typing evidence on login pages |
| A documented, versioned schema for the audit record, with a retention note | None |

## 8. Questions for counsel

1. Art. 9 GDPR: does the "human or automation" purpose keep typing and pointer dynamics outside special-category data in each country of operation? Any national authority position to the contrary?
2. ePrivacy Art. 5(3): is consent required for the device reads and the session id, or is fraud prevention on a banking service "strictly necessary" in each country?
3. Lawful basis: legitimate interests or legal obligation, given the current payment-services rules and the incoming Regulation?
4. Art. 22 and the California ADMT rules: is `block` a covered decision in this deployment, and is the contest route sufficient?
5. BIPA and other state biometric statutes: confirm the GLBA exemption covers this use and any vendor involved.
6. Wiretap statutes: confirm the first-party, no-contents position for each state with a two-party-consent law, and the disclosure wording.
7. Accessibility: is the measured difference in step-up rates for assistive-technology users acceptable, and what accommodation is offered?
8. Employment or outside-activity agreements of contributors (see `OPEN-SOURCE-CHECKLIST.md`).

## 9. Sources

Checked on 2026-11-12. Secondary sources are marked; primary texts were not all read in full.

- EDPB, Guidelines 2/2023 on the technical scope of Art. 5(3) ePrivacy Directive, version 2: <https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf>
- UK ICO, guidance on biometric recognition: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/guidance-on-biometric-data/biometric-recognition>
- EDPB statement on the financial data and payments package (2023): <https://www.edpb.europa.eu/system/files/2024-05/edpb_statement_20230523_financialdatapaymentpackage_en.pdf>
- William Fry, behavioural biometrics under GDPR (secondary): <https://www.williamfry.com/knowledge/dont-press-too-hard-use-of-behavioural-biometrics-brings-privacy-issues-under-gdpr/>
- Morrison Foerster, PSD3 and the Payment Services Regulation, April 2026 (secondary): <https://www.mofo.com/resources/insights/260430-psd3-and-the-payment-services-regulation-key-developments>
- IAPP, new EU payment rules and fraud monitoring (secondary): <https://iapp.org/news/a/new-eu-payment-rules-could-expand-fraud-monitoring>
- CMS, Commission guidelines on the definition of AI systems (secondary): <https://cms.law/en/int/legal-updates/eu-commission-issues-guidelines-on-the-definition-of-ai-systems>
- Freshfields, Digital Omnibus and cookie compliance (secondary): <https://technologyquotient.freshfields.com/post/102m196/how-the-eu-commissions-digital-omnibus-could-reshape-cookie-compliance-in-europe>
- White & Case, CPPA final rules on ADMT (secondary): <https://www.whitecase.com/insight-alert/cppa-finalizes-rules-admt-risk-assessments-and-cybersecurity-audits-requirements>
- Hunton, CPPA final regulations (secondary): <https://www.hunton.com/privacy-and-cybersecurity-law-blog/cppa-finalizes-ccpa-regulations-on-automated-decision-making-technology-risk-assessments-and-cybersecurity-audits>
- Privacy World, 2025 biometric privacy litigation review (secondary): <https://www.privacyworld.blog/2025/12/2025-year-in-review-biometric-privacy-litigation/>
- Sheppard Mullin, Seventh Circuit on vendors and the BIPA financial-institution exemption (secondary): <https://www.sheppard.com/insights/blogs/seventh-circuit-upholds-that-vendors-can-share-their-clients-bipa-exemption>
- Barnes & Thornburg, CIPA/ECPA website-tracking litigation in 2026 (secondary): <https://btlaw.com/en/insights/alerts/2026/cipa-ecpa-website-tracking-privacy-litigation-in-2026>
- Proskauer, Ninth Circuit review of website-tracking class actions (secondary): <https://privacylaw.proskauer.com/2025/07/articles/california/ninth-circuit-reviews-website-tracking-class-actions-and-the-reach-of-californias-privacy-law/>

# Marketing Knowledge Approval Record

Issue: [#68](https://github.com/ARabee3/marketmind-ai/issues/68)

This file records human review for the seed corpus. Runtime approval records the
explicit human reviewer in each entry; the table separately tracks outstanding
team reviews and must not imply approval by people who have not reviewed it.

## Required reviewers

- Product / AI review: Ahmed (`ARabee3`)
- UX / AI review: Merzek (`mostafamerzk`)
- Retrieval metadata review: Gerges (`GergesYoussef-hub`)

## Merzek approval

On 2026-08-02, Merzek (`mostafamerzk`) explicitly approved the reviewed
corpus revisions for development retrieval. This records Merzek's human
approval only; it does not represent approval by Ahmed, Gerges, or the other
reviewers listed for issue #103.

## Review checklist

For each entry, reviewers should confirm:

- The entry is general marketing knowledge, not private business data.
- It states when the guidance is useful and when it is a poor fit.
- It lists required inputs, risks, measurement guidance, or a clear reason if a
  section is not applicable.
- External factual claims have source references.
- Numeric benchmark claims are isolated in `verified_benchmark` entries.
- Time-sensitive knowledge has real effective and expiry dates.
- Locale, market, industry, objective, funnel, channel, season, and budget tags
  are accurate enough for retrieval filters.
- The entry does not authorize publishing, paid spend, or owner approval.

## Entry approval status

| Slug | Status | Ahmed | Merzek | Gerges | Notes |
| --- | --- | --- | --- | --- | --- |
| `audience-positioning-stp` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Outside issue #103 diagnosis scope; full #68 team review remains pending |
| `benchmark-egypt-facebook-reach` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Verified benchmark entry |
| `benchmark-egypt-instagram-reach` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Verified benchmark entry |
| `benchmark-egypt-internet-social-penetration` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Verified benchmark entry |
| `benchmark-egypt-tiktok-reach` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Verified benchmark entry |
| `budget-planning-organic-and-scenarios` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Budget playbook |
| `channel-delivery-platforms` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Channel playbook |
| `channel-facebook` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Channel playbook |
| `channel-google-business-profile` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Channel playbook |
| `channel-instagram` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Channel playbook |
| `channel-tiktok` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Channel playbook |
| `channel-website-landing-page` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Channel playbook |
| `content-agent-handoff-boundary` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Content boundary |
| `content-experiments-and-format-mix` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Content playbook |
| `content-pillars-and-cadence-by-capacity` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Content playbook |
| `customer-needs-value-proposition-relevant-7ps` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Outside issue #103 diagnosis scope; full #68 team review remains pending |
| `engagement-rate-benchmark-caveat` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Measurement caveat |
| `governance-approval-citation-and-limits-policy` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Policy entry |
| `kpi-modes-and-vanity-vs-business-metrics` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Measurement playbook |
| `objective-acquisition` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Objective playbook |
| `objective-awareness` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Objective playbook |
| `objective-conversion-sales` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Objective playbook |
| `objective-launch` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Objective playbook |
| `objective-retention-repeat` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Objective playbook |
| `regional-language-tone-and-seasonal-calendar` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Regional guidance |
| `sector-note-education` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Sector note |
| `sector-note-healthcare` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Sector note |
| `sector-note-hospitality` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Sector note |
| `sector-note-retail` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Sector note |
| `sector-note-services` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Sector note |
| `situation-diagnosis-5cs-swot` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Issue #103 source-backed revision drafted; approval and live retrieval proof required |
| `smart-objectives-funnel-mapping` | Merzek approved; other reviews pending | Pending | Approved 2026-08-02 | Pending | Issue #103 source-backed revision approved by Merzek; remaining reviews and live proof are pending |

## Issue #103 completion record

These checks apply specifically to
`situation-diagnosis-5cs-swot` and `smart-objectives-funnel-mapping`. Do not
check a reviewer on their behalf, and do not use a fixture-only or in-memory
evaluation as live proof.

### Required human reviews

- [ ] @ARabee3
- [x] @mostafamerzk — approved 2026-08-02
- [ ] @abdulazimRabie
- [ ] @MostafaAhmed22
- [ ] @GergesYoussef-hub

### Required live proof

- [x] Corpus validation after approval — evidence: `npm run check:marketing-knowledge`
  and ingestion dry run, 32 entries / 64 chunks / 0 failures, 2026-08-02
- [x] Committed PostgreSQL and Qdrant ingestion — evidence: run
  `1b9b548c-2fff-4c40-9917-20882fc8e340`, 32 approved versions and 64
  Gemini 768-dimension chunks, 2026-08-02
- [x] Arabic live framework_diagnosis retrieval — evidence: run
  `d751c748-cdbe-485a-bb8b-84c11df3a4b5`, no blocking gaps, 2026-08-02
- [x] English live framework_diagnosis retrieval — evidence: run
  `4483a209-7b7f-49c1-81f9-906f9e34236c`, no blocking gaps, 2026-08-02
- [x] Live Strategy generation without MISSING_FRAMEWORK_DATA — evidence:
  Strategy `623d054a-3f24-46b4-b2c7-aefa8985ae46`, version 1, retrieval run
  `2da740d8-74ca-4210-a4e5-2b2b1650ed88`, 0 knowledge gaps, 2026-08-02

Run `npm run strategy:readiness` after updating this record. It remains blocked
until both entry front matters are approved, all five reviewers are checked,
and every live proof line is checked with a real run reference.

## Approval update rule

When an authorized human reviewer explicitly approves an entry for development
retrieval, update the entry front matter:

```yaml
review_status: approved
reviewer: "mostafamerzk"
reviewed_at: "YYYY-MM-DD"
```

Use the GitHub handle of the reviewer who performs the final approval update.
The full multi-reviewer record stays in this file.

Then run:

```bash
npm run check:marketing-knowledge
```

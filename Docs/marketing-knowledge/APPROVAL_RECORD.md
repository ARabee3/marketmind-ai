# Marketing Knowledge Approval Record

Issue: [#68](https://github.com/ARabee3/marketmind-ai/issues/68)

This file records human review for the seed corpus. Entries remain `draft` until
the required reviewers approve them.

## Required reviewers

- Product / AI review: Ahmed (`ARabee3`)
- UX / AI review: Merzek (`mostafamerzk`)
- Retrieval metadata review: Gerges (`GergesYoussef-hub`)

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
| `audience-positioning-stp` | Pending | Pending | Pending | Pending | Outside issue #103 diagnosis scope; remains draft pending the full #68 corpus review |
| `benchmark-egypt-facebook-reach` | Pending | Pending | Pending | Pending | Verified benchmark entry |
| `benchmark-egypt-instagram-reach` | Pending | Pending | Pending | Pending | Verified benchmark entry |
| `benchmark-egypt-internet-social-penetration` | Pending | Pending | Pending | Pending | Verified benchmark entry |
| `benchmark-egypt-tiktok-reach` | Pending | Pending | Pending | Pending | Verified benchmark entry |
| `budget-planning-organic-and-scenarios` | Pending | Pending | Pending | Pending | Budget playbook |
| `channel-delivery-platforms` | Pending | Pending | Pending | Pending | Channel playbook |
| `channel-facebook` | Pending | Pending | Pending | Pending | Channel playbook |
| `channel-google-business-profile` | Pending | Pending | Pending | Pending | Channel playbook |
| `channel-instagram` | Pending | Pending | Pending | Pending | Channel playbook |
| `channel-tiktok` | Pending | Pending | Pending | Pending | Channel playbook |
| `channel-website-landing-page` | Pending | Pending | Pending | Pending | Channel playbook |
| `content-agent-handoff-boundary` | Pending | Pending | Pending | Pending | Content boundary |
| `content-experiments-and-format-mix` | Pending | Pending | Pending | Pending | Content playbook |
| `content-pillars-and-cadence-by-capacity` | Pending | Pending | Pending | Pending | Content playbook |
| `customer-needs-value-proposition-relevant-7ps` | Pending | Pending | Pending | Pending | Outside issue #103 diagnosis scope; remains draft pending the full #68 corpus review |
| `engagement-rate-benchmark-caveat` | Pending | Pending | Pending | Pending | Measurement caveat |
| `governance-approval-citation-and-limits-policy` | Pending | Pending | Pending | Pending | Policy entry |
| `kpi-modes-and-vanity-vs-business-metrics` | Pending | Pending | Pending | Pending | Measurement playbook |
| `objective-acquisition` | Pending | Pending | Pending | Pending | Objective playbook |
| `objective-awareness` | Pending | Pending | Pending | Pending | Objective playbook |
| `objective-conversion-sales` | Pending | Pending | Pending | Pending | Objective playbook |
| `objective-launch` | Pending | Pending | Pending | Pending | Objective playbook |
| `objective-retention-repeat` | Pending | Pending | Pending | Pending | Objective playbook |
| `regional-language-tone-and-seasonal-calendar` | Pending | Pending | Pending | Pending | Regional guidance |
| `sector-note-education` | Pending | Pending | Pending | Pending | Sector note |
| `sector-note-healthcare` | Pending | Pending | Pending | Pending | Sector note |
| `sector-note-hospitality` | Pending | Pending | Pending | Pending | Sector note |
| `sector-note-retail` | Pending | Pending | Pending | Pending | Sector note |
| `sector-note-services` | Pending | Pending | Pending | Pending | Sector note |
| `situation-diagnosis-5cs-swot` | Pending | Pending | Pending | Pending | Issue #103 source-backed revision drafted; approval and live retrieval proof required |
| `smart-objectives-funnel-mapping` | Pending | Pending | Pending | Pending | Issue #103 source-backed revision drafted; intentionally remains draft until required reviewers approve |

## Issue #103 completion record

These checks apply specifically to
`situation-diagnosis-5cs-swot` and `smart-objectives-funnel-mapping`. Do not
check a reviewer on their behalf, and do not use a fixture-only or in-memory
evaluation as live proof.

### Required human reviews

- [ ] @ARabee3
- [ ] @mostafamerzk
- [ ] @abdulazimRabie
- [ ] @MostafaAhmed22
- [ ] @GergesYoussef-hub

### Required live proof

- [ ] Corpus validation after approval — evidence:
- [ ] Committed PostgreSQL and Qdrant ingestion — evidence:
- [ ] Arabic live framework_diagnosis retrieval — evidence:
- [ ] English live framework_diagnosis retrieval — evidence:
- [ ] Live Strategy generation without MISSING_FRAMEWORK_DATA — evidence:

Run `npm run strategy:readiness` after updating this record. It remains blocked
until both entry front matters are approved, all five reviewers are checked,
and every live proof line is checked with a real run reference.

## Approval update rule

After all required reviewers approve an entry, update the entry front matter:

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

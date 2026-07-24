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
| `audience-positioning-stp` | Pending | Pending | Pending | Pending | Framework entry |
| `benchmark-egypt-facebook-reach` | Pending | Pending | Pending | Pending | Verified benchmark entry |
| `benchmark-egypt-instagram-reach` | Pending | Pending | Pending | Pending | Verified benchmark entry |
| `benchmark-egypt-internet-social-penetration` | Pending | Pending | Pending | Pending | Verified benchmark entry |
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
| `situation-diagnosis-5cs-swot` | Pending | Pending | Pending | Pending | Framework entry |
| `smart-objectives-funnel-mapping` | Pending | Pending | Pending | Pending | Framework entry |

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

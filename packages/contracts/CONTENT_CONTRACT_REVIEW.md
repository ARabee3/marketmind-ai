# Content v1 Contract Freeze Review Checklist

Issue #107 cannot close until the entries below are confirmed by real human
reviews in GitHub. This file records the checklist and the automated evidence
each reviewer role must check; it does not claim approval before reviewers
respond. Update each row's status/date only after the corresponding GitHub
review or comment exists.

## Artifacts To Review

- `packages/contracts/CONTENT_CONTRACT.md` — freeze rules and boundaries.
- `packages/contracts/src/content/*` — TypeScript canonical schema and policy.
- `packages/contracts/python/content_contracts.py` + `content_publication_contracts.py`
  — Pydantic mirror (Python is not canonical).
- `packages/contracts/examples/*` — valid/invalid fixtures (at least 30).
- `packages/contracts/scripts/validate-content-*.mjs|ts` — deterministic checks.
- `PublicationCandidateV1` + `PublicationCandidateCreatedEventV1` — handoff
  boundary, checksum, replay rules.

## Reviewers (issue #107 / #106)

| Reviewer | Role | Artifact reviewed | Fixture reviewed | Command evidence | Status | Date |
| --- | --- | --- | --- | --- | --- | --- |
| Merzek | Content owner | CONTENT_CONTRACT.md, policy | `content-pack-week-1-ar.example.json` | `npm --workspace @marketmind/contracts run check` | pending |  |
| Ahmed | Product / AI reviewer | lifecycle, cutoff, AI DTOs | `content-week-context-*.example.json` | `npm --workspace @marketmind/contracts run typecheck` | pending |  |
| Mokhtar | Generation owner | AI DTOs, asset rules | `content-item-version-generated-asset.example.json` | `npm --workspace @marketmind/contracts run check` | pending |  |
| Kordy / MostafaAhmed22 | API / integration owner | DTO surfaces, errors | `content-cycle.example.json`, `content-decision-approved.example.json` | `npm --workspace @marketmind/contracts run typecheck` | pending |  |
| Web / content owner | Web consumer | progress + week surfaces | `content-week-context-safe-default.example.json` | `npm --workspace apps/web run typecheck` | pending |  |
| Abdulazim | Publishing handoff reviewer | `PublicationCandidateV1` | `publication-candidate-approved.example.json` | `node scripts/validate-publication-candidate.mjs` | pending |  |
| Gerges | Publishing handoff reviewer | replay + tamper rules | `publication-candidate-replay-conflict.invalid.json` | `node scripts/validate-publication-candidate.mjs examples/publication-candidate-tampered.invalid.json` | pending |  |

## Automated Evidence Gates (must all pass before close)

```bash
npm --workspace @marketmind/contracts run check
npm --workspace @marketmind/contracts run typecheck
npm --workspace apps/api run typecheck
npm --workspace apps/web run typecheck
uv run --project services/ai python packages/contracts/python/test_content_contracts.py
```

`npm run check` must assert all 17 stable `CONTENT_*` error codes, reject every
`.invalid.json` fixture with its expected code, and fail on any checksum tamper
or conflicting replay.

## Approval Rule

Leave every status `pending` until the named reviewer leaves an actual GitHub
review or comment. Never self-approve. Issue #107 closes only when every row is
approved by the human owner and linked review evidence exists.

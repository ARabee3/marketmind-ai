# Strategy Completion Runbook

This runbook is the completion gate for the Sprint 4 Strategy epic (#66). It
separates automated technical evidence from human knowledge approval and live
integration evidence. The epic is complete only when both groups pass.

## What is automated

From the repository root:

```bash
npm run strategy:verify:automated
```

This command starts PostgreSQL, Redis, and Qdrant, applies Prisma migrations,
runs the complete monorepo check, and runs the Strategy browser journey on the
configured desktop and mobile projects.

The deterministic check excludes tests marked `network`. Run credentialed
provider smoke tests separately, when intentionally testing external services:

```bash
npm run check:ai:network
```

Record transient provider outages separately from product validation failures;
an external 5xx must never turn deterministic CI red.

For development, one command starts every required Strategy service:

```bash
npm run strategy:dev
```

It starts PostgreSQL on port 5433, Redis on 6379, Qdrant on 6333/6334, NestJS
on 3001, FastAPI on 8000, and Next.js on 3000. Stop the foreground app
processes with `Ctrl+C`; Docker data is retained for the next run.

## Fictional demo data

Koshary Corner is fictional. Never present its URLs, facts, plan, benchmarks,
or results as live business evidence.

The stable examples are:

- `packages/contracts/examples/cafe-full-journey.example.json`
- `packages/contracts/examples/strategy-brief.example.json`
- `packages/contracts/examples/strategy-plan.example.json`
- `packages/contracts/examples/strategy-readiness.example.json`
- `packages/contracts/examples/strategy-decision-approved.example.json`
- `services/ai/tests/decisions/fixtures/koshary_corner_organic.py`
- `services/ai/tests/decisions/fixtures/koshary_corner_paid_base.py`

Use them to explain the flow: confirmed profile → separate Strategy brief →
explicit generation → persisted retrieval → validated draft → owner revision,
rejection, or approval → immutable history.

## Final human approval and retained live record

Issue #103 cannot be completed by code review alone. The two source-backed
framework entries have been reviewed, and the accountable final approval is
recorded by Ahmed (`ARabee3`) in `Docs/marketing-knowledge/APPROVAL_RECORD.md`.
This does not imply individual approval records for other team members.
Issue #128 is the authoritative final-review record for this closeout and
supersedes Issue #103's earlier individual-review mechanics.

After review, update each entry to `review_status: approved` with a real final
reviewer and review date, update
`Docs/marketing-knowledge/APPROVAL_RECORD.md`, and run:

```bash
npm run check:marketing-knowledge
npm run strategy:readiness
```

The readiness command verifies the recorded final approval and retained live
proof. It never edits approval metadata.

## Approved-corpus ingestion

With PostgreSQL and Qdrant running, configure
`KNOWLEDGE_INTERNAL_CLI_TOKEN` in `services/ai/.env`, then validate without
writes:

```bash
uv run --directory services/ai python -m app.knowledge.ingestion.cli dry-run
```

Only after approval metadata is committed, ingest the reviewed corpus:

```bash
uv run --directory services/ai python -m app.knowledge.ingestion.cli ingest \
  --commit-sha "$(git rev-parse HEAD)" \
  --actor "<reviewer-handle>"
```

Record the ingestion-run ID and collection in the issue #103 completion record.
Draft, expired, or missing-review entries must not appear in live retrieval.

## Live proof

Use the running Web/API/AI path, not an in-memory evaluation fixture:

1. Confirm the fictional Koshary Corner profile.
2. Save a complete Strategy brief in Arabic and explicitly generate it.
3. Capture the correlation ID, retrieval-run ID, Strategy version ID, and
   framework citation entry/version.
4. Confirm the persisted retrieval pack resolves every citation through
   PostgreSQL and that the Qdrant payload contains no Business Profile data.
5. Repeat retrieval with an English brief.
6. Confirm neither successful run contains the blocking
   `MISSING_FRAMEWORK_DATA` gap.
7. Request a revision and verify the prior draft remains readable while the new
   immutable version is generated.
8. Verify retryable and non-retryable failure states, stale-version conflict,
   rejection, explicit approval, and history.
9. Check desktop, mobile, Arabic RTL, keyboard focus, and screen-reader names.
10. Add real run IDs, screenshots, or CI links to the issue #103 completion
    record and issue #80.

Do not weaken the blocker if live retrieval misses the framework. Fix approval,
tagging, indexing, hydration, or query coverage.

## Failure matrix

| Failure | Required result |
| --- | --- |
| Qdrant unavailable | Visible failed state; no unsupported draft |
| No approved framework | `MISSING_FRAMEWORK_DATA` blocker |
| Expired or draft evidence | Excluded from approval-ready retrieval |
| Provider timeout | Safe failure with server-controlled retry eligibility |
| Invalid provider output | Validation failure; prior version preserved |
| Duplicate generation | One atomic claim/job |
| Failed revision | Previous immutable draft remains readable |
| Stale profile/version | Approval or decision conflicts safely |
| Repeated decision click | No duplicate decision/version |

## Issue closure matrix

| Issue | Completion condition |
| --- | --- |
| #77 | Brief/readiness/progress/failure UI, tests, RTL/mobile, and reviewer approval |
| #78 | Full plan/evidence/blocker review UI, tests, accessibility, and reviewer approval |
| #79 | Owner decisions/revision/retry/history, conflict safety, tests, and reviewer approval |
| #103 | Final approval by `@ARabee3` plus committed live ingestion, Arabic/English retrieval, and Strategy smoke proof |
| #80 | Automated suite plus real integrated flow, failure matrix, manual demo, and #103 complete |
| #66 | Every child issue, including #80 and #103, is closed with evidence |

`npm run strategy:verify` runs the automated suite and then the human/live
readiness checker. A non-zero readiness result means the technical PR may be
reviewable, but the Strategy epic must remain open.

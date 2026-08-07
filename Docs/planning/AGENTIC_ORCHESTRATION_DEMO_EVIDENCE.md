# Agentic orchestration demo evidence

Updated: 2026-08-07

This is the evidence packet for issue #161's safe, isolated demo slice. It
records what was actually run and keeps unmeasured checks explicit. The
orchestration path remains disabled by default and is not mounted by the
existing FastAPI application or owner-facing NestJS routes.

## What passed

### Phase 0: PostgreSQL checkpoint restart gate

The gate used the local disposable database
`marketmind_phase0_test` on PostgreSQL 16, Python 3.12, and the committed
LangGraph/Postgres checkpointer versions.

Command:

```bash
cd services/ai
PHASE0_DATABASE_URL=postgresql://marketmind:marketmind_dev@127.0.0.1:5433/marketmind_phase0_test \
  PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration/test_phase0_durability.py -m integration -vv
```

Observed result:

```text
2 passed in 6.77s
test_phase0_resume_survives_fastapi_process_restart PASSED
test_phase0_serializes_concurrent_start_and_resume_requests PASSED
```

The probe paused a fake graph with `interrupt()`, stopped the FastAPI process,
started a fresh process, resumed the same thread, rejected duplicate resume
delivery, and kept the idempotency-keyed fake side effect at one. The database
is disposable test state; it is not product data.

### Mock Research -> Strategy -> Content journey

Command:

```bash
cd services/ai
PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration/test_mock_vertical_slice.py -s -vv
```

Observed result:

```json
{
  "research": {
    "stop_reason": "sufficient_evidence",
    "tool_calls": 3,
    "tools": [
      "plan_trusted_research_queries",
      "triage_research_evidence",
      "search_approved_marketing_knowledge"
    ],
    "cited_facts": 2
  },
  "strategy": {
    "paused": "awaiting_strategy_approval",
    "approved_resume": "running",
    "persistence_required": true
  },
  "content": {
    "paused": "awaiting_content_approval",
    "draft_items": 3,
    "completed_resume": "completed",
    "persistence_required": true,
    "publication_actions": 0
  }
}
```

The test uses the real typed Phase 2 registry, the existing mock Strategy and
Content providers, the existing deterministic validators, both graph
interrupts, both persistence receipts, and exact owner decision bindings. It
does not create a Strategy row, Content row, decision, publication candidate,
or external action.

## NestJS handoff boundary

The Phase 1 boundary is already present in
`apps/api/src/modules/orchestration/`:

- `OrchestrationRepository` stores a run envelope and ordered sanitized event
  stream in PostgreSQL in one transaction.
- `OrchestrationService.startRun()` rejects the path unless
  `AI_ORCHESTRATION_ENABLED=true`, verifies owner/business/immutable input
  scope, and replays the same idempotency key without creating another run.
- `validateResumeRequest()` checks the exact owner, business, checkpoint thread,
  waiting state, decision binding, version, and checksum before a future AI
  client sends `Command(resume=...)`.
- The Prisma migration and shared TypeScript/Pydantic contracts are checked in.

There is intentionally no live processor or public controller yet. That keeps
the current Discovery, Strategy, Content, approval, billing, queue, and
publishing paths authoritative while the handoff is reviewed.

## Regression evidence

The isolated agentic regression set was run with Python 3.12:

```bash
cd services/ai
PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration tests/content tests/strategy -q
```

Final focused result: `403 passed, 13 skipped, 11 warnings` for
`tests/orchestration tests/content tests/strategy`. The full AI check also
passed on the local Python 3.14 runtime (`914 passed, 1 skipped, 72
deselected`). NestJS build/typecheck passed; the full API unit suite passed
(`128` suites, `1031` tests), and the eight non-publishing API E2E suites
passed (`72` tests) against a disposable PostgreSQL database.

The aggregate `npm run check` was also attempted. Its publishing integration
E2E requires its own dedicated Redis test database and a long-lived fake n8n
harness; that environment was not treated as a passing result here. This does
not affect the orchestration changes, which never mount publishing code.

## Still deliberately unmeasured

- credentialed OpenAI/Gemini/OpenRouter tool-calling for this exact vertical
  slice (the capability harness is opt-in and network-bound);
- a live NestJS worker that routes production jobs into the graph;
- long-term conversational, cross-business, or episodic memory;
- shadow comparison against a live current-path run;
- production checkpoint encryption, retention, and deletion policy.

These are not being claimed as passed. Until they are reviewed, keep
`AI_ORCHESTRATION_ENABLED=false` and treat the work as an isolated, safe demo
boundary rather than a replacement for the current workflow.

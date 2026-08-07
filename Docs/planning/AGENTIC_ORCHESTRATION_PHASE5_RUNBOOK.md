# Agentic Orchestration Phase 5 Runbook

This runbook is for the isolated evidence layer in issue #161. It does not
replace the existing Discovery, Strategy, Content, approval, or publishing
paths.

## Default safety posture

Keep both gates off until the evidence is reviewed:

```text
AI_ORCHESTRATION_ENABLED=false
AI_ORCHESTRATION_TRACE_ENABLED=false
AI_ORCHESTRATION_TRACE_EXPORTER=none
```

The current path remains authoritative. A trace exporter is diagnostic only;
it cannot approve, persist, publish, schedule, spend, or send an external
action.

## CI smoke evidence

Run the isolated Phase 4/5 tests with the service virtual environment:

```bash
cd services/ai
PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration/test_phase4_graph.py \
  tests/orchestration/test_phase5_observability.py \
  tests/orchestration/test_phase5_evaluation.py -q
```

The reviewed case set is
`tests/orchestration/fixtures/phase5_smoke_cases.json`. A smoke report must
keep PostgreSQL restart, duplicate-delivery, credentialed-provider, and full
bilingual cases as `unmeasured` unless the corresponding gate actually ran.
Never turn an unavailable check into a passing score.

For shadow comparison, build one sanitized summary for the current path and
one for the orchestrated path with the same immutable `scope_key`. The
comparator reports validity, citation, latency, and cost deltas; if either path
is missing a measure, that delta remains `unmeasured`.

The existing regression command remains the release evidence for current
behavior:

```bash
PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration tests/content tests/strategy -q
```

The deterministic full-journey rehearsal is a separate, fast demo check. It
selects the three reviewed Research tools, pauses at the Strategy and Content
owner gates, applies both typed persistence receipts, and completes without a
publication action:

```bash
PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration/test_mock_vertical_slice.py -s -vv
```

The Phase 0 PostgreSQL restart gate is still required for fresh-process
durability. The provider capability matrix remains opt-in because it makes
network requests.

## Trace setup

The local `InMemoryTraceSink` stores only bounded, sanitized events scoped to
the requested `(trace_id, run_id)`. The
`NonBlockingTraceSink` records locally first and schedules the optional
Langfuse/OTel exporter separately. Inspect `degraded_export` and
`exporter_error_count` in the snapshot; a trace outage is evidence of degraded
observability, not a graph failure.

When an external exporter is approved, inject its transport into
`LangfuseObservationExporter`. The transport receives a safe observation
payload, not raw prompts or provider responses. Keep credentials in the
deployment secret store and never put them in trace details.

## Shadow and demo rollout

1. Run the mock Phase 5 smoke suite and the existing AI regression suite.
2. Run the Phase 0 PostgreSQL restart/duplicate gate against a disposable
   `_test`, `_ci`, or `_e2e` database.
3. Run the provider capability matrix only for configured providers and record
   unavailable credentials or rate limits as unmeasured/unsupported.
4. Enable `AI_ORCHESTRATION_ENABLED=true` only for a fictional reviewed cohort
   in shadow mode. Shadow mode may write comparison evidence, never domain
   Strategy/Content versions, decisions, candidates, or external actions.
5. Compare validity, grounding, citations, latency, cost, and failure classes
   with the current path. Require every hard guardrail to be measured and pass.
6. Add the demo cohort to the explicit allow-list only after human review.

## Rollback and reconciliation

To roll back, set `AI_ORCHESTRATION_ENABLED=false` and restart the worker/API
configuration. The next job uses the existing current-path implementation; no
schema migration or data repair is required.

Paused graph runs must be handled deliberately:

- if Nest has not persisted the returned Strategy/Content draft, replay the
  same idempotent checkpoint result and attempt the existing persistence
  transaction once;
- if the domain row exists but a summary event is missing, rebuild the sanitized
  event from the authoritative row and checkpoint metadata;
- if a run is paused during rollback, cancel or migrate it explicitly and show
  the owner the terminal state;
- never rerun completed model/tool work merely to rebuild a summary, and never
  infer an owner approval.

The rollback proof is complete when a new queued job follows the current path,
the old graph creates no new domain row or external action, and the run/event
summary remains inspectable.

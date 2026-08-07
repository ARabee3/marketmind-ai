# Agentic orchestration mock shadow results

Updated: 2026-08-07

This is a safe, in-memory comparison of one immutable fictional business scope
through the existing Strategy/Content generation seams and the isolated
Phase 3/4 graphs. It is evidence that the comparison harness is connected to
real validators and graph outputs; it is not production traffic and it does
not authorize a default rollout.

## Command

```bash
cd services/ai
PYTHONPATH=.:../../packages/contracts/python \
  uv run --isolated --python 3.12 pytest \
  tests/orchestration/test_shadow_mock_comparison.py -s -vv
```

Observed result: `1 passed in 1.57s`.

## Observed sample

The exact latency and estimated cost values are machine/run dependent. The
following values are the sample emitted by the run above.

| Stage | Current path | Orchestrated path | Validity | Grounding measure | Latency (ms) | Cost (USD) |
| --- | --- | --- | --- | --- | ---: | ---: |
| Strategy | `completed` | `awaiting_strategy_approval` | `true` / `true` | 5 / 5 formal plan citations | 3.324 / 8.614 | unmeasured / unmeasured |
| Content | `completed` | `awaiting_content_approval` | `true` / `true` | 15 / 15 grounded `claim_sources` | 3.813 / 6.200 | 0.7373 / 0.7369 estimated |

The typed comparison reports `quality=match` for both stages, citation or
grounding delta `0`, and zero publication actions on both paths. The
orchestrated statuses are intentional: the graph stops at the owner gate
before persistence and approval rather than silently bypassing it.

The Content cost values are the bounded local estimator used by
`ContentSegment`, not provider billing. The current Strategy provider does not
return usage, so the Strategy cost delta remains explicitly unmeasured rather
than being fabricated.

## Safety assertions

- `AI_ORCHESTRATION_ENABLED` is not enabled by this test.
- Both paths use `MemorySaver`; no PostgreSQL or product table is touched.
- No Strategy/Content row, decision, publication candidate, queue job, or
  external action is created.
- The same hashed immutable scope key is supplied to both paths for each
  stage.
- The existing current path remains authoritative and is unchanged.

## What this proves, and what it does not

It proves a repeatable mock shadow comparison with validity, grounding,
latency, bounded-cost, status, and no-action evidence. It does not prove that
credentialed OpenAI/Gemini/OpenRouter traffic matches, that a live NestJS
worker can route production jobs, or that latency/cost meets a production
threshold. A live current-path shadow run, provider capability run, and
production checkpoint/security policy review remain rollout gates.

Keep the feature disabled until those gates are measured and reviewed.

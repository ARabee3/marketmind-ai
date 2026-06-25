# Prepared Discovery Contract

This is the Sprint 1 contract for issue `#1`.

Prepared Discovery is a research-first intake flow:

1. Owner submits intake details and optional public links.
2. NestJS creates a Discovery session and returns `202 Accepted`.
3. NestJS runs bounded pre-chat intelligence gathering.
4. WebSocket progress events show metadata, search, AI-start, and ready states.
5. HTTP status remains the recovery source of truth.
6. Discovery chat opens after `ready_for_chat`, `partial_ready`, or `research_failed`.
7. FastAPI returns structured Discovery turns.
8. NestJS stores messages and, later, a `BusinessProfileDraft`.
9. Owner confirms the profile draft.
10. Strategy unlocks only after confirmation.

## Public NestJS Contract

| Route | Purpose | Example |
|---|---|---|
| `POST /api/v1/discovery/start` | Accept intake and begin research. | `examples/discovery-start.request.json` |
| `GET /api/v1/discovery/:session_id/status` | Recover current session state and progress. | `examples/discovery-status.response.json` |
| `POST /api/v1/discovery/:session_id/respond` | Continue the Discovery interview. | `examples/discovery-respond.request.json` |
| `POST /api/v1/discovery/:session_id/summarize` | Produce a profile draft for review. | `examples/discovery-summarize.response.json` |
| `POST /api/v1/discovery/:session_id/confirm-profile` | Confirm the draft and unlock Strategy. | `examples/discovery-confirm-profile.request.json` |

## WebSocket Contract

Progress route:

```text
WS /ws/v1/discovery/:session_id/progress
```

Progress events are live feedback only. If the client disconnects, it should call
`GET /api/v1/discovery/:session_id/status`.

Example transcript:

```text
examples/discovery-progress.transcript.json
```

## Internal FastAPI Contract

| Route | Purpose | Example |
|---|---|---|
| `POST /internal/v1/ai/discovery/start` | Create the first Discovery question from intake and intelligence context. | `examples/internal-ai-discovery-start.request.json` |
| `POST /internal/v1/ai/discovery/respond` | Continue a Discovery turn from message history. | Use the same result shape as `examples/internal-ai-discovery-start.response.json`. |
| `POST /internal/v1/ai/discovery/summarize` | Produce a structured profile draft. | `examples/internal-ai-discovery-summarize.response.json` |

## Lifecycle States

Allowed session statuses live in:

```text
src/discovery/discovery-lifecycle.ts
```

Important meanings:

- `researching`: metadata and bounded search are running.
- `partial_ready`: chat can start, but some research failed.
- `ready_for_chat`: chat can start with usable research context.
- `research_failed`: research failed, but chat can continue safely from intake.
- `in_progress`: owner and assistant are interviewing.
- `summary_ready`: a `BusinessProfileDraft` is ready for owner review.
- `confirmed`: owner accepted the profile draft.

## Discovery Boundaries

- Discovery may ask questions and summarize profile facts.
- Discovery must not create strategy, content, channel recommendations, or budget allocation.
- Owner-visible research observations need a source ref or source label.
- Wrong or low-confidence matches are stored as discarded observations, not passed into AI context as facts.
- Strategy remains locked in every response until `confirm-profile` succeeds.

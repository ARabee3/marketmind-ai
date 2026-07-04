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
8. Every response updates a persisted profile-state/readiness snapshot.
9. NestJS automatically summarizes after the hybrid gate passes or turn 15.
10. The owner may finish early with `finish_anyway: true`; remaining blockers
    become explicit uncertainties.
11. Owner confirms the profile draft. Incomplete drafts require
    `acknowledge_incomplete: true`.
12. Strategy unlocks only after confirmation.

## Public NestJS Contract

| Route                                                | Purpose                                             | Example                                           |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| `POST /api/v1/discovery/start`                       | Accept intake and begin research.                   | `examples/discovery-start.request.json`           |
| `GET /api/v1/discovery/:session_id/status`           | Recover current session state and progress.         | `examples/discovery-status.response.json`         |
| `POST /api/v1/discovery/:session_id/respond`         | Continue the Discovery interview.                   | `examples/discovery-respond.request.json`         |
| `POST /api/v1/discovery/:session_id/summarize`       | Finish early or summarize an already-ready profile. | `examples/discovery-summarize.request.json`       |
| `POST /api/v1/discovery/:session_id/confirm-profile` | Confirm the draft and unlock Strategy.              | `examples/discovery-confirm-profile.request.json` |

## WebSocket Contract

Socket.IO namespace:

```text
WS /ws/v1/discovery
```

After authenticating, the client emits `discovery.join` with
`{"session_id":"<uuid>"}`. The server verifies ownership, joins the
session-specific room, and emits `discovery.progress.snapshot`.

Progress events are live feedback only. If the client disconnects, it should call
`GET /api/v1/discovery/:session_id/status`.

Example transcript:

```text
examples/discovery-progress.transcript.json
```

## Internal FastAPI Contract

| Route                                      | Purpose                                                                    | Example                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /internal/v1/ai/discovery/start`     | Create the first Discovery question from intake and intelligence context.  | `examples/internal-ai-discovery-start.request.json`                                |
| `POST /internal/v1/ai/discovery/respond`   | Continue a Discovery turn from message history.                            | Use the same result shape as `examples/internal-ai-discovery-start.response.json`. |
| `POST /internal/v1/ai/discovery/summarize` | Produce a structured profile draft from an application completion context. | `examples/internal-ai-discovery-summarize.request.json`                            |

## Market-Aware Profile

`confirmed_facts` is a structured description of the owner's actual marketing
reality, not a generic free-form summary. It contains:

- identity and locality;
- offers, best sellers, price range, and purchase occasions;
- real customer groups, needs, occasions, and peak periods;
- owner-claimed differentiation and available proof;
- current channels, activities, delivery presence, and usable assets;
- growth goals, timeframe, spend range, team capacity, and operational limits.

`market_context` is separate. It groups competitor, local-demand,
digital-presence, and other market signals derived only from accepted
`research_observations` with source references. Research never becomes a
confirmed owner fact merely because an AI model summarized it.

## Conversation Style

The coverage fields are internal scaffolding, not questions to show the owner.
Discovery asks one concise, contextual question at a time:

- ask about concrete moments such as a busy shift, repeated order, customer
  comparison, or quiet period;
- connect the question to known intake, an earlier answer, or cited research;
- never ask form-like questions such as "Who is your target audience?" or
  "What is your USP?";
- do not repeat known information or copy a `knowledge_gap.question_hint`
  verbatim;
- preserve unknown fields as uncertainties when the owner cannot answer.

All providers use the same `discovery-v2-market-aware` prompt and turn
instructions.

The model returns cumulative facts, domain-aware uncertainties, domain scores,
`ready_to_summarize`, and a fallback next question. NestJS independently
enforces balanced structural and score thresholds. Low research confidence
never blocks completion. A successful gate or the fifteenth owner turn invokes
summarization automatically from the final respond request.

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
- Incomplete drafts retain their completion reason and blocking domains and
  require explicit acknowledgement during confirmation.

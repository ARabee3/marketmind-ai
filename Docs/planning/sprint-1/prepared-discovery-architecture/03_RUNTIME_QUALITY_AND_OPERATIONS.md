# Runtime Quality and Operations

## Error Handling Strategy

### API Error Shape

All NestJS public errors return:

```json
{
  "error": {
    "code": "DISCOVERY_SESSION_NOT_FOUND",
    "message": "Discovery session was not found.",
    "request_id": "req_abc123",
    "retryable": false,
    "details": {}
  }
}
```

Rules:

- `code` is stable and machine-readable.
- `message` is safe for users.
- `request_id` is included in every response and log line.
- `details` never includes secrets, raw tokens, raw prompts, or stack traces.
- Internal FastAPI errors use the same shape.

### HTTP Status Codes

| Status | Use |
|---:|---|
| `200` | Synchronous success. |
| `201` | Created user/profile when immediately complete. |
| `202` | Discovery start accepted and research running. |
| `400` | Malformed request body. |
| `401` | Missing/invalid auth. |
| `403` | Authenticated but missing permission. |
| `404` | Resource not found or not owned by user. |
| `409` | State conflict, duplicate email, already confirmed. |
| `422` | Valid JSON but semantically invalid domain input. |
| `429` | Rate limit or research cap exceeded. |
| `500` | Unexpected server error. |
| `502` | Internal AI service/provider bad response. |
| `503` | AI service unavailable or timed out. |

### Retry Semantics

- `POST /api/v1/discovery/start` accepts optional `Idempotency-Key`.
- If the same owner sends the same idempotency key within 10 minutes, return the existing session.
- Metadata fetch retries once after a short backoff.
- Search fetch retries once after a short backoff.
- LLM structured output can retry once with a repair prompt.
- Auth login/register must not auto-retry server-side.
- WebSocket reconnect uses `GET /api/v1/discovery/:session_id/status` plus replay from `discovery_progress_events`.

### WebSocket Error Events

Progress error event shape:

```json
{
  "type": "progress",
  "session_id": "uuid",
  "seq": 7,
  "stage": "search",
  "status": "failed",
  "message_key": "discovery.search.partial_failure",
  "message_text": "Some public search results could not be loaded.",
  "retryable": true
}
```

WebSocket never becomes the source of truth.

## Testing Strategy

### Test Split

NestJS:

- Unit tests for auth service, RBAC guards, Discovery state transitions, metadata parser, search cap logic, error mapping.
- Integration tests for PostgreSQL repositories and migrations.
- E2E tests for auth and Prepared Discovery HTTP flow.

FastAPI:

- Unit tests for provider adapter, prompt boundary, schema validation, failure normalization.
- Contract tests for `/internal/v1/ai/discovery/start`, `respond`, and `summarize`.

Cross-service:

- Contract fixtures shared as JSON examples.
- One happy-path e2e transcript for a fictional Egyptian SME (the worked example uses a café; the product targets SMEs across industries).
- One failure-path transcript for partial research and provider failure.

### Minimum Coverage Targets

Sprint 1 targets:

- Auth/RBAC critical paths: 85% branch coverage.
- Discovery orchestration critical paths: 80% branch coverage.
- Metadata/search helpers: core cases covered; percentage less important than wrong-match and failure tests.
- FastAPI prompt/provider adapter: all provider modes covered.

Do not chase 100% coverage. Cover the paths that can break demos, security, or owner confirmation.

### Required Test Cases

- Register success and duplicate email.
- Login success and wrong password.
- Refresh and logout.
- RBAC allows/rejects permissions.
- Discovery start with owner links.
- Discovery start without owner links.
- Metadata extraction success and unreachable URL.
- Free/no-key search partial failure.
- Wrong or low-confidence match discarded.
- WebSocket progress persisted and replayable by status.
- Arabic-only interview.
- English-only interview.
- Mixed Arabic/English interview.
- Unknown answer.
- Contradictory answer.
- Owner asks for strategy during Discovery.
- Prompt injection attempt.
- Provider unavailable.
- Provider invalid structured output.
- Profile confirmation locks the confirmed version.

### CI Pipeline

Minimum GitHub Actions jobs:

1. Install dependencies.
2. Lint/format check.
3. Typecheck NestJS.
4. Run NestJS unit tests.
5. Run FastAPI tests.
6. Run PostgreSQL migration check against a service container.

Full browser/frontend tests are deferred with frontend docs.

## Deployment and Environment Plan

### Local Development

Required:

- Node.js for NestJS.
- Python for FastAPI.
- Docker Compose for PostgreSQL.

Optional:

- Qdrant container for future RAG experiments.

Local services:

```text
postgres:5432
api:3001
ai:8000
qdrant:6333 optional
```

Sprint 1 should provide:

- `docker-compose.yml` for PostgreSQL and optional Qdrant.
- `.env.example` for `apps/api`.
- `.env.example` for `services/ai`.
- Local run commands in README.

### Environment Promotion

Use three environments:

- `local`: developer machines, mock provider allowed.
- `staging`: real deployed services, test secrets, demo data allowed if labeled.
- `prod`: real users, no mock provider for user-visible AI.

Deploy order:

1. Apply PostgreSQL migrations.
2. Start NestJS API.
3. Start FastAPI AI service.
4. Run health checks.
5. Run a smoke Prepared Discovery start/status flow.

### Health Checks

Sprint 1:

- `GET /api/v1/health` returns service status only.

After DB integration:

- Add `database: ok`.

After AI service integration:

- Add `ai_service: ok` based on a cheap internal health call.

Do not require Qdrant health until Qdrant is used.


## Secret Management

### Local

- Commit `.env.example`.
- Never commit `.env`, `.env.local`, real keys, or copied production secrets.
- Developers create local env files manually.

### CI

- Use GitHub Actions secrets.
- CI can run `mock` provider tests without LLM keys.
- Provider integration tests should be optional and manually triggered until cost is controlled.

### Staging and Production

- Store secrets in the hosting provider secret manager.
- Rotate leaked keys immediately.
- Keep separate keys for staging and production.
- Never log Authorization headers, refresh tokens, API keys, or raw provider request bodies.


## Observability

### Logging

Use structured JSON logs with:

- `request_id`
- `user_id` when authenticated
- `session_id` for Discovery
- `route`
- `status_code`
- `latency_ms`
- `error_code`

Do not log:

- passwords
- refresh tokens
- API keys
- full raw prompts
- full owner private notes if not needed

### Metrics

Track at minimum:

- Discovery sessions started.
- Discovery sessions reaching `ready_for_chat`.
- Research partial/failed counts.
- AI provider failures.
- Schema validation failures.
- Average research duration.
- Average AI turn latency.
- WebSocket disconnect count when easy to capture.

Sprint 1 can store enough observability in logs plus `agent_runs`, `intelligence_runs`, and `discovery_progress_events`. A dashboard is deferred.

### Tracing

Use `request_id` across:

- public HTTP request
- WebSocket progress event
- internal FastAPI request
- database logs when possible


## Non-Functional Requirements

### Latency Targets

| Operation | Target | Hard cap |
|---|---:|---:|
| `POST /api/v1/discovery/start` initial response | 2s | 5s |
| Metadata fetch per URL | 5s | 8s |
| Total pre-chat research | 60s | 180s |
| AI chat turn | 15s | 30s |
| Status polling response | 500ms | 2s |
| WebSocket progress event write | 250ms | 1s |

If total research hits the hard cap, mark the session `partial_ready` or `research_failed` and let chat continue safely.

### Research Caps

Sprint 1 caps:

- Max owner-submitted links per intake: 8.
- Max metadata fetch attempts per link: 2.
- Max search queries per session: 5.
- Max search results stored per session: 20.
- Max owner-visible research observations: 8.
- Max conversation hooks: 5.
- Max knowledge gaps: 10.

### WebSocket Limits

- One active WebSocket per browser tab/session is expected.
- Server must tolerate reconnect.
- Client can recover through `GET /api/v1/discovery/:session_id/status`.
- Progress events are append-only per session.

### Data Retention

Sprint/demo defaults:

- Auth users and confirmed profiles: keep until deleted manually.
- Discovery sessions/messages: keep 180 days in development/staging.
- Raw metadata/search payloads: keep 30 days unless promoted into confirmed profile.
- Logs: keep 14 days locally/staging.

Production retention should be reviewed before real customers.

### Security Requirements

- Passwords are hashed with Argon2id preferred, bcrypt acceptable if already chosen by the team.
- Refresh tokens are stored as hashes only.
- All owner-scoped queries filter by `owner_user_id`.
- Public URL fetcher blocks private network targets to avoid SSRF.
- Metadata extraction stores snippets, not full page archives.
- AI prompt input must not include secrets.
- Owner confirmation is required before Strategy can use a profile.

## Sprint 1 Readiness Checklist

Architecture:

- [ ] Use `/api/v1`, `/ws/v1`, and `/internal/v1` prefixes.
- [ ] Keep NestJS as the only PostgreSQL writer.
- [ ] Keep Qdrant optional and unused in Sprint 1.
- [ ] Provide WebSocket progress plus HTTP status recovery.

Database:

- [ ] Add Prisma to `apps/api`.
- [ ] Add migrations `0001` through `0006`.
- [ ] Add role/permission seed script.
- [ ] Verify migrations on empty PostgreSQL.
- [ ] Verify migrations on existing dev PostgreSQL.

Errors:

- [ ] Define shared error envelope.
- [ ] Add request id middleware.
- [ ] Map provider failures to safe retryable errors.

Testing:

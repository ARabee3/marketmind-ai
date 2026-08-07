# services/ai

FastAPI AI service for MarketMind AI. It powers Prepared Discovery and the
Sprint 4 curated RAG pipeline for the Strategy Agent.

## Run locally

Start the required local dependencies (PostgreSQL, Redis):

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
```

If you are working on Sprint 4 RAG, start Qdrant separately:

```bash
docker compose -f infra/docker/docker-compose.qdrant.yml up -d
curl --fail --retry 10 --retry-connrefused --retry-delay 1 \
  http://localhost:6333/healthz
```

Then run the AI service:

```bash
cd services/ai
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Local development defaults to deterministic `mock` LLM mode and `fake`
embedding mode, so no API keys are required for the default path.

## Environment

Copy `.env.example` to `.env` and configure the providers you need:

### LLM provider

- `AI_PROVIDER_MODE=mock`: deterministic local/test behavior.
- `AI_PROVIDER_MODE=openai`: requires `OPENAI_API_KEY` and `OPENAI_MODEL`.
- `AI_PROVIDER_MODE=gemini_dev`: requires `GEMINI_API_KEY` and `GEMINI_MODEL`.
- `AI_PROVIDER_MODE=openrouter`: requires `OPEN_ROUTER_API_KEY` and `OPEN_ROUTER_MODEL`.

### Static-image provider

- `IMAGE_PROVIDER_MODE=mock`: deterministic local/test image bytes (default).
- `IMAGE_PROVIDER_MODE=openai`: requires `OPENAI_API_KEY` and uses `IMAGE_MODEL`.
- `IMAGE_PROVIDER_MODE=gemini`: requires `GEMINI_API_KEY` and `IMAGE_MODEL`
  (e.g. `gemini-2.5-flash-image`). Supports fixed 1024x1024 only.
- `IMAGE_PROVIDER_MODE=openrouter`: requires `OPEN_ROUTER_API_KEY`; set
  `IMAGE_MODEL` to a paid Gemini image slug (e.g. `google/gemini-3.1-flash-image`,
  "Nano Banana 2"). Supports fixed 1024x1024 only.
- `IMAGE_PROVIDER_MODE=unavailable`: explicit prompt-only state for provider-disabled environments.
- `IMAGE_REQUEST_TIMEOUT_MS`: image-provider timeout in milliseconds.
- `CONTENT_ASSET_STORAGE_DIR`: required with the OpenAI image provider; points
  to a durable local or shared-volume root. Without it, media remains an
  explicit failed state and no provider call is made.

Content generation metadata records prompt/reference versions, provider/model,
exact Strategy/profile/week identities, input hashes, validation codes, and item
counts. Prompt bodies, full Business Profiles, provider responses, credentials,
and revision notes are not logged.

### Orchestration Phase 5 tracing

The agentic path remains disabled by default. Sanitized local trace events are
the fallback evidence; external export is independently opt-in with
`AI_ORCHESTRATION_TRACE_ENABLED=true` and
`AI_ORCHESTRATION_TRACE_EXPORTER=langfuse`. The deployment injects the reviewed
Langfuse/OTel transport rather than making the existing AI routes depend on a
trace SDK. Export failures are recorded as degraded tracing and never fail a
graph run. Prompt bodies, private profile content, credentials, and contact
data are redacted before either local storage or export.

### Embedding provider (for RAG)

- `EMBEDDING_PROVIDER_MODE=fake`: deterministic local/test behavior (default).
- `EMBEDDING_PROVIDER_MODE=openai`: requires `OPENAI_API_KEY`.
  - Default production model: `text-embedding-3-large` (3072 dims).
  - Use `text-embedding-3-small` (1536 dims) for faster/cheaper local development.

### Qdrant (optional)

Qdrant is required only for Sprint 4 RAG/vector retrieval. Start it with:

```bash
docker compose -f infra/docker/docker-compose.qdrant.yml up -d
```

Default local connection:

```text
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION_NAME=marketing_knowledge_v1
```

The service attempts to ensure the configured collection exists on startup.
If Qdrant is not running, the failure is logged but non-fatal so Discovery
remains available. The collection records its embedding provider, model,
dimensions, and configuration version. If any value differs from the live
configuration, startup logs a clear error requiring a new collection version
and full re-index.

Do not commit real keys.

## Internal Routes

```text
GET  /health
POST /internal/v1/ai/discovery/start
POST /internal/v1/ai/discovery/respond
POST /internal/v1/ai/discovery/summarize
POST /internal/v1/ai/strategy/retrieve
POST /internal/v1/ai/strategy/score
POST /internal/v1/ai/strategy/generate
POST /internal/v1/ai/strategy/revise
POST /internal/v1/ai/content/generate
POST /internal/v1/ai/content/revise
POST /internal/v1/ai/content/assets/generate-static
```

The `/health` endpoint also reports Qdrant reachability.

## RAG modules

| Module | Responsibility |
| --- | --- |
| `app/embeddings` | Embedding provider abstraction (fake + OpenAI) |
| `app/qdrant` | Qdrant client, collection, payload indexes, and point operations |
| `app/rag` | Live RAG config combining embedding and Qdrant settings |

## Tests

Run the full suite (no API keys required by default):

```bash
cd services/ai
uv run pytest
```

Unit tests run without a Qdrant instance. Integration tests in
`tests/test_qdrant_client.py` require a local Qdrant container and are
automatically skipped when it is unreachable.

Run only unit tests:

```bash
uv run pytest -m "not integration"
```

Run only integration tests:

```bash
uv run pytest -m integration
```

Run the isolated LangGraph Phase 0 durability gate against a disposable local
database whose name ends in `_test`, `_ci`, or `_e2e`:

```bash
PHASE0_DATABASE_URL=postgresql://marketmind:marketmind_dev@localhost:5433/marketmind_phase0_test \
  uv run pytest tests/orchestration/test_phase0_durability.py -m integration -vv
```

The gate starts a disposable FastAPI probe, pauses a fake graph with
`interrupt()`, terminates it, starts a fresh process, resumes the same
`thread_id`, rejects sequential and concurrent duplicate starts/resumes, and
verifies one idempotency-keyed fake side effect. It is not mounted by
`app.main` and does not write product Strategy, Content, approval, or
publishing data.

Provider tool-calling checks are intentionally opt-in because they make live
requests. Configure the provider keys/models, then run:

```bash
PHASE0_PROVIDER_MATRIX=1 uv run --env-file .env pytest \
  tests/orchestration/test_provider_capability_matrix.py -m network -vv
```

If the configured OpenRouter route is rate-limited, choose a permitted model
without editing `.env`, for example:

```bash
PHASE0_PROVIDER_MATRIX=1 PHASE0_OPENROUTER_MODEL=openai/gpt-4o-mini \
  uv run --env-file .env pytest \
  tests/orchestration/test_provider_capability_matrix.py -m network -vv
```

The mock provider
is covered by the local durability probe; a live provider that cannot emit the
requested function call is a visible Phase 0 no-go.

## Discovery Result Shape

Every Discovery provider is normalized to one backend-friendly result:

```text
ask_next_question     -> next_question is present
ask_clarification     -> next_question is present and explains the missing fact
produce_profile_draft -> profile_draft is present and strategy remains locked
safe_failure          -> safe_error is present and no invented profile is returned
```

The provider model never writes database IDs. The service wraps valid provider
output into the shared internal response shape before NestJS stores anything.

## Important RAG rule

Confirmed Business Profiles are **never** embedded into the shared Qdrant
collection. The full profile is passed directly from NestJS to the Strategy
Agent. Qdrant only stores reviewed marketing knowledge chunks.

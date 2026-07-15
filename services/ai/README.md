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
remains available. If the existing collection has a different vector size than
`EMBEDDING_DIMENSIONS`, startup logs a clear error so you can delete the
mismatched collection or change the embedding configuration.

Do not commit real keys.

## Internal Routes

```text
GET  /health
POST /internal/v1/ai/discovery/start
POST /internal/v1/ai/discovery/respond
POST /internal/v1/ai/discovery/summarize
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

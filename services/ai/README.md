# services/ai

FastAPI AI service for Prepared Discovery.

## Run locally

```bash
cd services/ai
uv run uvicorn app.main:app --reload --port 8000
```

Local development defaults to deterministic `mock` mode and does not need LLM
keys.

## Environment

Copy `.env.example` to `.env` and choose one provider mode:

- `AI_PROVIDER_MODE=mock`: deterministic local/test behavior.
- `AI_PROVIDER_MODE=openai`: requires `OPENAI_API_KEY` and `OPENAI_MODEL`.
- `AI_PROVIDER_MODE=gemini_dev`: requires `GEMINI_API_KEY` and `GEMINI_MODEL`.
- `AI_PROVIDER_MODE=openrouter`: requires `OPEN_ROUTER_API_KEY` and `OPEN_ROUTER_MODEL`.

Do not commit real keys.

## Internal Routes

```text
GET  /health
POST /internal/v1/ai/discovery/start
POST /internal/v1/ai/discovery/respond
POST /internal/v1/ai/discovery/summarize
```

All provider responses are validated against the local Pydantic schema before
they are returned to NestJS. Provider failures return `action: "safe_failure"`
with a safe retryable error when appropriate.

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

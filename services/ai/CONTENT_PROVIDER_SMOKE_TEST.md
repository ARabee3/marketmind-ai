# Content Provider Smoke Test

This is a manual, fictional-fixture check for environments with provider credentials.
It does not approve, schedule, or publish content.

1. Copy `.env.example` to `.env` and set `AI_PROVIDER_MODE=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL` for text. Set `IMAGE_PROVIDER_MODE=openai` and `IMAGE_MODEL` only when testing static images.
2. Start the service with `uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`.
3. Send a fictional `content-v1` generation request for the Koshary Corner fixture to `POST /internal/v1/ai/content/generate`. Use `text_post` first so the test does not depend on asset persistence.
4. If testing media, call `POST /internal/v1/ai/content/assets/generate-static` with fictional creative text and verify `generated_static`, `ready`, `storage_key`, `checksum`, and provider provenance.
5. Record only non-secret metadata: contract version, prompt version, provider/model, Strategy/profile/week IDs, input hash, validation result, item count, latency, and provider request ID.
6. Never record API keys, full prompts, full Business Profiles, raw provider responses, or real customer/business data.

Expected failures must remain visible: provider unavailability returns `prompt_only`/`missing`, provider failure returns `failed`, and invalid structured output returns a stable `CONTENT_SCHEMA_FAILURE`.

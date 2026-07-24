# Knowledge Ingestion Pipeline

This package implements the Python side of issue #71: an authenticated,
idempotent ingestion pipeline that validates the curated Markdown corpus,
chunks/embeds it, persists the authoritative records in PostgreSQL, and indexes
Qdrant.

## Architecture

- **Schema owner**: `apps/api/prisma/schema.prisma` and its migrations.
- **Python reader/writer**: SQLAlchemy + asyncpg, using the exact physical
  (snake_case) table and column names defined by Prisma.
- **CLI tool**: `app.knowledge.ingestion.cli` — a Typer CLI used by operators.
- **Pipeline orchestration**: `app.knowledge.ingestion.pipeline` — the main
  `run_ingestion_pipeline()` coroutine.
- **Qdrant derived index**: `app.qdrant` and `app.knowledge.ingestion.qdrant_sync`
  build payloads/upserts. The collection can be rebuilt from Postgres at any
  time.

## Files

| File | Responsibility |
| --- | --- |
| `cli.py` | Typer commands: `ingest`, `dry-run`, `rebuild`, `db-ready`. |
| `pipeline.py` | Main orchestration: load, validate, classify, persist, embed, upsert, retire. |
| `repository.py` | SQLAlchemy helpers for all knowledge governance tables. |
| `loader.py` | Markdown corpus discovery, front-matter parsing, validation, source resolution. |
| `chunker.py` | Markdown-aware chunking with token budgets. |
| `qdrant_sync.py` | Qdrant payload assembly and upsert. |
| `rebuild.py` | Re-index approved live versions without creating new versions. |
| `schemas.py` | Internal Pydantic/dataclass shapes. |
| `errors.py` | Ingestion error codes and exceptions. |

## Environment variables

All variables live in `services/ai/.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Same PostgreSQL URL used by Prisma/NestJS. |
| `KNOWLEDGE_INTERNAL_CLI_TOKEN` | Yes | Shared secret used by the `ingest`/`rebuild` CLI commands. |
| `KNOWLEDGE_SOURCE_DIR` | Yes | Default corpus directory, relative to repo root. |
| `KNOWLEDGE_STRICT_SOURCES` | Yes | When `true`, unresolved source URLs fail the run. |
| `KNOWLEDGE_CHUNK_MIN_TOKENS` | Yes | Minimum chunk size. |
| `KNOWLEDGE_CHUNK_MAX_TOKENS` | Yes | Target chunk size. |
| `KNOWLEDGE_CHUNK_OVERLAP_TOKENS` | Yes | Overlap between chunks. |
| `EMBEDDING_PROVIDER_MODE` | Yes | `fake`, `openai`, or `gemini`. |
| `EMBEDDING_MODEL` | Yes | e.g. `text-embedding-3-large` or `text-embedding-004`. |
| `EMBEDDING_DIMENSIONS` | Yes | Must match the model. |
| `GEMINI_API_KEY` | Only for `gemini` | Reused from the Gemini AI provider; required for Gemini embeddings. |
| `QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_COLLECTION_NAME` | Yes | Qdrant target. |

## CLI usage

Run from the `services/ai` directory.

```powershell
# Validate the corpus without writing anything
uv run python -m app.knowledge.ingestion.cli dry-run

# Ingest the default corpus
uv run python -m app.knowledge.ingestion.cli ingest --commit-sha (git rev-parse HEAD)

# Ingest a custom corpus
uv run python -m app.knowledge.ingestion.cli ingest `
  --source-dir knowledge `
  --repo-root D:\marketmind\marketmind-ai `
  --commit-sha abc123

# Rebuild Qdrant index from approved live Postgres versions
uv run python -m app.knowledge.ingestion.cli rebuild

# Check PostgreSQL connectivity and create tables locally
uv run python -m app.knowledge.ingestion.cli db-ready
```

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | `succeeded` or `dry_run` (validation passed). |
| `1` | `failed` — no entries were ingested, or DB connectivity failed. |
| `2` | `partial_failure` — some entries succeeded, others failed. |

### Using Gemini embeddings

```bash
# services/ai/.env
EMBEDDING_PROVIDER_MODE=gemini
EMBEDDING_MODEL=text-embedding-004
EMBEDDING_DIMENSIONS=768
EMBEDDING_BATCH_SIZE=32
GEMINI_API_KEY=your-gemini-api-key
```

## Idempotency

- Entries are classified by comparing the body checksum against the latest
  version in Postgres.
- Unchanged entries are skipped (no new version, no Qdrant churn).
- Changed entries create a new immutable version; the previous version is
  retired (`review_status = 'retired'`) in the same run.
- Removed files retire the corresponding entry.
- Qdrant point IDs are deterministic (`uuid5(chunk_id + entry_version)`), so
  re-ingestion updates points in place rather than duplicating them.

## Verification

After a run, the CLI prints a JSON report. Check:

- `status` is `succeeded` (or `partial_failure` if some entries failed).
- `entered_count` / `updated_count` / `skipped_count` match expectations.
- `errors` is empty.
- Qdrant point count equals the total chunks of approved live versions.

You can also query the database:

```sql
SELECT status, entered_count, updated_count, skipped_count, failed_count
FROM marketing_knowledge_ingestion_runs
ORDER BY started_at DESC
LIMIT 5;
```

## Rollback / retry

- Each entry is persisted inside a SQLAlchemy nested transaction. A failure
  rolls back that single entry but does not stop the run.
- A failed run can simply be re-run with the same corpus: unchanged entries
  will skip, and changed entries will be re-attempted.
- If you need to rebuild only the Qdrant index (e.g., after deleting the
  collection), use `rebuild`.
- To fully roll back a run, manually delete the `marketing_knowledge_entry`,
  its versions, source refs, and chunks from Postgres, then delete the related
  Qdrant points by `chunk_id`/`entry_version` if they were already indexed.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `DATABASE_URL is not configured` | `.env` missing | Copy `.env.example` and set `DATABASE_URL`. |
| `CLI authentication token is required` | Token missing | Set `KNOWLEDGE_INTERNAL_CLI_TOKEN` or pass `--token`. |
| `SOURCE_RESOLUTION_FAILED` | URL unreachable | Check the URL or run with `--no-strict-sources` (not recommended for production). |
| `CHECKSUM_MISMATCH` | File edited without running the Node validator | Run `npm run check:marketing-knowledge` in the repo root. |
| `TAXONOMY_VIOLATION` | Invalid front-matter value | Check `Docs/marketing-knowledge/_schema/TAXONOMY.md`. |
| Qdrant count does not match | Partial failure or missing rebuild | Run `rebuild` to re-index approved live versions. |

## Testing

All tests are in `services/ai/tests/`. Integration tests require PostgreSQL and
Qdrant and are marked with `@pytest.mark.integration`.

```powershell
# Unit tests only
uv run pytest -m "not integration"

# All tests
uv run pytest

# Or via npm
npm run check:ai
```

## Related docs

- `Docs/marketing-knowledge/README.md` — corpus authoring workflow.
- `Docs/marketing-knowledge/_schema/FRONT_MATTER_SCHEMA.md` — field spec.
- `Docs/marketing-knowledge/_schema/TAXONOMY.md` — controlled vocabularies.
- `apps/api/prisma/MARKETING_KNOWLEDGE_SCHEMA.md` — canonical data model.
- `services/ai/app/qdrant/schemas.py` — Qdrant payload shape.

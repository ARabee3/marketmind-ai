# Marketing Knowledge Governance — Schema Documentation

This document is the canonical data-model reference for the shared marketing
knowledge library introduced by issue [#69]. It is the contract any future
reader — most importantly the Python FastAPI ingestion/retrieval services
(issues #71 / #72) — depends on to read these PostgreSQL tables directly.

The schema is defined in `apps/api/prisma/schema.prisma` and created by the
migration `apps/api/prisma/migrations/20260721170411_add_marketing_knowledge_
governance/migration.sql`.

## Architectural decision — Option A

Prisma / NestJS is the **single schema and migration owner**. The FastAPI
AI service reads these PostgreSQL tables **directly** (raw SQL or SQLAlchemy
reflected models pointed at the exact `@map`/`@@map` physical names below),
using the table and column names as the stable contract. NestJS does **not**
expose an internal HTTP read API for these tables; FastAPI does not go
through it.

This matches the architecture doc's description of FastAPI owning "Qdrant
retrieval and PostgreSQL hydration contract." It is also the least-work
option now and avoids duplicating what `packages/contracts` already models
for strategy retrieval.

If this decision needs to change later, change it in an ADR and update this
file; do not silently route reads through a different path.

## Tables and relationships

Five tables, all owned by this schema. None of them references `Business` or
`BusinessProfileVersion` — this is a shared-knowledge library only.

```
marketing_knowledge_entries (1)
  └── marketing_knowledge_entry_versions (N, immutable, versioned)
        ├── marketing_knowledge_source_refs (N, citations)
        └── marketing_knowledge_chunks (N, embedding/Qdrant pointers)

marketing_knowledge_ingestion_runs (1)
  └── marketing_knowledge_ingestion_errors (N, per-entry failures)
```

- `marketing_knowledge_entries` is the **stable identity** of a knowledge
  item, keyed by a human `slug`. It holds `latest_version`, a denormalized
  convenience pointer updated in the same transaction that inserts a new
  version; it is **not** the source of truth for "what's live."
- `marketing_knowledge_entry_versions` is the **immutable, auditable**
  version row. Newer versions are always new rows (`version` increments);
  an approved version's content can never be updated (see the trigger
  below). `(entry_id, version)` is unique.
- `marketing_knowledge_source_refs` are citations linked to one immutable
  version, so benchmark evidence resolves without Qdrant.
- `marketing_knowledge_chunks` store the *results* of chunking/embedding
  (not the chunking logic), plus the projection metadata (`qdrant_point_id`,
  `qdrant_collection_name`, `indexed_at`) that issue #71 later fills in.
- `marketing_knowledge_ingestion_runs` / `..._ingestion_errors` record
  each ingestion run: actor, commit sha, configuration, counts, and the
  per-entry errors that let a `partial_failure` finish keep the
  successfully-indexed entries.

All foreign keys are `ON DELETE CASCADE` from parent to child.

## Exact physical (snake_case) names

These names are the contract a future Python reader depends on. Prisma field
names are camelCase; the on-disk column names are snake_case via `@map`.

### `marketing_knowledge_entries`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slug` | text | unique |
| `latest_version` | int | default 0 |
| `created_at` | timestamptz | default now() |

### `marketing_knowledge_entry_versions`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `entry_id` | uuid FK → entries | |
| `version` | int | |
| `kind` | text | CHECK-constrained |
| `title` | text | |
| `summary` | text | |
| `body` | text | |
| `locale` | text | CHECK-constrained |
| `markets` | text[] | app-validated |
| `industries` | text[] | app-validated |
| `business_models` | text[] | free-form slugs (no fixed vocab) |
| `objectives` | text[] | app-validated |
| `funnel_stages` | text[] | app-validated |
| `channels` | text[] | app-validated |
| `seasons` | text[] | app-validated |
| `budget_modes` | text[] | app-validated |
| `evidence_tier` | text | CHECK-constrained |
| `review_status` | text | CHECK-constrained, default `'draft'` |
| `effective_at` | timestamptz | |
| `expires_at` | timestamptz? | null = never expires |
| `author` | text | GitHub handle, NOT a FK to `User` |
| `reviewer` | text? | GitHub handle, NOT a FK to `User` |
| `reviewed_at` | timestamptz? | |
| `checksum` | text | |
| `created_at` | timestamptz | default now() |

Unique: `(entry_id, version)`. Indexes: see migration SQL (review_status +
effective_at + expires_at; `kind`; `locale`; `evidence_tier`; GIN on every
array column).

### `marketing_knowledge_source_refs`
| Column | Type |
| --- | --- |
| `id` | uuid PK |
| `entry_version_id` | uuid FK → entry_versions |
| `reference` | text |
| `note` | text? |
| `created_at` | timestamptz |

Index: `entry_version_id`.

### `marketing_knowledge_chunks`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `entry_version_id` | uuid FK → entry_versions | |
| `chunk_order` | int | |
| `text` | text | |
| `token_count` | int | |
| `checksum` | text | |
| `embedding_provider` | text | |
| `embedding_model` | text | |
| `embedding_dimensions` | int | |
| `embedding_version` | text | |
| `qdrant_point_id` | uuid? | filled by #71 |
| `qdrant_collection_name` | text? | filled by #71 |
| `indexed_at` | timestamptz? | filled by #71 |
| `created_at` | timestamptz | |

Unique: `(entry_version_id, chunk_order)` and the idempotency key
`(checksum, embedding_provider, embedding_model, embedding_dimensions,
embedding_version)` named `chunk_idempotency_key`. Index: `entry_version_id`.

### `marketing_knowledge_ingestion_runs`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `status` | text | CHECK-constrained; default `'pending'` |
| `actor` | text | |
| `commit_sha` | text? | |
| `configuration` | jsonb | default `{}` |
| `entered_count`, `updated_count`, `skipped_count`, `failed_count` | int | default 0 |
| `started_at` | timestamptz | default now() |
| `finished_at` | timestamptz? | |
| `created_at` | timestamptz | |

Index: `(status, started_at)`.

### `marketing_knowledge_ingestion_errors`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `run_id` | uuid FK → ingestion_runs | |
| `slug` | text? | |
| `version` | int? | |
| `error_code` | text | |
| `error_message` | text | |
| `created_at` | timestamptz | |

Index: `run_id`.

## The eligibility predicate (canonical definition of "live knowledge")

This is the single source of truth that both the NestJS read path
(`MarketingKnowledgeEligibilityService.findEligible`) and any future FastAPI
reader MUST apply identically. A version is **eligible** if and only if:

```sql
review_status = 'approved'
  AND effective_at <= now()
  AND (expires_at IS NULL OR expires_at > now())
```

Boundary semantics: `effective_at` exactly `now()` is eligible (`<=`);
`expires_at` exactly `now()` is **not** eligible (uses `>`, not `>=`).

A newer version that is still `draft` does **not** un-eligible an older
`approved` version of the same entry — eligibility is per-version, never
"latest version wins." `latest_version` on the entry row is a convenience
pointer only.

## Immutability trigger

`trg_enforce_mkv_immutability` (`BEFORE UPDATE` on
`marketing_knowledge_entry_versions`) calls
`enforce_marketing_knowledge_version_immutability()`. When the OLD row is
`approved`:

- Raising on any change to the **content** fields `kind, title, summary,
  body, locale, markets, industries, business_models, objectives,
  funnel_stages, channels, seasons, budget_modes, evidence_tier,
  effective_at, checksum, entry_id, version`.
- Raising on reverting `review_status` back to `'draft'`.
- **Permitting** `review_status` moving to `'retired'` or `'expired'`
  (the supersede / manual-expire flows).
- **Permitting** tightening `expires_at` (e.g. manually expiring a
  benchmark early) — `expires_at` is intentionally not in the
  immutability list, but the `chk_mkv_expiry_after_effective` CHECK still
  requires any new value to be strictly after `effective_at`.

This means application code must **never** `UPDATE` an approved version's
content — it always `INSERT`s a new `version = old.version + 1` row, and
only `UPDATE`s the *old* row's `review_status` to `'retired'`.

## Taxonomy enforcement — DB CHECK vs. application layer

The scalar taxonomy fields are enforced at the database layer with `CHECK`
constraints:

| Field | CHECK constraint | Allowed values |
| --- | --- | --- |
| `review_status` | `chk_mkv_review_status` | `draft`, `approved`, `retired`, `expired` |
| `evidence_tier` | `chk_mkv_evidence_tier` | `verified_benchmark`, `reviewed_guidance`, `contextual_note` |
| `locale` | `chk_mkv_locale` | `ar-EG`, `en`, `mixed` |
| `expires_at` | `chk_mkv_expiry_after_effective` | null OR strictly after `effective_at` |
| approved row | `chk_mkv_approved_has_reviewer` | `approved` requires non-null `reviewer` AND `reviewed_at` |
| ingestion `status` | `chk_mkir_status` | `pending`, `running`, `succeeded`, `partial_failure`, `failed` |

The **array-element** fields (`markets`, `industries`, `business_models`,
`objectives`, `funnel_stages`, `channels`, `seasons`, `budget_modes`) are
**application-layer enforced only** — by `apps/api/src/modules/
marketing-knowledge/taxonomy.ts` (`validateVersionTaxonomyArrays`). A raw
Postgres `CHECK` over array contents would need a helper function, so it is
not done at the DB layer. **Any ingestion code (#71) MUST also validate
array elements before insert using these same constants** — it must not
trust the DB to reject a bad array element.

Note: `business_models` has no fixed controlled vocabulary (the merged
contracts and the issue taxonomy omit it on purpose), so it is stored as a
free-form slug array and validated only for slug shape.

The allowed values for the app-validated array fields are exported from
`taxonomy.ts` as `KNOWLEDGE_MARKETS`, `KNOWLEDGE_INDUSTRIES`,
`KNOWLEDGE_OBJECTIVES`, `KNOWLEDGE_FUNNEL_STAGES`, `KNOWLEDGE_CHANNELS`,
`KNOWLEDGE_SEASONS`, `KNOWLEDGE_BUDGET_MODES`, and must stay byte-identical
to `packages/contracts` (`STRATEGY_OBJECTIVES`, `EXTERNAL_BUDGET_MODES`,
`EVIDENCE_TIERS`) and to `services/ai/app/qdrant/schemas.py`.

## Qdrant rebuild contract

`MarketingKnowledgeRebuildService.exportEligibleChunksForQdrant()` joins each
eligible version to its chunks and returns rows shaped **field-for-field
identically** to `services/ai/app/qdrant/schemas.py::QdrantKnowledgePoint`:

```
chunk_id, entry_id, entry_version, checksum, text, kind, locale,
markets, industries, business_models, objectives, funnel_stages,
channels, seasons, budget_modes, evidence_tier, review_status,
effective_at, expires_at
```

This is the literal proof that Qdrant is a rebuildable derived index: the
collection can be deleted and rebuilt from Postgres with no data loss. The
field list is hard-coded in `QDRANT_KNOWLEDGE_POINT_FIELDS`.

The TS↔Python field sync is now an **automated `npm run check` gate**, not a
manual reminder: `npm run check:qdrant-field-sync` (script at
`scripts/check-qdrant-field-sync.mjs`) compares the sorted field set of
`QDRANT_KNOWLEDGE_POINT_FIELDS` against
`services/ai/app/qdrant/schemas.py::QdrantKnowledgePoint.model_fields` and
fails `npm run check` on any drift. If `QdrantKnowledgePoint` adds or renames
a field, update the export mapping and `QDRANT_KNOWLEDGE_POINT_FIELDS`, and
the rebuild snapshot test (and the sync gate) will fail until you do.

## Indexes

Every field that `services/ai/app/qdrant/indexes.py` lists as needing fast
filtering also has a real Postgres index, so the FastAPI read path is not
handicapped by going to Postgres directly:

- review_status + effective_at + expires_at (composite btree)
- kind, locale, evidence_tier (btrees)
- markets, industries, business_models, objectives, funnel_stages,
  channels, seasons, budget_modes (GIN, for array-overlap `&&` filters)
- entry_version_id on source_refs and chunks
- status + started_at on ingestion_runs
- run_id on ingestion_errors
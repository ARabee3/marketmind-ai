# Database Schema and Migrations

## Database Architecture

### Database Principles

- Use PostgreSQL as the only source-of-truth database.
- Use UUID primary keys for externally referenced records.
- Use `created_at`, `updated_at`, and soft status fields where lifecycle matters.
- Use JSONB only where the shape is AI/provider-driven or expected to evolve quickly.
- Keep confirmed owner facts separate from research observations.
- Store citations as first-class rows, not only inside JSON.
- Store WebSocket progress as recoverable events.
- Do not require Qdrant in Sprint 1 migrations.

### Migration Tool

Use Prisma Migrate from `apps/api` for Sprint 1.

Reasons:

- The first database writer is NestJS.
- The team needs generated TypeScript types quickly.
- Migrations live with the API that owns persistence.
- FastAPI can stay stateless for Sprint 1.

If the team later chooses another migration tool, keep this table design and convert the migrations, but do not run two migration systems at once.

### PostgreSQL Extensions

Migration `0001_extensions`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
```

`pgcrypto` gives `gen_random_uuid()`.
`citext` gives case-insensitive email uniqueness.

### Core Tables

#### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | User id. |
| `email` | `citext not null unique` | Login email. |
| `password_hash` | `text not null` | Argon2id or bcrypt hash. |
| `full_name` | `text` | Optional. |
| `status` | `text not null default 'active'` | `active`, `disabled`. |
| `preferred_locale` | `text not null default 'ar-EG'` | `ar-EG`, `en`, `mixed`. |
| `created_at` | `timestamptz not null default now()` |  |
| `updated_at` | `timestamptz not null default now()` |  |

Indexes:

- unique `users_email_key` on `email`.
- btree `users_status_idx` on `status`.

#### `refresh_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Refresh session id. |
| `user_id` | `uuid not null references users(id) on delete cascade` | Owner. |
| `token_hash` | `text not null unique` | Hash only. Never store raw token. |
| `user_agent` | `text` | Optional. |
| `ip_address` | `inet` | Optional. |
| `expires_at` | `timestamptz not null` | Required. |
| `revoked_at` | `timestamptz` | Set on logout. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `refresh_sessions_user_id_idx` on `user_id`.
- btree `refresh_sessions_expires_at_idx` on `expires_at`.

#### `roles`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Role id. |
| `name` | `text not null unique` | `owner`, `admin`, `developer_demo`. |
| `description` | `text` | Optional. |
| `created_at` | `timestamptz not null default now()` |  |

#### `permissions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Permission id. |
| `name` | `text not null unique` | Example: `discovery:start`. |
| `description` | `text` | Optional. |
| `created_at` | `timestamptz not null default now()` |  |

#### `role_permissions`

| Column | Type | Notes |
|---|---|---|
| `role_id` | `uuid references roles(id) on delete cascade` |  |
| `permission_id` | `uuid references permissions(id) on delete cascade` |  |
| `created_at` | `timestamptz not null default now()` |  |

Primary key:

- `(role_id, permission_id)`.

#### `user_roles`

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid references users(id) on delete cascade` |  |
| `role_id` | `uuid references roles(id) on delete cascade` |  |
| `created_at` | `timestamptz not null default now()` |  |

Primary key:

- `(user_id, role_id)`.

#### `businesses`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Business id. |
| `owner_user_id` | `uuid not null references users(id)` | Current MVP owner. |
| `display_name` | `text not null` | Public business name. |
| `business_type` | `text not null` | `cafe`, `restaurant`, `bakery`, `other`. |
| `city` | `text not null` | Example: Cairo, Alexandria. |
| `area` | `text` | Neighborhood/district. |
| `address_text` | `text` | Optional. |
| `latitude` | `numeric(9,6)` | Optional. |
| `longitude` | `numeric(9,6)` | Optional. |
| `primary_locale` | `text not null default 'ar-EG'` |  |
| `status` | `text not null default 'draft'` | `draft`, `active`, `archived`. |
| `created_at` | `timestamptz not null default now()` |  |
| `updated_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `businesses_owner_user_id_idx` on `owner_user_id`.
- btree `businesses_city_area_idx` on `(city, area)`.

### Prepared Discovery Tables

#### `discovery_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Session id. |
| `business_id` | `uuid references businesses(id)` | Nullable until business row is created from intake. |
| `owner_user_id` | `uuid not null references users(id)` | Access control owner. |
| `status` | `text not null` | See lifecycle below. |
| `language_mode` | `text not null default 'mixed'` | `ar-EG`, `en`, `mixed`. |
| `current_question` | `text` | Last active assistant question. |
| `profile_draft_id` | `uuid` | Set after draft exists. |
| `confirmed_profile_version_id` | `uuid` | Set after confirmation. |
| `started_at` | `timestamptz not null default now()` |  |
| `completed_at` | `timestamptz` | Chat complete. |
| `created_at` | `timestamptz not null default now()` |  |
| `updated_at` | `timestamptz not null default now()` |  |

Allowed `status` values:

```text
not_started
researching
partial_ready
ready_for_chat
in_progress
summary_ready
confirmed
research_failed
failed
cancelled
```

Indexes:

- btree `discovery_sessions_owner_status_idx` on `(owner_user_id, status)`.
- btree `discovery_sessions_business_id_idx` on `business_id`.
- btree `discovery_sessions_created_at_idx` on `created_at`.

#### `prepared_discovery_intakes`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Intake id. |
| `session_id` | `uuid not null unique references discovery_sessions(id) on delete cascade` | One intake per session. |
| `business_name` | `text not null` | Submitted name. |
| `business_type` | `text not null` | Submitted category. |
| `city` | `text not null` | Submitted city. |
| `area` | `text` | Submitted area. |
| `address_text` | `text` | Optional. |
| `owner_goal_text` | `text` | Optional free text. |
| `known_competitors_text` | `text` | Optional free text. |
| `target_audience_text` | `text` | Optional free text. |
| `notes` | `text` | Optional. |
| `raw_payload` | `jsonb not null default '{}'` | Original form payload for evolvable fields. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- GIN `prepared_discovery_intakes_raw_payload_gin` on `raw_payload`.

#### `social_links`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Link id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` | Discovery session. |
| `business_id` | `uuid references businesses(id)` | Set when business row exists. |
| `platform` | `text not null` | `facebook`, `instagram`, `tiktok`, `website`, `google_maps`, `delivery`, `other`. |
| `url` | `text not null` | Submitted or discovered URL. |
| `owner_submitted` | `boolean not null default true` | True for intake links. |
| `status` | `text not null default 'pending'` | `pending`, `reachable`, `unreachable`, `discarded`. |
| `metadata` | `jsonb not null default '{}'` | Title, description, OG fields, handle. |
| `created_at` | `timestamptz not null default now()` |  |
| `updated_at` | `timestamptz not null default now()` |  |

Indexes:

- unique `social_links_session_url_key` on `(session_id, url)`.
- btree `social_links_session_platform_idx` on `(session_id, platform)`.
- GIN `social_links_metadata_gin` on `metadata`.

#### `intelligence_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Run id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `status` | `text not null` | `running`, `partial`, `complete`, `failed`. |
| `search_mode` | `text not null` | `metadata_only`, `free_search`, `provider_later`. |
| `started_at` | `timestamptz not null default now()` |  |
| `completed_at` | `timestamptz` |  |
| `duration_ms` | `integer` |  |
| `error_code` | `text` | Safe code. |
| `error_message` | `text` | Safe message. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `intelligence_runs_session_id_idx` on `session_id`.
- btree `intelligence_runs_status_idx` on `status`.

#### `source_refs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Source id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `intelligence_run_id` | `uuid references intelligence_runs(id) on delete set null` |  |
| `source_type` | `text not null` | `owner_link`, `metadata`, `search_result`, `manual_owner_answer`. |
| `platform` | `text` | Optional platform. |
| `url` | `text` | Optional for owner answers. |
| `title` | `text` | Source title. |
| `snippet` | `text` | Short snippet only. |
| `fetched_at` | `timestamptz` | For public data. |
| `confidence` | `numeric(4,3) not null default 0.500` | `0.000` to `1.000`. |
| `metadata` | `jsonb not null default '{}'` | Provider details, HTTP status, OG fields. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `source_refs_session_id_idx` on `session_id`.
- btree `source_refs_confidence_idx` on `confidence`.
- btree `source_refs_url_idx` on `url`.
- GIN `source_refs_metadata_gin` on `metadata`.

#### `research_observations`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Observation id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `source_ref_id` | `uuid references source_refs(id) on delete set null` | Citation. |
| `kind` | `text not null` | `digital_presence`, `competitor`, `market_context`, `social_signal`, `metadata`. |
| `statement` | `text not null` | Human-readable observation. |
| `confidence` | `numeric(4,3) not null default 0.500` |  |
| `visibility` | `text not null default 'internal'` | `owner_visible`, `internal`. |
| `status` | `text not null default 'accepted'` | `accepted`, `discarded`. |
| `discard_reason` | `text` | Required when discarded. |
| `metadata` | `jsonb not null default '{}'` | Structured extracted details. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `research_observations_session_status_idx` on `(session_id, status)`.
- btree `research_observations_kind_idx` on `kind`.
- GIN `research_observations_metadata_gin` on `metadata`.

#### `conversation_hooks`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Hook id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `source_observation_id` | `uuid references research_observations(id) on delete set null` | Optional source. |
| `hook_text` | `text not null` | Ready-to-use opening/context line. |
| `language` | `text not null default 'mixed'` |  |
| `status` | `text not null default 'active'` | `active`, `used`, `discarded`. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `conversation_hooks_session_status_idx` on `(session_id, status)`.

#### `knowledge_gaps`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Gap id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `field_key` | `text not null` | Example: `target_audience`, `best_selling_items`. |
| `question_hint` | `text not null` | Suggested question. |
| `priority` | `integer not null default 3` | `1` highest. |
| `status` | `text not null default 'open'` | `open`, `answered`, `skipped`. |
| `created_at` | `timestamptz not null default now()` |  |
| `updated_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `knowledge_gaps_session_status_priority_idx` on `(session_id, status, priority)`.

#### `discovery_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Message id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `role` | `text not null` | `owner`, `assistant`, `system`. |
| `content` | `text not null` | Message text. |
| `language` | `text not null default 'mixed'` |  |
| `source` | `text not null default 'chat'` | `chat`, `research_hook`, `summary`. |
| `metadata` | `jsonb not null default '{}'` | Token counts, safety flags. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `discovery_messages_session_created_idx` on `(session_id, created_at)`.

#### `business_profile_drafts`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Draft id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `business_id` | `uuid references businesses(id)` |  |
| `version` | `integer not null default 1` | Draft version. |
| `status` | `text not null default 'draft'` | `draft`, `ready_for_confirmation`, `confirmed`, `superseded`. |
| `confirmed_facts` | `jsonb not null default '{}'` | Owner-confirmed or owner-stated facts only. |
| `research_observations` | `jsonb not null default '[]'` | Research observations copied for review. |
| `uncertainties` | `jsonb not null default '[]'` | Unknowns/contradictions. |
| `owner_goals` | `jsonb not null default '[]'` | Goals stated by owner. |
| `strategy_relevant_notes` | `jsonb not null default '[]'` | Notes for later Strategy, not strategy itself. |
| `raw_ai_output` | `jsonb not null default '{}'` | Validated model output. |
| `created_by_agent_run_id` | `uuid` | References `agent_runs(id)` after table exists. |
| `created_at` | `timestamptz not null default now()` |  |
| `updated_at` | `timestamptz not null default now()` |  |

Indexes:

- unique `business_profile_drafts_session_version_key` on `(session_id, version)`.
- btree `business_profile_drafts_session_status_idx` on `(session_id, status)`.
- GIN `business_profile_drafts_confirmed_facts_gin` on `confirmed_facts`.

#### `business_profile_versions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Confirmed profile version. |
| `business_id` | `uuid not null references businesses(id)` |  |
| `draft_id` | `uuid references business_profile_drafts(id)` | Source draft. |
| `version` | `integer not null` | Increment per business. |
| `profile` | `jsonb not null` | Confirmed profile. |
| `confirmed_by_user_id` | `uuid not null references users(id)` | Owner. |
| `confirmed_at` | `timestamptz not null default now()` |  |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- unique `business_profile_versions_business_version_key` on `(business_id, version)`.
- btree `business_profile_versions_business_id_idx` on `business_id`.
- GIN `business_profile_versions_profile_gin` on `profile`.

#### `agent_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | Run id. |
| `session_id` | `uuid references discovery_sessions(id) on delete set null` |  |
| `run_type` | `text not null` | `discovery_start`, `discovery_turn`, `discovery_summary`. |
| `provider_mode` | `text not null` | `openai`, `gemini_dev`, `mock`. |
| `model_name` | `text` | From env. Not hardcoded in logic. |
| `prompt_version` | `text not null` | Example: `discovery-v1`. |
| `status` | `text not null` | `success`, `schema_retry_success`, `failed`. |
| `input_hash` | `text` | Hash instead of storing sensitive full prompt when possible. |
| `input_tokens` | `integer` | Optional. |
| `output_tokens` | `integer` | Optional. |
| `latency_ms` | `integer` |  |
| `output_json` | `jsonb not null default '{}'` | Validated output or safe failure. |
| `error_code` | `text` | Safe code. |
| `error_message` | `text` | Safe message. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- btree `agent_runs_session_id_idx` on `session_id`.
- btree `agent_runs_type_status_idx` on `(run_type, status)`.
- btree `agent_runs_created_at_idx` on `created_at`.

#### `discovery_progress_events`

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial primary key` | Event sequence table id. |
| `session_id` | `uuid not null references discovery_sessions(id) on delete cascade` |  |
| `seq` | `integer not null` | Per-session sequence. |
| `stage` | `text not null` | `queued`, `metadata`, `search`, `ai_start`, `ready`, `failed`. |
| `status` | `text not null` | `started`, `progress`, `complete`, `failed`. |
| `message_key` | `text not null` | Translation-safe key. |
| `message_text` | `text not null` | Safe fallback text. |
| `payload` | `jsonb not null default '{}'` | Counts and non-sensitive details. |
| `created_at` | `timestamptz not null default now()` |  |

Indexes:

- unique `discovery_progress_events_session_seq_key` on `(session_id, seq)`.
- btree `discovery_progress_events_session_created_idx` on `(session_id, created_at)`.

### Future MVP Tables

Do not implement these in Sprint 1 unless the sprint plan expands again:

- `strategies`
- `strategy_versions`
- `content_plans`
- `content_items`
- `publishing_targets`
- `publishing_actions`
- `analytics_snapshots`
- `optimization_suggestions`
- `approval_events`

The current schema leaves clean foreign-key anchors for them through `businesses`, `business_profile_versions`, and `users`.

## Migration Plan

### Sprint 1 Migration Order

1. `0001_extensions`
   - Enable `pgcrypto`.
   - Enable `citext`.
2. `0002_auth_rbac`
   - Create `users`, `refresh_sessions`, `roles`, `permissions`, `role_permissions`, `user_roles`.
   - Seed roles: `owner`, `admin`, `developer_demo`.
   - Seed permissions:
     - `business:read`
     - `business:update`
     - `discovery:start`
     - `discovery:continue`
     - `discovery:confirm_profile`
     - `strategy:start`
     - `admin:manage_library`
   - Assign all owner-safe permissions to `owner`.
3. `0003_businesses`
   - Create `businesses`.
4. `0004_prepared_discovery_core`
   - Create `discovery_sessions`, `prepared_discovery_intakes`, `social_links`, `discovery_messages`.
5. `0005_intelligence`
   - Create `intelligence_runs`, `source_refs`, `research_observations`, `conversation_hooks`, `knowledge_gaps`, `discovery_progress_events`.
6. `0006_profiles_and_agent_runs`
   - Create `agent_runs`, `business_profile_drafts`, `business_profile_versions`.
   - Add nullable FK from `business_profile_drafts.created_by_agent_run_id` to `agent_runs(id)`.
   - Add nullable FK fields on `discovery_sessions` to draft/profile tables if the migration tool supports it cleanly.

### Migration Rules

- Migrations are forward-only after merge.
- Never edit a merged migration; add a new migration.
- Migration PRs must include:
  - SQL/Prisma migration file.
  - Generated client update if Prisma is used.
  - Seed changes when roles/permissions change.
  - A rollback note, even if rollback is manual.
- Every migration must run against an empty local database and an existing development database.
- FastAPI must not own migrations.

### Seed Data

Initial seed:

- roles: `owner`, `admin`, `developer_demo`
- permissions listed in `0002_auth_rbac`
- role-permission links

Do not seed fake business/demo data in production migrations. Demo data belongs in a separate local seed script.

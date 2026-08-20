# 3. AI / RAG / Agentic Technical Document

## 1. Scope

The AI service (`services/ai`, FastAPI, Python 3.12, managed by `uv`) owns LLM
integration, prompts, the RAG pipeline, evaluation, and the gated agentic engine. Its
central configuration is `services/ai/app/core/config.py` (`Settings`, pydantic-settings,
`.env`). Governance of the reviewed-knowledge corpus is co-owned by the NestJS
`marketing-knowledge` module (which owns the Postgres tables).

## 2. LLM integration

**Providers (`ProviderMode`):** `mock` (code default / CI fallback), `openai`, `gemini_dev`,
`openrouter`. The values called out below are a local `.env` snapshot; this PR does not
verify the hosted provider runtime.
SDKs: `openai>=1.93`, `google-genai>=1.24`; OpenRouter reuses the OpenAI SDK with a custom
`base_url`. Each feature has its **own provider factory** with mock + real adapters:

| Feature | Factory / entry | Real adapters |
|---|---|---|
| Discovery | `app/providers/factory.py::create_provider` | OpenAI / Gemini / OpenRouter .|
| Strategy | `app/providers/strategy_provider.py::create_strategy_provider` | OpenAI / Gemini (no OpenRouter) |
| Content | `app/providers/content_provider.py` | OpenAI / Gemini / OpenRouter |
| Query planning | `app/search/llm_query_planner.py` | OpenAI / Gemini / OpenRouter (`mock` → deterministic planner) |
| Evidence triage | `app/search/llm_evidence_triage.py` | OpenAI / Gemini |
| Optimization | `app/optimization/providers.py` | Mock / OpenAI only; `gemini_dev` returns unavailable |
| Image / voice | `app/content/image_provider.py`, `app/voice_transcription/provider.py` | Gemini flash-image / Gemini flash |

**Model configuration (all in `config.py`, mirrored in `.env.example`).** Text-generation
model IDs are env-supplied (code defaults are empty as a safety fallback). The following
values are from the developer's ignored `.env` and are not proof of the hosted runtime:
`GEMINI_MODEL=gemini-3.5-flash-lite`, `OPEN_ROUTER_MODEL=google/gemma-4-31b-it:free`.

| Setting | Default |
|---|---|
| `embedding_model` / `embedding_dimensions` | `text-embedding-3-large` / `3072` |
| `image_model` (`image_provider_mode` defaults `mock`; **local snapshot = `openrouter`**) | `gemini-3.1-flash-image` |
| `voice_transcription_model` | `gemini-3.6-flash` |
| `rag_selection_mode` / `rag_mmr_lambda` | `semantic_mmr` / `0.5` |
| `ai_generation_attempts` | `3` (hard max 3) |
| `qdrant_collection_name` | `marketing_knowledge_v1` |

> The forward-dated Gemini IDs (`gemini-3.1`, `gemini-3.6`, `gemini-embedding-2`) are
> reported **verbatim as they appear in the code/config**; they are env-overridable.

**Structured output (pydantic-schema-driven):**
- **OpenAI:** `client.responses.parse(model=…, input=[…], text_format=<PydanticModel>)`
  (Responses API) → `response.output_parsed` → `Model.model_validate(...)`.
- **Gemini:** `generate_content(config=GenerateContentConfig(response_mime_type=
  "application/json", response_schema=<massaged schema>))` then `json.loads` +
  `model_validate`. Because Gemini's schema parser rejects `$ref`/`$defs`/`prefixItems`/
  `oneOf`, `strategy_provider.py` includes schema-rewriting helpers
  (`_strip_additional_properties`, `_resolve_refs`, `_infer_items_from_prefix`,
  `oneOf`→`anyOf`) and a re-prompt fallback on schema rejection.
- **OpenRouter:** `chat.completions.create(response_format={"type":"json_schema", …,
  "strict": True})`.

**Retries & repair (no cross-provider failover):** the per-artifact budget is
`ai_generation_attempts` (default/max **3** — a hard ceiling because NestJS sends one
logical request and never re-requests). Strategy generation runs a **validation-aware
repair loop** (`_generate_validated_plan`): on invalid output or failed policy validation
it re-prompts with targeted repair prompts, injecting only the rejected field snapshots
and treating prior output as untrusted (prompt-injection defense), with exponential
backoff on retryable `ProviderError`. Discovery has its own bounded repair
(`DISCOVERY_MAX_ATTEMPTS = 2`). Errors use `ProviderError(code, message, retryable)` →
HTTP 503 (retryable) vs 400/422. There is **no automatic failover to a different
provider**.

**Determinism guardrail (key point):** the LLM cannot invent channels, KPIs, or
budgets. These come from a deterministic decision engine (`app/decisions/`,
`compute_strategy_decisions`) and are re-imposed on model output via
`_normalize_deterministic_*` — "the model can never add, replace, or drop a channel."

## 3. Prompts

Prompts are **Python modules / string constants** (not external template files), with
**versioned identifiers recorded in generation metadata** for reproducibility. Provider
mode determines which prompt paths can run; see the provider and ledger notes below.

- Strategy: `app/strategy/prompts.py` + `app/strategy/assembler.py`. Versions
  (`app/strategy/prompt_versions.py`): `strategy-generate-v3`, `strategy-revise-v3`,
  `research-handoff-v1`, plus `marketingskills-prompt-patterns-v1` (an organizational
  pattern reference — explicitly **not** a source of evidence).
- Content: `app/content/prompts.py`, `planner_prompts.py`, `v2_generator.py`. Versions:
  `content-generate-v2`, `content-revise-v1`, `content-asset-v1`, `content-plan-v1`,
  `content-grounding-patterns-v1`.
- Discovery: `app/discovery/prompts.py` (`DISCOVERY_SYSTEM_PROMPT`); version
  `discovery-v2-market-aware`.
- Search: inline `QUERY_PLAN_SYSTEM_PROMPT` in `llm_query_planner.py`.

Prompt-driven features implemented: discovery interview, strategy generate/revise,
content generate/revise/weekly-plan/static-image, query planning, evidence triage, and
optimization proposals. In the local snapshot, text generation is configured for
`gemini_dev`, image generation is configured separately for `openrouter`, and optimization
is unavailable unless the provider mode is `mock` or `openai`. Snapshot tests:
`tests/content/test_prompt_snapshots.py`.

## 4. RAG pipeline

The RAG pipeline is implemented end-to-end and its embedding provider is configuration
dependent. The local `.env` snapshot uses the **Gemini provider** (`gemini-embedding-2`,
768-d); hosted embedding configuration still requires live verification.

**Ingestion (offline, CLI-driven) —** `app/knowledge/ingestion/`:
- CLI: `app/knowledge/ingestion/cli.py` (Typer app `marketmind-knowledge`, commands
  `ingest`, `dry-run`, `rebuild`, `db-ready`); run via
  `uv run python -m app.knowledge.ingestion.cli <cmd>`. Token-authenticated
  (`KNOWLEDGE_INTERNAL_CLI_TOKEN`, constant-time compare).
- Pipeline (`pipeline.py::run_ingestion_pipeline`): load + validate → classify
  new/changed/unchanged by **body SHA-256** (idempotent) → **eligibility filter**
  (`review_status == "approved"` AND `effective_at <= now` AND not expired) → chunk
  (`chunker.py::MarkdownChunker`, tiktoken; **300 min / 500 max / 50 overlap tokens**) →
  per-entry Postgres writes → batch embed (`purpose="retrieval_document"`) → Qdrant upsert
  with stable IDs → retire superseded/removed versions → `IngestionReport`. The Postgres
  schema is owned by Prisma in `apps/api`; **FastAPI never creates tables**.

**Source corpus —** `Docs/marketing-knowledge/` (default `knowledge_source_dir`):
**32 reviewed entries** (per `MANIFEST.json`), Markdown + YAML front matter, organized by
taxonomy (`benchmarks/`, `channels/`, `frameworks/`, `objectives/`,
`budget-measurement/`, `content-strategy/`, `regional/`, `sector-notes/`, `policy/`).
Authoring/governance assets live in `_schema/`; approvals in `APPROVAL_RECORD.md`.

**Embeddings —** `app/embeddings/`: `DeterministicFakeEmbeddingProvider` (CI fallback),
`OpenAIEmbeddingProvider` (`text-embedding-3-large`, 3072-d), `GeminiEmbeddingProvider`
(**local snapshot**: `gemini-embedding-2`, 768-d). `EmbeddingConfig.version = "embedding-v1"`.

**Vector store —** Qdrant (`qdrant-client==1.18.0`), collection `marketing_knowledge_v1`.
Point IDs are deterministic `uuid5(chunk_id#entry_version)`. The collection stores an
embedding fingerprint (provider + model + version + dims), and
`validate_collection_compatibility` refuses to mix incompatible vectors (checked on
startup in `main.py` and before every ingest).

**Retrieval —** `app/rag/retrieval_service.py::retrieve_strategy_knowledge`:
1. Privacy minimization (`privacy.py::sanitize_query_context`)
2. Sub-query construction (`query_builder.py::build_subqueries`)
3. Embed sub-queries (`purpose="retrieval_query"`)
4. Parallel Qdrant search (`query_points`, `limit=12`, category/time filters)
5. Regional preference + optional **MMR** + dedup/cap (`selection.py`, `mmr.py`,
   `regional.py`, `dedup.py`); default `semantic_mmr` (λ=0.5), `semantic` is the rollback.
   A configured MMR run **fails loudly** if Qdrant returns no vectors (no silent fallback).
6. Postgres hydration for chunk text + gap detection (`hydrator.py`)
7. Persist run (`persistence.py`; skippable with `persist=False` for shadow/agent reads)

Output: `RetrievedKnowledgePack` (items, `knowledge_gaps`, `retrieval_metadata`,
citations). Live endpoint: `POST /internal/v1/ai/strategy/retrieve`.

**Citations —** `PlanCitation` (citation_id / chunk_id / entry_id / entry_version /
evidence_tier / relevance_score), resolved from the retrieved pack; grounding enforced in
`app/strategy/validators.py` and the eval harness.

## 5. RAG / AI evaluation

Two deterministic, offline harnesses under `services/ai/tests/evaluation/`

**Retrieval + generation grounding** (`tests/evaluation/`): CLI `run_evaluation.py`
(`--suite smoke|full`, `--selection-mode semantic|semantic_mmr`), using the deterministic
fake embeddings + an in-memory Qdrant + `ai_provider_mode="mock"`. Metrics:
- labeled retrieval **precision@5 / recall@5 / MRR@5** (`metrics.py` returns `None` with a
  reason rather than fabricating labels);
- **RAG-vs-no-RAG** `grounding_improvement_score` (0.0 fail / 0.6 base pass / up to 1.0;
  `test_rag_comparison.py` asserts `>= 0.6`);
- grounding checks (citation integrity, retrieval resolution, benchmark validation, source
  enforcement, "skill leakage", source-reference violations, ungrounded KPIs) and a
  localization guard (flags forbidden generic terms like `arr`, `cac payback`,
  `linkedin-first`).
- Governance fixtures prove that expired/unapproved knowledge never surfaces; per-sector
  datasets under `dataset/`. Markers: `eval_smoke` / `eval_full`.

**Content evaluation** (`tests/evaluation/content/`): explicit threshold engine
(`runner/threshold.py`, `docs/thresholds.md`). Bars: **hard-guardrail = 1.0** (every
case's expected hard outcome must match) and **rubric quality = 0.9** (≥90% of applicable
human-rubric dimensions scored ≥4/5).

## 6. Agentic AI — implemented as code, gated OFF at runtime

Location: `services/ai/app/orchestration/` (phases 0–5), built on `langgraph==1.2.10` +
`langgraph-checkpoint-postgres==3.1.1`.

**Gating (state this clearly):**
- `ai_orchestration_enabled = False` by default (config comment: "orchestration is never
  enabled just because its code is deployed").
- **Not wired into any endpoint** — no orchestration router in `app/main.py`, and the
  NestJS `OrchestrationModule` has no controller.
- `phase5/rollout.py::decide_rollout` returns `disabled` unless the flag is on **and** the
  cohort is on an explicit allow-list; `shadow` mode records comparison evidence with **no
  domain writes**. Prod compose sets `AI_ORCHESTRATION_ENABLED="true"`, which at most
  enables shadow evidence — it does not move the live path onto the graph.

**Agent & roles:** a **Research Agent** (`phase2/research_agent.py::ResearchAgent`) — a
bounded controller loop that selects tools until an evidence gate is met, emitting
`ResearchPackV1` (facts / assumptions / knowledge_gaps + a `stop_reason`). The
tool-selection "brain" is a `ResearchToolSelector`; the **only implemented selector is
`DeterministicResearchSelector`** (described in-code as a "safe mock selector for CI and
demo rehearsal"). An LLM-driven selector is a documented **future extension**.

**Tools (allow-listed, 4)** — `phase2/builtins.py` + `phase2/registry.py`:
`search_approved_marketing_knowledge` (wraps RAG with `persist=False`, re-filters to
approved), `plan_trusted_research_queries` (never fetches the web),
`triage_research_evidence` (only server-provided candidates; treated as untrusted),
`calculate_strategy_decisions` (deterministic rules). The registry enforces: allow-list
only, pydantic validation of tool input **and** output, a per-run `ToolBudget` call cap, a
30 s per-call timeout, a 32 KB output cap, and a server-built context whose values "model
arguments cannot replace" (prompt-injection defense).

**Memory & orchestration:** in-process `_ResearchState` for the agent loop; durable graph
state via the LangGraph **Postgres checkpointer** (`phase0/` is an isolated durability
probe). Phase 3 (`phase3/graph.py`) is a durable Strategy segment; Phase 4
(`phase4/graph.py`) is the Content segment.

**Human-approval & review gates (contracts + deterministic reviewers):**
- LangGraph `interrupt`/`Command` owner-approval boundaries: `StrategyApprovalInterruptV1`
  (`phase3/contracts.py`) and `ContentApprovalInterruptV1` (`phase4/contracts.py`).
- Quality reviewers: `DeterministicStrategyQualityReviewer`, `ContentQualityReviewV1`
  ("no hidden chain-of-thought retained").
- Phase 5 safety: `phase5/shadow.py::compare_shadow_paths` compares current vs orchestrated
  on validity/latency/cost/citations and marks any **publication action in a shadow path
  as a regression**. `phase5/observability.py` supports a Langfuse exporter, **disabled by
  default** (`ai_orchestration_trace_enabled=False`).

**"Reviewed knowledge" governance (the human-approval gate for the corpus):** each entry
carries `review_status` (`draft`→`approved`), `evidence_tier` (`verified_benchmark` |
`reviewed_guidance` | `contextual_note`), `reviewer`, `reviewed_at`, `effective_at`,
`expires_at`, and `source_references` (real URLs validated by HEAD/GET, or the literal
`internal:reviewed-marketing-methodology`). Only named human reviewers may flip an entry
to `approved` (no self-approval). This "approved-only" rule is enforced at **three
layers**: ingestion eligibility, RAG hydration, and the agent's knowledge-search tool.
Governance docs: `Docs/marketing-knowledge/_schema/FRONT_MATTER_SCHEMA.md`,
`APPROVAL_RECORD.md`.

## 7. Configuration reference

Behaviour is driven by env vars in `services/ai/app/core/config.py`. Document only the
**names** and defaults; real keys live in the gitignored `services/ai/.env` (see
`.env.example`). The third column below is a **local configuration snapshot**, not a
verified hosted-runtime value. Production Compose overrides some values, including
`AI_ORCHESTRATION_ENABLED=true`.

| Env var | Code default | Local `.env` snapshot | Effect |
|---|---|---|---|
| `AI_PROVIDER_MODE` | `mock` | **`gemini_dev`** | Selects LLM provider.|
| `EMBEDDING_PROVIDER_MODE` | `fake` | **`gemini`** | Selects embeddings. |
| `GEMINI_MODEL` | `""` | **`gemini-3.5-flash-lite`** | Text-gen model ID. |
| `OPEN_ROUTER_MODEL` | `""` | **`google/gemma-4-31b-it:free`** | OpenRouter text-gen model. |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | `text-embedding-3-large` / `3072` | **`gemini-embedding-2`** / **`768`** | Embedding model and vector dimensions. |
| `IMAGE_PROVIDER_MODE` / `IMAGE_MODEL` | `mock` | **`openrouter`** / **`gemini-3.1-flash-image`** | Static-image generation. |
| `AI_ORCHESTRATION_ENABLED` | `false` | `false` | Gate for the agentic engine; production Compose sets `true`, but no HTTP endpoint is wired and the rollout remains shadow-only. |
| `AI_ORCHESTRATION_TRACE_ENABLED` | `false` | – | Langfuse tracing. |
| `AI_GENERATION_ATTEMPTS` | `3` | – | Per-artifact repair budget (hard max 3). |
| `RAG_SELECTION_MODE` / `RAG_MMR_LAMBDA` | `semantic_mmr` / `0.5` | `semantic_mmr` / `0.5` | Retrieval selection. |
| `QDRANT_COLLECTION_NAME` | `marketing_knowledge_v1` | **`marketing_knowledge_gemini_2_v1`** | Vector store collection. |
| `KNOWLEDGE_*` | source `Docs/marketing-knowledge`, chunk 300/500/50 | same | Ingestion. |

## 8. Implemented vs mocked/planned — AI ledger

| Area | Status |
|---|---|
| Provider abstraction, factories, OpenAI/Gemini/OpenRouter adapters, structured output, retry/repair | real code; local snapshot = `gemini_dev`; hosted runtime not verified |
| Text-gen model IDs | config-driven; local snapshot = `gemini-3.5-flash-lite` |
| Prompts + versioning (discovery/strategy/content/search) | implemented; provider-dependent at runtime |
| RAG retrieval + Qdrant + Postgres hydration + citations + MMR | real code; local embedding snapshot = `gemini` (`gemini-embedding-2`); hosted runtime not verified |
| Ingestion CLI + pipeline + governance filtering | Implemented CLI/pipeline; execution requires an explicit ingestion run |
| RAG eval (retrieval metrics, RAG-vs-noRAG grounding, governance fixtures) | deterministic |
| Content eval thresholds (hard=1.0, rubric=0.9) | engine; **rubric bar unmet pending human sign-off** |
| Agentic orchestration (phases 0–5, tools, approval interrupts, shadow/rollout) | disabled by default, no endpoint |
| Research Agent tool-selection brain | deterministic mock selector only |
| Langfuse tracing | present, disabled by default |

## 9. Source map

- Config: `services/ai/app/core/config.py`
- Routers: `services/ai/app/main.py`, `app/api/internal_v1/`
- Providers: `app/providers/`, `app/search/`, `app/optimization/`
- RAG: `app/rag/`, `app/qdrant/`, `app/embeddings/`, `app/knowledge/ingestion/`
- Agentic: `app/orchestration/phase0..phase5/`
- Corpus + governance: `Docs/marketing-knowledge/`, `_schema/`, `APPROVAL_RECORD.md`
- Evaluation: `services/ai/tests/evaluation/` (+ `content/docs/thresholds.md`)
- Prior design docs to cite: `Docs/planning/sprint-4/STRATEGY_AGENT_AND_CURATED_RAG_ARCHITECTURE.md`, `Docs/planning/08_AGENTIC_ORCHESTRATION_IMPLEMENTATION_PLAN.md`, `AGENTIC_ORCHESTRATION_PHASE5_RUNBOOK.md`, `AGENTIC_ORCHESTRATION_SHADOW_RESULTS.md`

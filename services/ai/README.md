# MarketMind AI service

FastAPI service for MarketMind's structured AI capabilities: bilingual
Discovery, bounded research helpers, curated Strategy RAG, deterministic
decision support, Strategy and Content generation/repair, static-image
generation, Optimization proposals, and feature-gated LangGraph orchestration.

## Run locally

From the monorepo root, the recommended path is:

```bash
cp services/ai/.env.example services/ai/.env
npm run dev:full
```

To run only the service after dependencies are available:

```bash
uv run --directory services/ai \
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Health: <http://localhost:8000/health>

Local development defaults to deterministic mock LLM/image providers and fake
embeddings. Configure real providers only in the gitignored `.env`; never
commit keys or provider responses containing private owner data.

## Capability map

| Package                                                    | Responsibility                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `app/discovery`                                            | Structured bilingual interview behavior and safe failures                        |
| `app/search`                                               | Bounded query planning and evidence triage                                       |
| `app/knowledge`, `app/rag`, `app/qdrant`, `app/embeddings` | Governed ingestion and retrieval over reviewed marketing knowledge               |
| `app/decisions`                                            | Deterministic Strategy calculations and policy decisions                         |
| `app/strategy`                                             | Retrieval-grounded generation, validation, revision, and scoring                 |
| `app/content`                                              | Content V1/V2 planning/generation, claims policy, validation, repair, and assets |
| `app/optimization`                                         | Evidence-bound hook/CTA proposal generation                                      |
| `app/orchestration`                                        | Durable, bounded, feature-flagged LangGraph execution                            |
| `app/providers`                                            | Mock and configured LLM/image provider adapters                                  |

Internal routes are mounted under `/internal/v1/ai/` for Discovery, search,
Strategy, Content, and Optimization. They are an API-to-AI boundary, not a
public owner-facing API.

## RAG boundary

Confirmed Business Profiles are passed directly as structured input and are
never embedded in the shared Qdrant collection. Qdrant contains only reviewed
marketing knowledge. PostgreSQL owns knowledge versions, approval, source,
expiry, and ingestion state; Qdrant can be rebuilt from that authority.

## Orchestration boundary

The LangGraph path is feature-flagged and disabled by default in ordinary local
development. It coordinates existing specialists but cannot publish, charge,
approve itself, or replace NestJS lifecycle state. Sanitized local traces are
the fallback evidence; external trace export is independently opt-in.

## Tests

```bash
# Repository-standard non-network suite
npm run check:ai

# Full local AI suite
uv run --directory services/ai pytest

# Opt-in provider/network coverage
npm run check:ai:network
```

Integration and network markers require their documented dependencies and are
not evidence of live-provider readiness unless those checks actually run.

See the maintained [AI/RAG/agentic technical document](../../Docs/technical-and-ai-docs/03_AI_RAG_AGENTIC_TECHNICAL_DOCUMENT.md)
for configuration and implementation detail.

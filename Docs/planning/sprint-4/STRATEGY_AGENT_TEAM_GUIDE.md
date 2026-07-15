# Strategy Agent — Sprint 4 Team Guide

**Read time:** about five minutes

**Purpose:** give the whole team the same simple implementation picture before
anyone starts an issue.

**Detailed source of truth:**
`STRATEGY_AGENT_AND_CURATED_RAG_ARCHITECTURE.md`

**GitHub parent issue:**
[#66 — Strategy Agent + curated RAG vertical slice](https://github.com/ARabee3/marketmind-ai/issues/66)

## 1. What we are building

The Strategy Agent turns the owner's confirmed Discovery information into one
explainable 12-week marketing plan.

```text
confirmed Business Profile + Strategy Brief
                    |
                    v
     retrieve relevant reviewed playbooks (RAG)
                    |
                    v
       calculate rules and decision boundaries
                    |
                    v
          LLM writes one structured draft
                    |
                    v
      validate facts, citations, budget, and limits
                    |
                    v
          owner reviews and decides
```

The agent helps the owner make a decision. It does not make the final decision
for the owner.

## 2. Four things that must stay separate

| Thing | Simple meaning | Storage |
| --- | --- | --- |
| Business Profile | Confirmed facts from Discovery about this business | PostgreSQL, passed directly |
| Playbook | Reusable, reviewed marketing guidance | PostgreSQL plus a Qdrant search copy |
| Rule | A hard product limit the model cannot override | Code and validators |
| Strategy | The custom 12-week plan for this business | Immutable PostgreSQL versions |

### Important RAG rule

We do **not** ingest Business Profiles into the shared vector database.

The full confirmed profile is already small, structured, private, and important.
Strategy receives it directly from PostgreSQL so retrieval cannot lose a fact
such as the budget, team capacity, or unresolved uncertainty.

RAG searches only the reviewed marketing library. A privacy-minimized summary
of relevant profile fields helps form the search query.

ببساطة: بيانات البيزنس بتدخل كاملة ومباشرة للاستراتيجية، والـ RAG بيدور فقط
في المعرفة التسويقية المراجعة.

## 3. What goes into the marketing library

The initial library is a small reviewed MarketMind handbook, not a dump of random
blogs. It covers:

- foundations: 5Cs, SWOT synthesis, STP, positioning, relevant 7Ps, SMART goals,
  and funnel stages;
- objective playbooks: awareness, acquisition, conversion, retention, and
  launch;
- channel playbooks: Facebook, Instagram, TikTok, Google Business Profile,
  landing pages, and relevant delivery platforms;
- content-strategy planning: pillars, format mix, sustainable cadence, weekly
  themes, and controlled experiments;
- budget and measurement: organic-only planning, spend scenarios, baseline
  modes, owner targets, and verified benchmark ranges;
- reviewed Egypt/MENA, language, sector, seasonal, policy, and benchmark notes.

Each item must say when it is useful, when it is a poor fit, what evidence
supports it, who reviewed it, and when it expires if it can become outdated.

Do not ingest generated plans, private profiles, unreviewed model output, random
blogs, copied competitor strategies, finished content, or unsupported numbers.

## 4. When the LLM is used

The LLM is used **after retrieval** to:

- interpret the confirmed profile and owner brief;
- combine relevant playbooks into one coherent plan;
- explain why an objective, audience, position, channel, budget mode, or KPI mode
  fits;
- write the structured 12-week Strategy draft;
- revise a draft from explicit owner feedback.

The LLM does not:

- approve knowledge or the final Strategy;
- choose more channels than the deterministic limit;
- change scorecard numbers or budget arithmetic;
- invent missing business facts, market facts, sources, or benchmarks;
- research the live web;
- generate final posts or publish anything.

## 5. One plan, clear boundaries

Every draft contains:

- situation diagnosis;
- one primary objective and funnel stage;
- selected audience and positioning;
- no more than two primary channels plus one supporting channel;
- tone, language, and three to five content pillars;
- a 12-week roadmap with themes, formats, cadence, and experiments;
- organic-only or external-spend scenarios;
- KPI and measurement plan;
- assumptions, knowledge gaps, blockers, and citations.

The Strategy Agent plans what should happen. The later Content Agent creates the
actual captions, scripts, posts, and assets. Publishing and spending remain
outside Strategy.

## 6. Runtime ownership

| Layer | Responsibility |
| --- | --- |
| Next.js Web | Brief, readiness, progress, plan review, evidence, assumptions, gaps, and owner decisions |
| NestJS API | Auth/ownership, journey state, queueing, persistence, retries, immutable versions, and public endpoints |
| FastAPI AI | ingestion, retrieval, decision rules, structured generation, revision, and validation |
| PostgreSQL | authoritative profiles, knowledge, retrieval runs, strategies, and decisions |
| Qdrant | rebuildable semantic-search index for approved playbook chunks |
| Redis/BullMQ | asynchronous Strategy generation jobs |

## 7. Sprint team split

Ahmed and Merzek own the frontend Strategy experience and review AI-critical
work together. The other four team members own the AI vertical slice and its
required contracts, storage, retrieval, validation, and orchestration.

| Team member | Primary Sprint 4 responsibility |
| --- | --- |
| Ahmed (`ARabee3`) | Shared visual refinement, Strategy brief/decisions UI, and product/AI review |
| Merzek (`mostafamerzk`) | Rich public landing, Strategy plan/evidence UI, and UX/AI review |
| Kordy (`MostafaAhmed22`) | Strategy contracts plus RAG/grounding evaluation |
| Abdulazim (`abdulazimRabie`) | Reviewed knowledge pack, governance storage, and deterministic marketing rules |
| Mokhtar (`MOKHXXXXXX`) | Qdrant/embedding setup, ingestion pipeline, and LLM generation |
| Gerges (`GergesYoussef-hub`) | Retrieval packs, NestJS lifecycle, queueing, and end-to-end integration |

Ownership is a starting allocation, not a knowledge silo. Every owner must be
able to explain and test the work. Ahmed and Merzek review every AI-critical PR;
the relevant technical peer also reviews interfaces that affect their work.

## 8. Implementation issues and dependency order

The GitHub issues are implementation packets. Work should follow this order:

### Foundation

1. [#67 — Strategy contracts and shared schemas](https://github.com/ARabee3/marketmind-ai/issues/67).
2. [#68 — Initial reviewed marketing playbook pack](https://github.com/ARabee3/marketmind-ai/issues/68).
3. [#69 — PostgreSQL knowledge-governance models](https://github.com/ARabee3/marketmind-ai/issues/69).
4. [#70 — Qdrant, embedding adapter, and deterministic test provider](https://github.com/ARabee3/marketmind-ai/issues/70).
5. [#71 — Idempotent ingestion, chunking, embedding, and indexing pipeline](https://github.com/ARabee3/marketmind-ai/issues/71).

### Intelligence

6. [#72 — Filtered retrieval and persisted `RetrievedKnowledgePack`](https://github.com/ARabee3/marketmind-ai/issues/72).
7. [#73 — Deterministic marketing decision rules](https://github.com/ARabee3/marketmind-ai/issues/73).
8. [#74 — Grounded LLM Strategy generation, revision, and validation](https://github.com/ARabee3/marketmind-ai/issues/74).
9. [#75 — RAG retrieval and Strategy grounding evaluation suite](https://github.com/ARabee3/marketmind-ai/issues/75).

### Product integration

10. [#76 — NestJS Strategy lifecycle, jobs, versions, decisions, and endpoints](https://github.com/ARabee3/marketmind-ai/issues/76).
11. [#77 — Frontend Strategy brief, readiness, progress, and failure states](https://github.com/ARabee3/marketmind-ai/issues/77).
12. [#78 — Frontend plan review, evidence, assumptions, gaps, and blockers](https://github.com/ARabee3/marketmind-ai/issues/78).
13. [#79 — Frontend approve, revise, reject, retry, and version history](https://github.com/ARabee3/marketmind-ai/issues/79).
14. [#80 — End-to-end Strategy vertical slice, observability, and demo verification](https://github.com/ARabee3/marketmind-ai/issues/80).

The frontend may begin against the approved shared contract and mock handlers.
It must not invent a different response shape while AI/backend work is still in
progress.

### Parallel frontend refinement

These three issues complete the other agreed Sprint 4 track. They improve the
existing product foundation while the four-person AI team builds Strategy:

- [#51 — Rich public landing page and verified-owner launchpad](https://github.com/ARabee3/marketmind-ai/issues/51), owned by Merzek;
- [#81 — Distinctive visual system and existing journey refinement](https://github.com/ARabee3/marketmind-ai/issues/81), owned by Ahmed;
- [#86 — shadcn-first agent component policy](https://github.com/ARabee3/marketmind-ai/issues/86), owned by Ahmed.

Issue #51 gives visitors the marketing explanation before the authenticated
workspace. Issue #81 refines the shared app shell, shadcn-based primitives,
authentication, and Discovery surfaces so the new Strategy UI builds on a
coherent product language. Issue #86 makes the component boundary explicit:
agents reuse accessible shadcn foundations before creating standard controls,
while MarketMind-specific patterns carry the product identity.

## 9. Definition of Done for the full agent

The Sprint 4 Strategy Agent is done only when:

- a confirmed Discovery profile and valid Strategy Brief can start generation;
- only approved, effective, non-expired playbooks can be retrieved;
- the exact retrieval pack is persisted and every citation resolves to it;
- the plan passes the channel, budget, capacity, benchmark, fact, and boundary
  validators;
- retrieval failure or missing knowledge is visible and never falls back to
  unsupported model memory;
- the owner can review the whole plan, request a revision, reject it, or approve
  it;
- revisions create immutable versions and never destroy the previous draft;
- no plan can publish, spend money, or auto-approve;
- at least 25 reviewed RAG cases pass the agreed acceptance checks;
- the team can demo and explain one complete 12-week Strategy journey.

## 10. Deferred on purpose

- Research Agent and live web research;
- knowledge administration UI and automatic web ingestion;
- private-document or Business Profile vector search;
- generated content, publishing, paid-ad execution, and optimization;
- advanced hybrid search or reranking unless evaluation shows it is needed.

## 11. First team checkpoint

Before implementation begins, confirm:

1. the shared contract and exact Discovery profile version used by Strategy;
2. the initial approved playbook list and human reviewers;
3. local PostgreSQL, Redis, and Qdrant development setup;
4. issue owners and technical dependencies;
5. the Koshary Corner fictional test fixture and the first evaluation cases;
6. the frontend mock contract so UI and AI work can proceed in parallel.

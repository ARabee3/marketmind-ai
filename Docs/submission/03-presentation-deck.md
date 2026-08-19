---
marp: true
title: MarketMind AI — Submission Presentation
theme: default
paginate: true
size: 16:9
---

<!-- _class: lead -->
# MarketMind AI

**Arabic-first growth workspace for Egyptian SMEs**
Plan · Create · Publish · Improve — with the owner in control

Graduation Project — ITI Submission · Merzek

---

## The Problem

Egyptian SMEs can't afford expert social-media marketing:

- ❌ **Cost** — agencies out of reach for small businesses
- ❌ **Time** — owners already run the operation
- ❌ **Skill** — best practice is English, scattered, and hard to translate
- ❌ **Trust** — generic AI publishes with no human in the loop

**Result:** inconsistent posting, wasted budget, no feedback loop.

---

## Target Users

Small & medium businesses in **Egypt**, across industries:

- Retail · Food & hospitality · Services · Education · Healthcare

**The persona:** a business owner (not a marketer) who
- runs one business, one brand,
- has limited budget and time,
- prefers **Egyptian Arabic** (English available),
- wants practical, explainable recommendations.

---

## The Solution

One guided journey — AI does the heavy lifting, the **owner approves every consequential step**.

> If an action can affect the real business, human approval is required.
> أي حاجة ممكن تأثر على البيزنس الحقيقي لازم موافقة إنسان واضحة.

**Distinctiveness:** Arabic-first (RTL) · explainable & cited · evidence-grounded · owner control · honest simulation.

---

## Five AI Roles + One Publishing Service

| Role | Job | Owner approves? |
|---|---|---|
| **Discovery** | Understand the business → `BusinessProfile` | ✅ |
| **Research** | Trusted, cited evidence → `ResearchPack` | sources visible |
| **Strategy** | 12-week marketing plan → `StrategyPlan` | ✅ |
| **Content** | Rolling weekly content → `ContentPack` | ✅ per week |
| **Optimization** | Future improvements → `OptimizationProposal` | ✅ one draft |

**Publishing is not an AI agent** — it's a safe, deterministic, approved action.

---

## The Journey (7 phases)

1. **Discover** — bilingual interview → confirmed profile
2. **Research** — curated RAG + limited web, cited
3. **Strategize** — 4-week plan + 12-week overview + KPIs
4. **Create** — 3–5 posts/week, AR/EN, images, video scripts
5. **Publish/Export** — real n8n publish · export · labeled simulation
6. **Monitor** — read-only Facebook Insights (24h/72h/7d)
7. **Improve** — owner-approved hook/CTA suggestion

---

## Architecture Summary

Monorepo, three deployable apps:

```text
apps/web   Next.js 16 (app router, next-intl, RTL, shadcn)
apps/api   NestJS (Prisma + PostgreSQL, Redis/BullMQ workers)
services/ai FastAPI (LLM providers, RAG, image gen)
packages/contracts  shared TypeScript schemas
infra      Docker Compose (Postgres, Redis, Qdrant, n8n)
```

- API ↔ AI over **HTTP only** (no source imports)
- Postgres = source of truth · Qdrant = rebuildable vector index
- Publishing → **n8n** workflow (deterministic)

---

## AI & RAG Highlights

- **Curated RAG** — reviewed Arabic/English marketing knowledge in Qdrant (Gemini embeddings, MMR retrieval with lambda 0.5)
- **Profile never embedded** — Business Profile stays in Postgres, never in the shared vector index
- **Provider-neutral** — mock / Gemini / OpenRouter adapters; separate image provider
- **Honesty by design** — every output shows citations, assumptions, knowledge gaps, and blockers

---

## Owner-in-Control Gates

Every consequential step is gated on explicit approval:

- Profile confirmation → before strategy
- Strategy approve/edit/reject → before content
- Content approval → before publish/export
- **Publish approval** → exact candidate + target + mode + schedule
- Optimization approval → one future draft only

The AI **never** publishes, changes direction, or rewrites history on its own.

---

## Testing & Quality

- **Contracts** — shared schemas validated across web, API, AI
- **API** — unit + e2e (NestJS + Prisma)
- **AI** — pytest for discovery/strategy/content/orchestration, provider contract tests, RAG MMR + retrieval evaluation
- **Web** — Vitest components + Playwright e2e + dictionary parity (`ar`/`en`)
- **Knowledge** — schema + source-resolution validation (`check:marketing-knowledge`)
- One command: `npm run check`

---

## Limitations (honest)

- One owner / one business (MVP)
- Facebook publishing only; Instagram/TikTok & paid ads deferred
- Live publishing depends on an approved n8n/Meta integration; otherwise **labeled simulation**
- Facebook-only monitoring; no manual analytics
- Full video generation, agency dashboards, billing — future work

---

## Roadmap

1. **Commercial readiness** — prepaid points-wallet billing (Egypt gateways)
2. **Broader publishing** — Instagram, scheduling
3. **Deeper optimization** — richer performance signals
4. **Multi-business / agency** — team & account management

---

<!-- _class: lead -->
# Thank you

**Live demo:** Discovery → Strategy → Content → review → export/publish

Docs: `Docs/submission/` · Demo runbook: `04-demo-runbook.md`

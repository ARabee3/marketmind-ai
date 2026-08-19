# MarketMind AI — Project Overview & Business Case

> Submission package · Issue #243 · Owner: Merzek
> Arabic-first growth workspace for Egyptian SMEs.

---

## 1. One-sentence summary

**MarketMind AI helps Egyptian small and medium businesses plan, create, publish, and improve their social media marketing with AI — while keeping the business owner in control of every important decision.**

باختصار: منصة عربي أولاً بتساعد أصحاب المشاريع الصغيرة والمتوسطة في مصر يخططوا وينتجوا وينشروا ويحسّنوا تسويقهم على السوشيال ميديا بالذكاء الاصطناعي — مع بقاء القرار المهم في يد صاحب المشروع.

---

## 2. The problem

Egyptian SMEs face a structural gap in marketing:

- **Cost** — hiring an agency or a full-time marketer is out of reach for most small businesses.
- **Time** — owners already run the daily operation; there is no spare capacity for planning and content.
- **Skill** — social media "best practice" lives in English, platform-specific knowledge is scattered, and most owners cannot translate it into a plan that works for *their* business.
- **Trust** — generic AI tools produce content with no connection to the actual business, its offers, its audience, or its budget, and they publish without a human in the loop.

The result: inconsistent posting, wasted budget, and no way to know what is working.

## 3. Target users

Small and medium businesses in Egypt, **across industries** — retail, food & hospitality, services, education, healthcare, and more. The system is deliberately industry-neutral; a café is used only as an illustrative example, never as the product's only shape.

Target persona: a **business owner** (not a marketer) who:

- runs one business and one brand,
- has limited budget and limited time,
- prefers **Egyptian Arabic** (with English available),
- wants practical, explainable recommendations — not a black box.

## 4. The solution

MarketMind AI is a **guided workspace** that takes an owner through one complete marketing journey, with AI doing the heavy lifting and the owner approving every consequential step.

### Core idea

Five focused AI roles plus one non-AI publishing service — each with a single responsibility:

| Role | Job | Output | Owner approval? |
|---|---|---|---|
| **Discovery Agent** | Understand the business | `BusinessProfile` | ✅ before strategy |
| **Research Agent** | Find trusted, cited evidence | `ResearchPack` | sources always visible |
| **Strategy Agent** | Build the marketing plan | `StrategyPlan` | ✅ approve / edit / reject |
| **Content Agent** | Create rolling weekly content | weekly `ContentPack` | ✅ per week |
| **Optimization Agent** | Suggest future improvements | `OptimizationProposal` | ✅ one future draft only |
| **Publishing Service** | Publish / export approved content | publication result | ✅ before any publish |

**One hard rule:** *anything that can affect the real business — real content, real publishing, real strategy direction — requires clear human approval.* The AI never publishes or changes direction on its own.

### Distinctiveness

- **Arabic-first** — bilingual (Arabic/English) with correct RTL throughout.
- **Explainable** — recommendations cite their sources; assumptions, knowledge gaps, and blockers are shown, never hidden.
- **Evidence-grounded** — strategy is supported by a curated, reviewed knowledge base (RAG) and limited trusted web research.
- **Owner control** — approval gates at every consequential step.
- **Honest simulation** — where a real integration is not yet available, the behavior is explicitly labeled as simulation, never presented as real.

## 5. The MVP journey (what is included now)

1. **Discover** — a short bilingual interview builds a confirmed Business Profile.
2. **Research** — trusted, cited marketing context (curated RAG first, limited web search when needed).
3. **Strategize** — a practical 12-week marketing strategy (goal, audience, platforms, tone, themes, budget direction, KPIs, citations).
4. **Create** — rolling weekly content (3–5 posts/week, Arabic/English captions, image ideas, short-video scripts).
5. **Publish or export** — deterministic publishing through an approved n8n/Meta workflow, or a checksum-addressed export, or a clearly-labeled simulation.
6. **Monitor** — read-only Facebook Page Insights for posts MarketMind actually published (test fixtures never appear as live analytics).
7. **Improve** — an evidence-backed hook/CTA suggestion, applied only after owner approval and only to one eligible future draft.

### Explicitly out of scope for this submission (deferred)

Subscriptions/payments, agency dashboards, multiple businesses per account, role-based access control, influencer matching, TikTok publishing, paid-ads execution, full video production, native mobile apps. These are honest exclusions, not hidden gaps.

## 6. Value proposition

| For the owner | What it means in practice |
|---|---|
| **Affordable** | Expert-level planning and content at a fraction of agency cost. |
| **Fast** | One guided journey from "I don't know where to start" to a publishable week. |
| **Grounded** | Every recommendation ties back to their real business, offers, audience, and budget. |
| **Safe** | Nothing reaches a real account without explicit approval. |
| **In their language** | Egyptian Arabic first, English available. |

## 7. Business case

- **Market size** — Egypt has one of the largest SME populations in the region, concentrated in retail, food, and services, the vast majority of which are under-served by affordable marketing tools.
- **Demand pull** — social media is the dominant discovery channel for Egyptian consumers; owners know they must be present but lack the capacity.
- **Unit economics** — AI generation is near-zero marginal cost; the product sells a *guided, approved* outcome (a real plan + real content), not raw tokens.
- **Defensibility** — the moat is the curated Arabic marketing knowledge base, the owner-in-control workflow, and honest, explainable output — not the underlying model.
- **Path to revenue** — the next planned slice is a prepaid points-wallet billing model (bundles, ledger, reserve/refund) tailored to Egypt-friendly gateways; documented in the sprint-6 architecture and excluded from the MVP demo.

## 8. Domain fit

**Content Creation & Marketing.** The product spans the full content lifecycle — plan → create → publish → measure → improve — which maps directly to the ITI submission domain.

---

*This document describes the current product and available evidence. Simulated or demo-only behavior is labeled as such. See `02-user-guide.md`, `03-presentation-deck.md`, `04-demo-runbook.md`, and `05-demo-video-script.md` for the operational deliverables.*

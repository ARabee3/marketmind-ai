# MarketMind AI — User Guide

> Submission package · Issue #243 · Owner: Merzek
> Bilingual (Arabic/English) · RTL-correct screenshots live in `assets/`.

---

## 1. What this guide covers

How to run MarketMind AI locally, sign in, and take a business through the full journey:

**Discovery → Strategy → Content → owner review → export/publish.**

---

## 2. Before you start (local setup)

Prerequisites: Node.js 20+, Docker + Docker Compose, and `uv` (Python 3.12+).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (one per app)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp services/ai/.env.example services/ai/.env

# 3. Run the full stack (Postgres + Redis + API + AI + web), with migrations:
npm run dev:full
```

Then open **http://localhost:3000** in your browser.

| Service | URL |
|---|---|
| Web (Next.js) | http://localhost:3000 |
| API (NestJS) | http://localhost:3001/api/v1 |
| AI (FastAPI) | http://localhost:8000 |
| Health check | `GET http://localhost:3001/api/v1/health` |

> The `dev` command starts Docker (Postgres on `5433`, Redis on `6379`), applies Prisma migrations, and launches all three apps in parallel. Stop everything with `Ctrl+C`.

---

## 3. Onboarding

1. Open the app. Unprefixed URLs are redirected to your locale (`/ar/` by default, or your preferred language).
2. **Switch language** any time — Arabic (RTL) and English are both supported; the whole interface flips direction correctly.
3. **Sign in** to create your single owner account (Google OAuth is configured for local development).
4. You land on the workspace home, ready to start **Discovery**.

> For the graduation MVP there is **one owner account and one business profile**. Multi-business and agency dashboards are intentionally deferred.

---

## 4. The journey, step by step

### Step 1 — Discovery: tell the system about your business

The Discovery Agent runs a short **bilingual interview**, asking one clear question at a time:

- business name and location,
- what you sell / your service,
- target customers and goals,
- budget and brand style,
- social media accounts and competitors,
- optional uploads: menu, logo, brand guide, photos.

**You must review and confirm the resulting Business Profile** before anything else can proceed. The profile records unknowns honestly — it does not invent facts.

> ✅ You approve the profile → Strategy can begin.

### Step 2 — Research: the system gathers evidence

The system collects **trusted, cited** marketing context — curated internal marketing knowledge first, limited web research only when needed. Every fact carries a source reference and a short note on why it matters. Sources stay visible to you.

### Step 3 — Strategy: your 12-week marketing plan

The Strategy Agent produces a practical plan you can **approve, edit, or reject**:

- primary goal and target audience,
- recommended platforms and tone/language,
- content themes,
- a **four-week detailed plan** and a **twelve-week overview**,
- budget direction and KPIs,
- citations, plus visible **assumptions, knowledge gaps, and blockers**.

> ✅ You approve the strategy → weekly content generation can start.

### Step 4 — Content: rolling weekly content

From the approved strategy, the system generates content **one week at a time** (3–5 posts per week):

- Arabic and English captions where useful,
- image ideas or generated assets,
- short-video scripts,
- posting notes.

Week 1 is created when the cycle starts; by the end of each week the next week's draft is ready for review. Automatic next-week generation creates **drafts only** — it never approves or publishes.

> ✅ You approve individual items (or a whole week) before anything moves forward.

### Step 5 — Publish or export (the approval boundary)

Approved content can leave the system in one of three honest ways:

1. **Real publish** — through an approved, deterministic n8n/Meta workflow, only when the target account, permissions, and media are ready and **you separately approve the exact candidate, target, mode, and schedule**.
2. **Export** — a checksum-addressed content package you can use anywhere.
3. **Simulation** — a clearly labeled deterministic demo simulation (never presented as real).

> Publishing is **not** an AI agent. It is a safe, logged, deterministic action that always requires your explicit approval.

### Step 6 — Monitor (Facebook, read-only)

For posts MarketMind actually published, the system collects read-only **Facebook Page Insights** automatically at comparable ages (24h / 72h / 7 days). Test fixtures and simulations never appear as live analytics.

### Step 7 — Improve (optional, owner-approved)

After enough comparable data, the system may suggest a **hook-style or CTA-wording change** for one future draft. It cannot touch the approved strategy, weekly plan, topics, audience, channel, format, locale, or past content. **You approve or dismiss it.**

---

## 5. Frequently asked questions

**Does the AI publish by itself?**
No. Publishing is deterministic and gated on your explicit approval of the exact candidate, target, mode, and schedule.

**Is my business data used to train anything?**
No. Business profile data stays in your local PostgreSQL. Only reviewed, curated marketing knowledge is embedded into the shared Qdrant index — never your profile.

**Why do I see "simulation"?**
Where a real external integration is not yet connected for the demo, the system shows a clearly-labeled simulation so you never mistake it for a real publish or real analytics.

**Can I use Arabic?**
Yes — Arabic is a first-class experience with correct RTL, and English is fully supported.

**What platforms are supported for publishing?**
Facebook (static posts) via an approved workflow. Instagram/TikTok publishing and paid ads are deferred for this submission.

**Can I manage several businesses?**
Not in this MVP. One owner, one business profile.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `GET /api/v1/health` times out | Postgres/Redis not up | `npm run docker:up`, then re-run `npm run dev` |
| Prisma migration error | DB schema drift | `npm run dev:full` (applies `prisma migrate deploy`) |
| AI `/health` shows `qdrant: unreachable` | Qdrant not running | `npm run docker:strategy:up` (starts Postgres + Redis + Qdrant) |
| Strategy retrieval empty | Knowledge not ingested | `npm run strategy:knowledge:sync:local` |
| Image generation fails | `IMAGE_MODEL` missing `google/` prefix for OpenRouter | set `IMAGE_MODEL=google/gemini-3.1-flash-image` in `services/ai/.env` |
| Login loop / 401 | JWT secrets rotated | sign in again (old tokens are invalid after a secret change) |
| Very slow first compile | repo on an external/network drive | move the repo to a local (ext4) filesystem, or wait for the initial compile |

---

*Screenshots are captured during the demo rehearsal (see `04-demo-runbook.md`) into `assets/` — landing + in-app steps, English and Arabic (RTL).*

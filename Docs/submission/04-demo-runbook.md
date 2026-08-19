# MarketMind AI — Demo Runbook

> Submission package · Issue #243 · Owner: Merzek
> A scripted live demo covering the full boundary: **Discovery → Strategy → Content → owner review → export/publish.**
> Rule: **label simulated or demo-only behavior honestly, every time.**

---

## 0. Preconditions (do this before the demo)

- [ ] Full stack running: `npm run dev:full` (Postgres, Redis, Qdrant, API, AI, web).
- [ ] Migrations applied and knowledge synced: `npm run strategy:knowledge:sync:local`.
- [ ] A seeded owner account with a confirmed Business Profile ready (so the demo starts at Strategy, not a cold Discovery interview — see "Rehearse a fresh journey" below if you want to show Discovery live).
- [ ] `apps/api/.env` and `services/ai/.env` configured (see `02-user-guide.md` §2).
- [ ] Browser at http://localhost:3000, fresh profile, **Arabic locale for the RTL pass, English for the second pass**.

**Honesty checklist** — before starting, confirm which publishing path you will show:
- ✅ Real n8n/Meta publish (only if a real, owner-authorized target + credentials are ready), or
- ✅ Checksum export (always safe), or
- ✅ Labeled simulation (safe, and clearly announced).

Never imply a real publish when showing export or simulation.

---

## 1. Opening (30s)

**Say:** "MarketMind AI is an Arabic-first workspace that takes an Egyptian small business from a confirmed profile to an approved, publishable week of content — with the owner approving every consequential step."

**Show:** home screen, then switch **Arabic ⇄ English** once to prove the RTL flip.

---

## 2. Discovery (skip if pre-seeded; show the confirmed profile)

If showing live:

1. Start a new Discovery interview.
2. Answer 2–3 questions in Arabic (e.g. café: name, location, weekday-foot-traffic goal, limited budget).
3. Point out the system asks **one clear question at a time** and records unknowns honestly.
4. **Confirm the Business Profile.**

If pre-seeded: open the confirmed profile and summarize what it captured.

**Talking point:** "The profile is the contract — nothing moves forward until the owner confirms it."

---

## 3. Strategy (90s)

1. Trigger strategy generation.
2. While it runs, explain the curated-RAG retrieval: "The strategy is grounded in a reviewed Arabic/English marketing knowledge base, with citations."
3. Show the result: goal, audience, recommended platforms (e.g. Instagram + Facebook), tone (Egyptian Arabic), themes, **4-week plan + 12-week overview**, budget direction, KPIs.
4. Point to **citations, assumptions, knowledge gaps, and blockers** — "we show uncertainty, we don't hide it."
5. **Approve** the strategy (or show edit/reject first, then approve).

---

## 4. Content (60s)

1. Open Week 1 content.
2. Show 3–5 posts: Arabic + English captions, an image idea/generated asset, a short-video script, posting notes.
3. **Approve** a single post (and optionally a whole week).
4. Emphasize: "auto-generation makes drafts only — it never approves or publishes."

---

## 5. The publish/export boundary (90s)

This is the most important moment — the approval boundary.

1. Open the approved post as a **publication candidate**.
2. Walk the three honest paths:

   | Path | Show | Label |
   |---|---|---|
   | **Export** | Download the checksum-addressed package | "This is an export — nothing was published." |
   | **Real publish** | (only if ready) approve exact candidate + target + mode + schedule | "This is a real publish to your Facebook page." |
   | **Simulation** | Run the deterministic demo simulation | "This is a clearly-labeled simulation — no real account was touched." |

3. **Say explicitly:** "Publishing is not an AI agent. It's a safe, deterministic, approved action."

---

## 6. Monitor & Improve (30s, optional)

1. Show a **MetricSnapshot** for a real published post (Facebook Insights, 24h/72h/7d ages).
2. Show an **OptimizationProposal** (hook/CTA suggestion) and **approve** it for one future draft.
3. Note: "fixtures never appear as live analytics."

---

## 7. Closing (30s)

**Say:** "One owner, one business, one guided journey — AI does the work, the owner keeps control. Thank you."

---

## Rehearse a fresh journey (cold start)

To demo Discovery from scratch:

1. `npm run docker:strategy:up && npm run prisma:deploy`
2. Create a new owner account (Google OAuth local) and start Discovery.
3. Complete the interview and confirm the profile, then continue from §3.

## Troubleshooting during the demo

| Issue | Fix |
|---|---|
| Strategy returns empty | run `npm run strategy:knowledge:sync:local` |
| Qdrant unreachable | `npm run docker:strategy:up` |
| Image gen fails | confirm `IMAGE_MODEL=google/gemini-3.1-flash-image` |
| Slow UI | first compile on external drive is slow; pre-warm each page once |

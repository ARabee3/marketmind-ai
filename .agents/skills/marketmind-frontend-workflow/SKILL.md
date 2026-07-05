---
name: marketmind-frontend-workflow
description: Routes frontend design, implementation, testing, debugging, and review work under apps/web for the MarketMind AI monorepo. Use when the task touches apps/web (Next.js 16 / next-intl / Tailwind v4 / shadcn primitives), including designing or styling UI, writing components or pages, looking up framework/library APIs, browser-testing interactive journeys, debugging runtime/console/network issues, or performing a final accessibility/UX review.
license: Internal — MarketMind AI graduation project. See repository LICENSE.
---

# MarketMind Frontend Workflow

You are working on **MarketMind AI** — a trustworthy, practical, Arabic-first
growth workspace for Egyptian SMEs across industries. AI should feel helpful,
explainable, and grounded in business evidence — not futuristic or mysterious.

This skill is a **router**: it identifies the task phase and loads only the
relevant approved skill / MCP. **Do not apply every skill or MCP to every
task.** Use the smallest relevant set, sequenced as
**design → implementation → interactive verification → final audit**.

Project root is the directory containing this `.agents/` folder. Frontend code
lives in `apps/web`. Read `apps/web/AGENTS.md` for project conventions (i18n
ownership, RTL, fonts, components, the design system tokens, and the approved
skill list) before writing code.

## Phase → required skill / tool

| Phase | Required skill / tool | Load reference |
| --- | --- | --- |
| Product / UI direction or styling | `anthropics/skills@9d2f1ae` → `frontend-design` | `references/product-visual-brief.md` |
| Next.js routing, layouts, RSC, fonts, data patterns | `vercel/next.js@00598045` bundled docs + workflow skills (via `npx skills add vercel/next.js`) | `node_modules/next/dist/docs/` / vendored `.next-docs/` |
| React components, state, composition, performance | `vercel-labs/agent-skills@f8a72b9` → `react-best-practices` | upstream skill |
| Version-specific library / API uncertainty | Context7 MCP (documentation lookup) | `references/approved-tools.md` |
| Interactive journeys, responsive behavior, EN/AR + RTL | Playwright MCP (frontend implementation/review) | `references/approved-tools.md` |
| Console / network / runtime + performance diagnosis | Chrome DevTools MCP (on demand, isolated profile) | `references/approved-tools.md` |
| Final accessibility / usability review | `vercel-labs/agent-skills@f8a72b9` → `web-design-guidelines` | upstream skill |
| Repeatable regression protection | committed Playwright (`apps/web/e2e`) + Vitest (`apps/web/src/**/__tests__`) tests — **not MCP output** | `references/frontend-definition-of-done.md` |

`frontend-design` is **required** whenever the task designs or styles UI — it is
the gate that prevents the output from becoming another generic navy/teal SaaS
dashboard. It is paired with `references/product-visual-brief.md`, which
constrains the brief to MarketMind's voice.

## Routing examples (prove the router selects the intended workflow)

1. **Design** — "Redesign the Discovery intake page for Egyptian SME owners."
   → load `frontend-design` + `references/product-visual-brief.md`; do **not**
   load Next.js docs, Playwright, or DevTools MCP.
2. **Implementation** — "Build the AppShell sidebar and wire next-intl locale
   switching." → load `react-best-practices` + Next.js bundled docs (app
   router, proxy, next-intl routing); do **not** load `frontend-design` or
   `web-design-guidelines` yet.
3. **Documentation lookup** — "What's the correct Next.js 16 way to redirect
   in `proxy.ts` while preserving locale detection?" → Context7 MCP only.
4. **Browser test** — "Verify language switching preserves `/discovery` in both
   directions." → Playwright MCP against the dev server; the authoritative
   regression lives in `apps/web/e2e/locale-*.spec.ts`.
5. **Runtime debugging** — "Why are shadcn `<Card>` styles missing in
   production?" → Chrome DevTools MCP (isolated profile) to inspect computed
   styles / missing CSS variables; root cause is a missing Tailwind theme
   token in `apps/web/src/app/globals.css`.
6. **Final review** — "Review the PR for accessibility and UX." →
   `web-design-guidelines` + `references/frontend-definition-of-done.md` as the
   checklist; committed Vitest/Playwright tests must be green.

## How to use this skill

1. Classify the current task into one (occasionally two adjacent) phases above.
2. Load **only** the named skill / MCP / reference for that phase.
3. Follow `references/frontend-definition-of-done.md` before declaring done.
4. Record any new MCP usage / capability in
   `references/approved-tools.md` so the inventory stays auditable.

Do NOT use this skill for non-frontend work (NestJS API, FastAI service,
contracts, infra). For those, defer to the root `AGENTS.md` and any
directory-local `AGENTS.md`.
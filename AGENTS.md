# PROJECT KNOWLEDGE BASE

**Updated:** 2026-08-21
**Default branch:** `main`

## OVERVIEW

MarketMind AI is an Arabic-first, bilingual marketing workspace for Egyptian
SMEs. This monorepo contains a production-shaped Next.js web app, NestJS API,
FastAPI AI service, shared TypeScript/Python contracts, reviewed Qdrant RAG
knowledge, Docker/Caddy deployment, and deterministic publishing automation.

The owner journey is Discovery → Strategy → Content → Publish/export →
Performance → Optimization. AI proposes and explains; the owner approves;
deterministic services persist and execute.

## STRUCTURE

```text
marketmind-ai/
├── apps/api/              # NestJS API, Prisma schema/migrations, jobs, adapters
├── apps/web/              # Next.js 16 bilingual/RTL owner experience
├── services/ai/           # FastAPI AI, RAG, validation, providers, orchestration
├── packages/contracts/    # Shared TypeScript/Python contracts and fixtures
├── Docs/                  # Maintained docs, RAG corpus, runbooks, dated evidence
├── infra/                 # Docker Compose, Caddy, and n8n workflow assets
├── scripts/               # Repository checks, setup, rehearsal, and readiness
└── .github/               # CI workflows and repository presentation assets
```

## WHERE TO LOOK

| Task                          | Location                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| Public overview and setup     | `README.md`                                                                 |
| Documentation index           | `Docs/README.md`                                                            |
| Current system architecture   | `Docs/technical-and-ai-docs/01_TECHNICAL_ARCHITECTURE_AND_SYSTEM_DESIGN.md` |
| API, database, and deployment | `Docs/technical-and-ai-docs/02_API_DATABASE_AND_DEPLOYMENT_GUIDE.md`        |
| AI, RAG, and agentic design   | `Docs/technical-and-ai-docs/03_AI_RAG_AGENTIC_TECHNICAL_DOCUMENT.md`        |
| Database authority            | `apps/api/prisma/schema.prisma`                                             |
| Cross-service contracts       | `packages/contracts/src/` and `packages/contracts/python/`                  |
| Reviewed Strategy knowledge   | `Docs/marketing-knowledge/`                                                 |
| Product journey               | `Docs/planning/02_MARKETMIND_AI_FLOW.md`                                    |
| Provider/live readiness       | feature runbooks plus `.env.example` files                                  |

## CODE MAP

| Area                   | Responsibility                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/modules` | Auth, RBAC, Discovery, Strategy, Content, billing, publishing, performance, admin, mail, and orchestration boundaries          |
| `apps/web/src`         | Locale routing, owner workspace, journey screens, approval UX, and provider connections                                        |
| `services/ai/app`      | Discovery, search, RAG, deterministic decisions, Strategy, Content, Optimization, providers, and gated LangGraph orchestration |
| `packages/contracts`   | Versioned schemas, lifecycle rules, validators, examples, and Python parity                                                    |
| `infra/docker`         | Local and hosted service composition                                                                                           |
| `infra/n8n`            | Version-controlled deterministic publishing workflow                                                                           |

## COMMANDS

```bash
npm run dev:full       # local full stack with migrations and reviewed knowledge
npm run dev            # restart against an already prepared local database
npm run check          # contracts, API, AI, web, and knowledge validation
npm run demo:rehearse  # deterministic demo-readiness rehearsal
```

Use `uv` from `services/ai` for Python checks. The full API e2e suite requires a
safe test database; provider network tests remain opt-in.

## CONVENTIONS

- Use two-space indentation, LF endings, UTF-8, and final newlines.
- PostgreSQL is the durable source of truth. Qdrant is a rebuildable knowledge
  index; Redis/BullMQ is recoverable execution infrastructure.
- Keep `Docs/marketing-knowledge/` path-stable because runtime ingestion and CI
  consume it directly.
- Keep AI responsibilities narrow and structured. Deterministic validation and
  lifecycle rules remain authoritative.
- Strategy, Content, Optimization, billing, and publishing decisions must be
  scoped to the authenticated business owner.
- Content approval and real-publication approval are separate immutable
  decisions.
- Mark mock, fixture, exported, simulated, failed, and live-provider outcomes
  truthfully.
- Do not commit credentials, tokens, private browser state, generated exports,
  or personal scratch documents.

## ANTI-PATTERNS

- Do not invent business facts, offers, citations, metrics, provider success,
  or source quality.
- Do not treat an HTTP 200, mock result, or CI fixture as live-provider proof.
- Do not let an LLM publish, charge, approve itself, or bypass deterministic
  policy checks.
- Do not put private Business Profiles in the shared Qdrant collection.
- Do not create a second lifecycle beside the existing Strategy, Content,
  publishing, billing, or performance state machines.
- Do not silently install unreviewed agent skills or commit local agent setup.

## DESIGN SYSTEM

- **Responsive app shell:** sidebar nav on desktop, bottom nav on mobile;
  max-width 1200px content area centred in the viewport.
- **Component selection:** under `apps/web`, follow the local shadcn-first
  policy: semantic HTML, existing local primitive, the smallest missing
  official shadcn primitive, then a custom component only for justified
  MarketMind product semantics. Do not bulk-import registries or default every
  page section to a card.
- **Approved colour palette:**

  | Token       | Hex       | Usage                                 |
  | ----------- | --------- | ------------------------------------- |
  | `--bg`      | `#F7F8FA` | Page background                       |
  | `--surface` | `#FFFFFF` | Cards, modals, sheets                 |
  | `--navy`    | `#102A43` | Headings, primary text                |
  | `--primary` | `#0B6F71` | Buttons, links, active states         |
  | `--action`  | `#246BFD` | Call-to-action, interactive elements  |
  | `--warning` | `#A15C00` | Warning banners, caution icons        |
  | `--danger`  | `#B42318` | Error states, destructive buttons     |
  | `--border`  | `#D9E2EC` | Dividers, input borders, card strokes |

## APPROVED AI CODING SKILLS

AI-generated frontend code must follow the approved skill set below. All
sources are pinned to a reviewed commit; see
`.agents/skills/marketmind-frontend-workflow/references/approved-tools.md` for
the full install configuration, capabilities, and MCP policy.

| Skill                                                   | Official source                                         | Pinned commit                                        | Status                      | When                                                   |
| ------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| Next.js best practices (bundled docs + workflow skills) | `vercel/next.js` canary `skills/`                       | `vercel/next.js@00598045` plus vendored Next.js docs | Required                    | Pages, layouts, RSC, fonts, data, and routing          |
| `vercel-react-best-practices`                           | `vercel-labs/agent-skills/skills/react-best-practices`  | `f8a72b9`                                            | Required                    | Components, hooks, state, composition, and performance |
| `web-design-guidelines`                                 | `vercel-labs/agent-skills/skills/web-design-guidelines` | `f8a72b9`                                            | Required final review       | Accessibility and UX audit                             |
| `frontend-design`                                       | `anthropics/skills/skills/frontend-design`              | `9d2f1ae`                                            | Required for design/styling | Visual direction                                       |

Every AI-generated frontend PR must pass `npm run check` and receive human
review for consistency with these skills and the MarketMind visual brief.

## DESIGN & VOICE BRIEF

> MarketMind is a trustworthy, practical, Arabic-first growth workspace for
> Egyptian SMEs across different industries. AI should feel helpful,
> explainable, and grounded in business evidence — not futuristic or
> mysterious.

The design system must remain suitable for retail, services, hospitality,
education, healthcare, and other SMEs. Avoid generic AI conventions such as
purple gradients, glassmorphism, excessive floating cards, robot imagery, or
sci-fi styling. Examples may use one industry, but the system is
industry-neutral. Distinctiveness comes from guided journeys, bilingual
typography, visible readiness, evidence, and owner control.

## PROJECT-LOCAL ROUTING SKILL

`.agents/skills/marketmind-frontend-workflow/` routes work under `apps/web` to
the smallest relevant approved skill or browser tool. Sequence design →
implementation → interactive verification → final audit.

Before frontend work, run `npm run agent:setup -- --agent <agent>` once, then
use `npm run agent:doctor` to verify reviewed skill revisions. MCP registration
is local to each developer and must never commit credentials or personal
browser profiles.

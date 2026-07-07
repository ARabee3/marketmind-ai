# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-24
**Commit:** 537b505
**Branch:** main

## OVERVIEW

MarketMind AI is a graduation-project monorepo for an AI-assisted marketing
platform for Egyptian small and medium businesses (SMEs) across industries.
The repo is currently planning docs plus an npm workspace skeleton; the
frontend scaffold lives under `apps/web`.

## STRUCTURE

```text
marketmind-ai/
+-- Docs/                  # planning pack and sprint guidance
+-- apps/api/              # future NestJS backend API
+-- apps/web/              # future Next.js frontend
+-- services/ai/           # future FastAPI AI service
+-- packages/contracts/    # future shared schemas/contracts
+-- infra/                 # future infrastructure/deployment notes
+-- package.json           # npm workspace root
+-- README.md              # current repo status
```

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Understand MVP scope | `Docs/planning/00_START_HERE.md` | Includes included/deferred lists. |
| Understand product flow | `Docs/planning/02_MARKETMIND_AI_FLOW.md` | Owner approval gates and data movement. |
| Understand AI roles | `Docs/planning/03_AGENTS_OVERVIEW.md` | Five AI roles plus deterministic publishing service. |
| First implementation order | `Docs/planning/04_FIRST_IMPLEMENTATION_ROADMAP.md` | Start with Discovery AI and NestJS Auth/RBAC. |
| Sprint 1 slice | `Docs/planning/sprint-1/07_SPRINT_1_VERTICAL_SLICE.md` | Concrete owners, modules, endpoints, acceptance. |
| Sprint 1 architecture | `Docs/planning/sprint-1/prepared-discovery-architecture/README.md` | Prepared Discovery architecture pack. |
| Project structure | `Docs/planning/PROJECT_STRUCTURE_AND_REUSABLE_COMPONENTS.md` | Target monorepo folders and reusable boundaries. |
| Team process | `Docs/planning/05_TEAM_OPERATING_SYSTEM.md` | Issue readiness, review, DoD. |
| Stack notes | `Docs/techstack.md` | NestJS/TypeScript, Next.js, FastAPI, PostgreSQL, Qdrant. |

## CODE MAP

No product source exists yet. Current workspaces are placeholders:

| Area | Current state | Intended role |
| --- | --- | --- |
| `apps/api` | README only | NestJS API: auth, RBAC, health, app endpoints. |
| `apps/web` | README only | Next.js frontend. |
| `services/ai` | README only | FastAPI AI service and provider adapters. |
| `packages/contracts` | README only | Shared schemas between frontend, API, and AI service. |
| `infra` | README only | Deployment/infrastructure notes later. |

## COMMANDS

```bash
npm run check
```

`npm run check` currently prints `No implementation yet`.

## CONVENTIONS

- Use two-space indentation, LF endings, UTF-8, and final newlines from
  `.editorconfig`.
- Treat `Docs/planning/` as the current source of product truth until real code
  and ADRs exist.
- Keep implementation aligned to one complete MVP journey before broadening the
  platform.
- For Sprint 1 backend, create `AuthModule`, `UsersModule`, `RbacModule`,
  `HealthModule`, and the Prepared Discovery module described in the sprint
  architecture pack; keep `GET /api/v1/health` simple.
- AI agents must have focused responsibilities. Discovery must not research
  competitors, create strategy, generate content, or move forward without owner
  confirmation.
- Publishing is not an LLM agent. Real publishing requires explicit owner
  approval; demo/simulated data must be clearly labeled.
- Human task owners must understand, test, and explain AI-assisted work.

## ANTI-PATTERNS

- Do not create `AuditModule` in Sprint 1.
- Do not start with Terraform, complex infrastructure, perfect UI animation,
  paid ads automation, full video generation, or many social platforms.
- Do not invent missing business facts, offers, analytics, citations, or source
  quality.
- Do not hide failed integrations or present simulation data as real.
- Do not submit generated code nobody on the team can explain.

## NOTES

- LSP/code symbol mapping is intentionally empty because there is no source code
  yet and no language servers are installed locally.
- Add narrower `AGENTS.md` files only after a directory has real implementation
  conventions that differ from this root file.

## DESIGN SYSTEM

- **Responsive app shell:** sidebar nav on desktop, bottom nav on mobile; max-width
  1200px content area centred in the viewport.
- **Approved colour palette:**

  | Token | Hex | Usage |
  | --- | --- | --- |
  | `--bg` | `#F7F8FA` | Page background |
  | `--surface` | `#FFFFFF` | Cards, modals, sheets |
  | `--navy` | `#102A43` | Headings, primary text |
  | `--primary` | `#0B6F71` | Buttons, links, active states |
  | `--action` | `#246BFD` | Call-to-action, interactive elements |
  | `--warning` | `#A15C00` | Warning banners, caution icons |
  | `--danger` | `#B42318` | Error states, destructive buttons |
  | `--border` | `#D9E2EC` | Dividers, input borders, card strokes |

## APPROVED AI CODING SKILLS

AI-generated frontend code must follow the approved skill set below. All
sources are pinned to a reviewed commit; see
`.agents/skills/marketmind-frontend-workflow/references/approved-tools.md`
for the full install configuration, capabilities, and the MCP policy.

| Skill | Official source | Pinned commit | Status | When |
| --- | --- | --- | --- | --- |
| Next.js best practices (bundled docs + workflow skills) | `vercel/next.js` canary `skills/` (skills migrated here from `vercel-labs/next-skills`) | `vercel/next.js@00598045` (canary) + `npx @next/codemod@canary agents-md` to vendor `next/dist/docs` | Required | Pages, layouts, RSC, fonts, data patterns, routing (Next.js 16 proxy, app router) |
| `vercel-react-best-practices` | `vercel-labs/agent-skills/skills/react-best-practices` | repo commit `f8a72b9` | Required | Components, hooks, state, composition, performance |
| `web-design-guidelines` | `vercel-labs/agent-skills/skills/web-design-guidelines` | repo commit `f8a72b9` | Required (final review) | Final accessibility / UX review pass |
| `frontend-design` | `anthropics/skills/skills/frontend-design` | repo commit `9d2f1ae` | **Required** (not optional) when designing or styling UI — establishes visual direction |

Every AI-generated frontend PR must pass `npm run check` and be reviewed by a
human for consistency with these skills and the MarketMind visual brief below.

## DESIGN & VOICE BRIEF

> MarketMind is a trustworthy, practical, Arabic-first growth workspace for
> Egyptian SMEs across different industries. AI should feel helpful,
> explainable, and grounded in business evidence — not futuristic or
> mysterious.

The design system must remain suitable for retail, services, hospitality,
education, healthcare, and other SMEs. **Anti-patterns** (do not use):

- generic AI conventions: purple gradients, glassmorphism, excessive floating
  cards, sparkle / robot imagery, sci-fi styling;
- industry-specific decoration (e.g. café-only iconography) — examples may use
  a café but the system is industry-neutral;
- hiding failed integrations or presenting simulation data as real.

**Distinctiveness comes from** guided business journeys, bilingual
typography, visible readiness / progress, evidence, and clear owner control.

## PROJECT-LOCAL ROUTING SKILL

`.agents/skills/marketmind-frontend-workflow/` is the project-local skill
that routes design, implementation, testing, debugging, and review work
under `apps/web` to the smallest relevant approved skill / MCP. Do not apply
every skill or MCP to every task; sequence design → implementation →
interactive verification → final audit.

Before frontend work, run `npm run agent:setup -- --agent <agent>` once, then
use `npm run agent:doctor` to verify the reviewed skill revisions. Agents must
not discover or silently install alternatives. MCP registration is local to
each developer's agent and must never commit credentials or personal browser
profiles.

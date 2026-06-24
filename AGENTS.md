# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-24
**Commit:** 537b505
**Branch:** main

## OVERVIEW

MarketMind AI is a graduation-project monorepo for an AI-assisted marketing
platform for Egyptian cafes and restaurants. The repo is currently planning
docs plus an empty npm workspace skeleton; implementation has not started.

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

# Approved Tools & MCP Policy

Every skill / MCP listed here is the only tool an AI agent should invoke for
frontend work under `apps/web`. Each entry records the official source, the
reviewed commit/version it is pinned to, its purpose and trigger, its
required vs on-demand status, and the permissions / capabilities it may use.

## Skills

### 1. Next.js best practices (bundled docs + workflow skills)

- **Official source:** `vercel/next.js` repository, `skills/` directory on the
  `canary` branch. (The older `vercel-labs/next-skills` repo is emptied; its
  skills migrated into the Next.js repo to stay version-matched. See
  https://github.com/vercel-labs/next-skills.)
- **Pinned version:** `vercel/next.js@00598045` (canary HEAD at review time).
- **Install (workflow skills):** `npx skills add vercel/next.js`
  (add a specific skill with `--skill <name>`; see the repo's `skills/`
  directory for the current list — e.g. `next-cache-components-optimizer`,
  `next-cache-components-adoption`).
- **Reference knowledge (best practices):** no longer a skill — delivered via
  bundled docs in `node_modules/next/dist/docs/` and the agent rules block at
  the top of `apps/web/AGENTS.md`. On Next.js < 16.3, vendor the docs with
  `npx @next/codemod@canary agents-md` into `.next-docs/` and point
  `apps/web/AGENTS.md` at them.
- **Purpose:** correctness for Next.js 16 app router, `proxy.ts`,
  RSC, `next/font`, data patterns, caching.
- **Trigger:** any task touching Next.js routing, layouts, server/client
  components, fonts, or data fetching.
- **Status:** Required.
- **Capabilities:** read project files; write under `apps/web/`; run
  `npm run build` / `npm run dev` to validate.

### 2. react-best-practices

- **Official source:** `vercel-labs/agent-skills` repository,
  `skills/react-best-practices`. https://github.com/vercel-labs/agent-skills
- **Pinned commit:** `f8a72b9` (repo HEAD at review time).
- **Install:** `npx skills add vercel-labs/agent-skills --skill react-best-practices`.
- **Purpose:** React + Next.js performance, composition, hooks correctness.
- **Trigger:** writing or reviewing React components, state, effects, data
  fetching, bundle size.
- **Status:** Required.
- **Capabilities:** read/write under `apps/web/src`; run Vitest.

### 3. web-design-guidelines

- **Official source:** `vercel-labs/agent-skills`, `skills/web-design-guidelines`.
- **Pinned commit:** `f8a72b9`.
- **Install:** `npx skills add vercel-labs/agent-skills --skill web-design-guidelines`.
- **Purpose:** final accessibility + UX review (100+ rules: aria, focus,
  forms, animation, typography, images, locale/i18n, dark mode, touch).
- **Trigger:** final review pass before a frontend PR is marked done.
- **Status:** Required (review gate).
- **Capabilities:** read project files; static analysis only (no MCP browser
  session).

### 4. frontend-design

- **Official source:** `anthropics/skills`, `skills/frontend-design`.
  https://github.com/anthropics/skills
- **Pinned commit:** `9d2f1ae` (repo HEAD at review time); `SKILL.md` blob
  SHA `decdff43`.
- **Install:** `npx skills add anthropics/skills --skill frontend-design`
  (or register the marketplace: `/plugin marketplace add anthropics/skills`).
- **Purpose:** distinctive, intentional visual direction; resists templated
  default aesthetics. **Required** when designing or styling UI — not
  optional.
- **Trigger:** any task that establishes or changes visual direction,
  palette, typography pairing, layout signature, or hero/landing treatment.
- **Status:** Required for design/styling; not invoked for pure
  logic/behavior changes.
- **Capabilities:** read/write under `apps/web/src/app` and component files;
  may take screenshots when supported.

## MCPs

### Context7 MCP

- **Purpose:** documentation lookup for version-specific library APIs.
- **Status:** available by default.
- **Trigger:** any uncertainty about a current-version API.
- **Capabilities:** read-only documentation fetch. No file writes.

### Playwright MCP

- **Purpose:** drive the dev server browser for interactive journeys,
  responsive checks, EN/AR + RTL behavior, and ad-hoc verification during
  implementation/review.
- **Status:** available for frontend implementation/review.
- **Trigger:** interactive behavior that needs visual/sequence confirmation.
- **Capabilities:** launch browser, navigate, click, assert DOM, capture
  traces. **Repository Playwright tests under `apps/web/e2e/` remain the
  authoritative regression protection** — MCP output is exploratory, not a
  committed test.

### Chrome DevTools MCP

- **Purpose:** console, network, runtime, and performance diagnosis.
- **Status:** on demand only.
- **Trigger:** debugging a real rendering / network / runtime issue that
  needs live inspection.
- **Capabilities:** connect to an **isolated browser profile**, never a
  developer's personal Chrome session. Read console, network, performance
  traces. No commits.

## Policy

- **Smallest set rule:** for any task, load only the skill(s)/MCP(s) whose
  phase matches. Do not blanket-apply every tool.
- **Sequence:** design → implementation → interactive verification → final
  audit.
- **Authoritative tests:** committed Vitest (`apps/web/src/**/__tests__`) and
  Playwright (`apps/web/e2e`) tests are the source of truth for regression.
  MCP output never replaces them.
- **Auditability:** when a new tool, version pin, or capability is approved,
  update this file so the inventory stays auditable.
- **Pinning:** never reference a skill by a moving tag alone; record the
  reviewed commit SHA here. Re-review and re-pin before bumping.
---
name: marketmind-frontend-workflow
description: Routes frontend design, implementation, testing, debugging, and review work under apps/web for the MarketMind AI monorepo. Use when a task touches apps/web, including UI direction, styling, React or Next.js implementation, version-specific documentation, browser verification, runtime debugging, accessibility, or UX review.
---

# MarketMind Frontend Workflow

MarketMind AI is a trustworthy, practical, Arabic-first growth workspace for Egyptian SMEs across industries. AI should feel helpful, explainable, and grounded in business evidence, not futuristic or mysterious.

This skill is a router. Identify the task phase and load only the relevant approved skill, reference, or MCP. Do not apply every tool to every task. Use the smallest relevant set, normally sequenced as design → implementation → interactive verification → final audit.

Read `apps/web/AGENTS.md` before writing frontend code. It defines i18n ownership, RTL behavior, fonts, component conventions, design tokens, and testing requirements.

## Phase routing

| Phase | Required skill or tool | Reference |
| --- | --- | --- |
| Product direction or UI styling | `frontend-design` | `references/product-visual-brief.md` |
| Next.js routing, layouts, RSC, fonts, and data patterns | Version-matched docs in `node_modules/next/dist/docs/01-app` | `apps/web/AGENTS.md` |
| React components, state, composition, or performance | `vercel-react-best-practices` | Installed upstream skill |
| Version-specific library or API uncertainty | Context7 MCP | `references/approved-tools.md` |
| Interactive journeys, responsive behavior, English/Arabic, or RTL | Playwright MCP | `references/approved-tools.md` |
| Console, network, runtime, or performance diagnosis | Chrome DevTools MCP with an isolated profile | `references/approved-tools.md` |
| Final accessibility and usability review | `web-design-guidelines` | `references/frontend-definition-of-done.md` |
| Repeatable regression protection | Committed Vitest and Playwright tests | `references/frontend-definition-of-done.md` |

`frontend-design` is required whenever a task designs or styles UI. Pair it with `references/product-visual-brief.md` so the output follows MarketMind's product voice instead of becoming a generic SaaS dashboard.

## Routing examples

1. “Redesign the Discovery intake page for Egyptian SME owners.” Use `frontend-design` and the product visual brief.
2. “Build the AppShell and locale switcher.” Use `vercel-react-best-practices` and the bundled Next.js docs.
3. “Confirm the correct Next.js or next-intl API.” Use Context7 for the uncertain API only.
4. “Verify locale switching preserves the Discovery session.” Use Playwright MCP, then commit the regression as a Playwright test.
5. “Diagnose missing production styles.” Use Chrome DevTools MCP with isolation enabled.
6. “Review the PR for accessibility and UX.” Use `web-design-guidelines` and the frontend definition of done.

## Workflow

1. If approved skills have not been installed for this checkout, stop and show `npm run agent:setup -- --agent <agent>`. Never discover or silently install a substitute.
2. Run `npm run agent:doctor -- --available-mcp context7` and include any other approved MCP names the agent exposes.
3. Classify the task into one phase, or occasionally two adjacent phases.
4. Load only the named skill, MCP, and reference for that phase.
5. Convert exploratory MCP findings into committed code or tests; MCP output is not regression coverage.
6. Follow `references/frontend-definition-of-done.md` before declaring the work complete.
7. Propose changes to `references/approved-tools.md` for review when a genuinely new capability is needed. Do not edit the approved inventory merely because an agent discovered a tool.

Do not use this skill for NestJS API, FastAPI AI service, contracts, or infrastructure work. Follow the root `AGENTS.md` and any directory-local instructions for those areas.

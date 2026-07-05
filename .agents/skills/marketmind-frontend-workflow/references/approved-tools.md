# Approved Tools and MCP Policy

`scripts/agent-tools/approved-tools.json` is the machine-readable source of truth for approved versions. This file explains when and why to use them.

## Setup and verification

Install reviewed skills once for the coding agent in use:

```bash
npm run agent:setup -- --agent codex
```

Supported agent identifiers are `codex`, `cursor`, and `claude-code`. The command uses `skills@1.5.14` and immutable GitHub tree URLs; do not replace them with moving repository names or tags.

Register the printed MCP configuration locally without committing credentials or personal browser configuration. Then run:

```bash
npm run agent:doctor -- --available-mcp context7
```

Add repeated `--available-mcp` flags for approved on-demand MCPs the current agent exposes. The doctor is read-only and verifies the exact reviewed `SKILL.md` Git blob hashes.

Agents must never discover or silently install substitute skills or MCPs. If a dependency is absent, stop and show the approved setup command.

## Skills

### Next.js guidance

- Source revision: `vercel/next.js@00598045032a0e5b313de7b6ef0af60ed9390c2a`.
- This project uses the version-matched documentation bundled with the installed Next.js package at `node_modules/next/dist/docs/01-app`.
- Do not install every specialized Next.js workflow skill. Use the bundled docs for routing, layouts, RSC, `proxy.ts`, fonts, caching, and data patterns.
- Required when the task touches Next.js-specific behavior.

### `vercel-react-best-practices`

- Source: `vercel-labs/agent-skills`, folder `skills/react-best-practices`.
- Pinned commit: `f8a72b9603728bb92a217a879b7e62e43ad76c81`.
- Reviewed `SKILL.md` blob: `237988de4a66dd8a71d30a2c24ebe1a86b58d04e`.
- Required for React components, hooks, state, composition, and performance.

### `web-design-guidelines`

- Source: `vercel-labs/agent-skills`, folder `skills/web-design-guidelines`.
- Pinned commit: `f8a72b9603728bb92a217a879b7e62e43ad76c81`.
- Reviewed `SKILL.md` blob: `ceae92ab319216a68274168fba9b63b998b65997`.
- Required for the final accessibility and usability review.

### `frontend-design`

- Source: `anthropics/skills`, folder `skills/frontend-design`.
- Pinned commit: `9d2f1ae187231d8199c64b5b762e1bdf2244733d`.
- Reviewed `SKILL.md` blob: `decdff43d05908b4c1fc2cfd2d80fc5743440934`.
- Required when designing or styling UI. Pair it with `product-visual-brief.md` to keep MarketMind distinctive and appropriate for SMEs across industries.

## MCPs

### Context7

- Default documentation lookup MCP.
- Remote transport: `https://mcp.context7.com/mcp`.
- Corresponding stdio package version, when needed: `@upstash/context7-mcp@3.2.2`.
- Read-only use for current library and API documentation when local version-matched docs do not answer the question.

### Playwright

- On demand: `npx --yes @playwright/mcp@0.0.77`.
- Use for exploratory browser journeys, responsive behavior, English/Arabic behavior, and RTL verification.
- Convert important findings into committed Playwright tests. MCP output is not regression coverage.

### Chrome DevTools

- On demand: `npx --yes chrome-devtools-mcp@1.5.0 --isolated`.
- Use only for console, network, runtime, or performance diagnosis that needs live inspection.
- Always use an isolated browser profile; never attach to a developer's personal profile.

## Policy

- Load the smallest set whose phase matches the task.
- Normally sequence design → implementation → interactive verification → final audit.
- Committed Vitest and Playwright tests remain authoritative.
- Keep secrets and developer-local MCP configuration out of the repository.
- Review and update both this file and `approved-tools.json` before changing a version or adding a capability.

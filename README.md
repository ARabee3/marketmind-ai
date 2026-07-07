# MarketMind AI

MarketMind AI is the graduation project monorepo for an AI-assisted marketing platform for Egyptian small and medium businesses (SMEs) across industries.

The repository currently includes:

- planning and requirement documents under `Docs/`
- a NestJS API and Prepared Discovery implementation under `apps/api`
- a FastAPI AI service under `services/ai`
- shared contracts under `packages/contracts`
- a bilingual Next.js frontend foundation under `apps/web`

The current planning pack lives in:

```text
Docs/planning/
```

## Frontend agent tooling

Install only the reviewed project skills for the coding agent you use:

```bash
npm run agent:setup -- --agent codex
```

The setup command prints the pinned MCP registrations. Configure those in your
local agent without committing credentials, then verify the toolchain:

```bash
npm run agent:doctor -- --available-mcp context7
```

The project-local `marketmind-frontend-workflow` skill selects the smallest
relevant skill/MCP set for each frontend task. It never discovers or silently
installs unapproved alternatives.

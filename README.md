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

## Prerequisites

Install these tools before running the project. The versions below are what
the repo is tested against; newer compatible versions should also work.

| Tool | Min version | Why |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | v20+ (npm included) | API (`apps/api`), web (`apps/web`), shared contracts. |
| [Docker](https://docs.docker.com/get-docker/) + Docker Compose | recent | Runs PostgreSQL and Redis as local dev containers. PostgreSQL and Redis themselves do **not** need a standalone install. |
| [uv](https://docs.astral.sh/uv/) | any recent | Python package manager for the FastAPI AI service (`services/ai`). Requires Python 3.12+ (uv fetches it for you). |

Verify your setup:

```bash
node --version
docker --version
uv --version
```

Install npm dependencies after cloning:

```bash
npm install
```

The AI service dependencies are managed by `uv` and are installed
automatically the first time you run the AI service (or `npm run check:ai`).

## Run Project

The repo ships two one-command dev runners that bring up the full stack
(docker services + API + AI service + web) in a single terminal.

| Command | Migrations? | Use when |
| --- | --- | --- |
| `npm run dev` | No | Everyday restarts when the database schema already exists. |
| `npm run dev:full` | Yes (`prisma migrate deploy`) | Fresh checkout, after pulling new migrations, or after resetting the database. |

Both commands:

1. Start PostgreSQL and Redis via Docker (`docker:up`) and wait for their
   ports to be ready before launching any app (`wait-on`).
2. Launch the three apps in parallel with labeled, colored output
   (`concurrently`):
   - **api** (green): NestJS API on http://localhost:3001/api/v1
   - **ai** (magenta): FastAPI AI service on http://localhost:8000
   - **web** (blue): Next.js dev server on http://localhost:3000
3. Kill all three app processes cleanly with `Ctrl+C`.

`npm run dev:full` additionally runs `prisma migrate deploy` after docker is
ready and before the apps start, so the database schema is always in sync. It
is safe to run repeatedly — Prisma skips already-applied migrations.

```bash
# First time / after pulling new migrations:
npm run dev:full

# Everyday restarts (schema already in place):
npm run dev
```

Then open http://localhost:3000 in your browser.

### Manual control (optional)

If you only need the backing services without the apps:

```bash
npm run docker:up      # start postgres + redis and wait for ports
npm run prisma:deploy  # apply pending migrations
```

Stop the backing services:

```bash
docker compose -f infra/docker/docker-compose.local.yml down
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

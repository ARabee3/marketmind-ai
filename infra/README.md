# MarketMind infrastructure

Version-controlled local and hosted-demo infrastructure for PostgreSQL, Redis,
Qdrant, n8n, the three application services, and Caddy.

## Local development

Copy the n8n/local infrastructure environment once:

```bash
cp infra/docker/.env.example infra/docker/.env
```

Start PostgreSQL, Redis, and n8n:

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
```

Add Qdrant for Strategy RAG:

```bash
docker compose \
  -f infra/docker/docker-compose.local.yml \
  -f infra/docker/docker-compose.qdrant.yml up -d
```

| Service       | Local endpoint                                            |
| ------------- | --------------------------------------------------------- |
| PostgreSQL 16 | `localhost:5433`                                          |
| Redis 7       | `localhost:6379`                                          |
| Qdrant        | `http://localhost:6333`                                   |
| n8n           | `http://localhost:5678` when host networking is available |

The root `npm run dev:full` command starts these dependencies, applies Prisma
migrations, synchronizes reviewed Strategy knowledge, and launches the web,
API, and AI processes.

Stop local services without deleting data:

```bash
docker compose \
  -f infra/docker/docker-compose.local.yml \
  -f infra/docker/docker-compose.qdrant.yml down
```

Adding `-v` deletes local database, queue, Qdrant, and n8n volumes. Use that
only for an intentional disposable reset.

## Hosted deployment

`infra/docker/docker-compose.prod.yml` defines PostgreSQL, Redis, Qdrant,
FastAPI, NestJS, Next.js, and Caddy. Caddy exposes one TLS origin and routes web,
API, internal callback, and Socket.IO traffic so host-scoped auth cookies remain
valid.

```bash
cp infra/docker/.env.prod.example infra/docker/.env.prod
docker compose --env-file infra/docker/.env.prod \
  -f infra/docker/docker-compose.prod.yml up -d --build
```

Service secrets remain in gitignored `apps/api/.env`, `services/ai/.env`, and
`infra/docker/.env.prod`. The repository must never contain live credentials.

## Publishing automation

The n8n workflow and bootstrap assets live under `infra/n8n/`. n8n is a
deterministic transport boundary: NestJS owns the candidate, approval, result,
and API-owned Meta execution. See [`n8n/README.md`](n8n/README.md) for workflow
import, signing, callback, and Docker Desktop networking details.

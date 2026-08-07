# Infrastructure

Local development infrastructure for MarketMind AI.

## Local Services

### PostgreSQL, Redis, and n8n

Start the required local services (databases + n8n publishing workflow
runner):

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
```

This starts three containers: `marketmind-postgres`, `marketmind-redis`, and
`marketmind-n8n`. n8n needs a one-time env file at `infra/docker/.env`
(copied from `infra/docker/.env.example`) plus a manual workflow import —
see [`n8n/README.md`](n8n/README.md) for the full setup and the
host-networking gotcha.

Stop:

```bash
docker compose -f infra/docker/docker-compose.local.yml down
```

Reset data (destructive):

```bash
docker compose -f infra/docker/docker-compose.local.yml down -v
```

### Connection Details

| Setting  | Value              |
|----------|--------------------|
| Host     | localhost          |
| Port     | 5432               |
| Database | marketmind_dev     |
| User     | marketmind         |
| Password | marketmind_dev     |

Connection URL:
```
postgresql://marketmind:marketmind_dev@localhost:5432/marketmind_dev?schema=public
```

### Qdrant (optional)

Qdrant is optional for Sprint 1 and required only when working on Sprint 4
RAG/vector retrieval.

Start Qdrant separately:

```bash
docker compose -f infra/docker/docker-compose.qdrant.yml up -d
```

Stop:

```bash
docker compose -f infra/docker/docker-compose.qdrant.yml down
```

Reset data (destructive):

```bash
docker compose -f infra/docker/docker-compose.qdrant.yml down -v
```

Connection details:

| Setting | Value              |
|---------|--------------------|
| Host    | localhost          |
| REST    | http://localhost:6333 |
| gRPC    | localhost:6334     |
| Storage | Named volume `marketmind_qdrant_storage` |

Health endpoint:

```bash
curl --fail --retry 10 --retry-connrefused --retry-delay 1 \
  http://localhost:6333/healthz
```

## Notes

- PostgreSQL and Redis are required by the current backend.
- Qdrant is optional and is used only for Sprint 4 RAG/vector retrieval.
- No Terraform or production cloud IaC in Sprint 1.

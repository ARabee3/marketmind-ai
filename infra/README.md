# Infrastructure

Local development infrastructure for MarketMind AI.

## Local Services

### PostgreSQL and Redis

Start the required local services:

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
```

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

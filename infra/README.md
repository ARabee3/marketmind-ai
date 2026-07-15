# Infrastructure

Local development infrastructure for MarketMind AI.

## Local Services

### PostgreSQL

Start the local PostgreSQL database:

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

### Qdrant

Qdrant is started alongside PostgreSQL and Redis by the same local compose file.

```bash
docker compose -f infra/docker/docker-compose.local.yml up -d
```

Connection details:

| Setting | Value              |
|---------|--------------------|
| Host    | localhost          |
| REST    | http://localhost:6333 |
| gRPC    | localhost:6334     |
| Storage | Named volume `marketmind_qdrant_storage` |

Health endpoint:
```
GET http://localhost:6333/healthz
```

## Notes

- Qdrant is enabled for Sprint 4 RAG/vector retrieval.
- No Terraform or production cloud IaC in Sprint 1.

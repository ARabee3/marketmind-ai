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

## Notes

- Sprint 1 uses PostgreSQL only. Qdrant is not required.
- No Terraform or production cloud IaC in Sprint 1.

# n8n — Publishing automation (local)

`infra/docker/docker-compose.local.yml` now starts **n8n** alongside
PostgreSQL and Redis, so the publishing automation stack comes up with a
single command. The version-controlled workflow lives in
[`workflows/publishing-v1.json`](workflows/publishing-v1.json), and the
canonical authenticated dispatch/callback fixtures live in
[`fixtures/`](fixtures/).

> The NestJS API runs **on the host** (`npm run start:dev`), not as a compose
> service. Only the databases and n8n run in Docker. Do not add the API to
> this compose file as part of this work.

## Start all local services

```bash
# 1. Create the docker env (one-time, gitignored) from the example
cp infra/docker/.env.example infra/docker/.env
#    then fill in the values (see "Required env" below) — they must match
#    apps/api/.env exactly.

# 2. Bring up postgres, redis, and n8n together
docker compose -f infra/docker/docker-compose.local.yml up -d

# 3. The container imports and publishes the checked-in workflow automatically.
```

Stop / reset:

```bash
docker compose -f infra/docker/docker-compose.local.yml down
docker compose -f infra/docker/docker-compose.local.yml down -v   # destructive: drops n8n + DB volumes
```

## Required env (`infra/docker/.env`)

Create `infra/docker/.env` (gitignored) from `infra/docker/.env.example`.
Every value must match the **same** var in `apps/api/.env` — the API signs
dispatch payloads and authenticates the webhook, and n8n verifies both.

| Variable | Why n8n needs it |
| --- | --- |
| `PUBLISHING_N8N_AUTH_TOKEN` | Bearer token the API sends to the webhook; the `Check Auth` node rejects anything else. |
| `PUBLISHING_N8N_SIGNING_SECRET` | HMAC key used to verify inbound dispatch envelopes and sign outbound callback envelopes. |
| `PUBLISHING_N8N_SIGNING_KID` | Key id for the signing secret (rotation seam). |
| `PUBLISHING_INTERNAL_SERVICE_TOKEN` | Sent as `x-publishing-internal-token` when the real-mode node calls the API-owned Meta provider executor (`POST /internal/v1/publishing/execute-meta`). |
| `PUBLISHING_CALLBACK_BASE_URL` | Base URL of the host-run API the executor node calls (issue #175). |

> Issue #175: n8n holds NO Meta credential of any kind. The old
> `META_TEST_PAGE_ID` / `META_TEST_PAGE_ACCESS_TOKEN` environment variables
> were removed from the real publishing path — the real-mode node forwards
> only opaque attempt/intent/target ids to the executor, which resolves the
> exact target's encrypted vault credential server-side.

> The three `PUBLISHING_N8N_*` values are the critical "must match exactly"
> set — any drift means webhook `401`s or signature mismatches before any
> asset fetch happens.

The compose service also pins three n8n runtime flags directly in
`docker-compose.local.yml`:

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` — the workflow reads `$env` in Code
  nodes (`Check Auth`, `Sign Callback`, `Verify Signature`, `Meta Provider
  Executor`); n8n blocks `$env` by default.
- `NODE_FUNCTION_ALLOW_BUILTIN=crypto,http,https` — the Code nodes
  `require()` these builtins (`crypto` for HMAC/sha256, `http`/`https` for
  the executor call + callback POST).
- `N8N_SECURE_COOKIE=false` — local (non-TLS) localhost use.

## Networking gotcha: API on host, n8n in Docker

This is the one thing most likely to bite. The API is **not** a compose
service — it runs on your host on `http://localhost:3001`. n8n runs in a
container and must reach that host API to (a) fetch dispatch asset bytes and
(b) POST the signed callback.

The n8n service uses `network_mode: host` so that, **from inside the n8n
container**, `http://localhost:3001/...` resolves to the host-run API, and
**from the host-run API**, `http://localhost:5678/...` reaches n8n. No
`host.docker.internal` / `extra_hosts` mapping is needed.

Why `network_mode: host` and not `host.docker.internal`? The **frozen**
publishing workflow's `isSafeUrl` validator only permits `https://*` or
`http://localhost|127.0.0.1` URLs in dispatch envelopes. Passing
`http://host.docker.internal:3001/...` as `callback_url` /
`retrieval_url` would be rejected with `unsafe callback_url` /
`invalid asset retrieval boundary` before n8n ever ran the asset fetch.
Host networking keeps `PUBLISHING_CALLBACK_BASE_URL=http://localhost:3001`
valid end-to-end without modifying the frozen workflow contract.

Consequently the n8n service intentionally has **no `ports:`** block — with
host networking it binds directly to the host's `5678`. Caveat:
`network_mode: host` is a **Linux** convention. On Docker Desktop
(macOS/Windows) host networking is best-effort and the `5678` port may not
bind the same way; treat the primary supported local setup as Linux.

The relevant API env (`apps/api/.env`) values are unchanged from the old
standalone-container setup:

```ini
PUBLISHING_N8N_WEBHOOK_URL=http://localhost:5678/webhook/publishing-dispatch
PUBLISHING_CALLBACK_BASE_URL=http://localhost:3001
```

- API → n8n: `http://localhost:5678/...` works because n8n is on the host
  network.
- n8n → API: `http://localhost:3001/...` (carried inside the dispatch
  envelope as `callback_url` / each asset's `retrieval_url`) works because
  host networking makes `localhost` the host.

## Workflow bootstrap

The n8n service mounts the version-controlled workflow read-only and runs
`bootstrap.sh` before n8n starts. The workflow carries the stable id
`4wO2sifqyuZMAht9`, so each container start updates that record and publishes
its current version without creating duplicates. If import or publication
fails, n8n does not start; a running-but-unregistered production webhook is
therefore no longer presented as a ready automation service.

You can still open <http://localhost:5678> to inspect executions or complete
the initial local n8n owner setup.

### Workflows directory layout

```
infra/n8n/
├── workflows/
│   └── publishing-v1.json   # the version-controlled workflow (import into n8n)
└── fixtures/                 # canonical dispatch/callback examples + invalid cases
```

The workflow is intentionally frozen (it is the `publishing-dispatch-v1`
contract boundary). Changes to its node logic require a contract change,
not an ad-hoc edit — see `Docs/planning/sprint-5/CONTENT_AGENT_AND_AUTOMATION_HANDOFF_ARCHITECTURE.md`.

## Verify end to end

With everything up (databases + n8n) and the workflow imported and Active:

```bash
# Run the API on the host with apps/api/.env values pointing at:
#   PUBLISHING_N8N_WEBHOOK_URL=http://localhost:5678/webhook/publishing-dispatch
#   PUBLISHING_CALLBACK_BASE_URL=http://localhost:3001
npm --workspace apps/api run start:dev

# Seed a real publish attempt
npm --workspace apps/api run seed:publishing-demo
```

Then in n8n → **Executions**, confirm the most recent
`publishing-dispatch` run shows the **Meta Provider Executor (server-side)**
node completing (it forwards the opaque identifiers to the API-owned
executor) and the `POST Callback to NestJS` node completing. The executor
step is the canary: if networking is wrong it fails first with a
connection-refused / unreachable-host error. A successful real run produces
a new Meta post id on a VAULT-CONNECTED owner page — real-mode targets come
only from the Meta OAuth journey (issue #175), never from an env token.

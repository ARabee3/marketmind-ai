# Discovery Module — Manual Testing Guide

This guide explains how to run and manually test the Prepared Discovery module
end-to-end using the local testing playground.

> **Audience:** team members who want to exercise the discovery flow locally,
> inspect what the AI returns, and observe how results change when prompts,
> providers, or inputs are modified.

---

## What you are testing

The Prepared Discovery journey:

1. **Owner intake** — business name, type, city, optional goals/competitors/links.
2. **Research (intelligence)** — NestJS gathers public metadata via search
   providers (SerpApi / Apify / DuckDuckGo) into source refs, research
   observations, and conversation hooks.
3. **AI interview** — the FastAI service drives a bounded Q&A conversation,
   updating known facts, uncertainties, and per-domain readiness scores.
4. **Summarize** — once ready (or forced via `finish_anyway`), the AI produces
   a `BusinessProfileDraft`.
5. **Confirm** — the owner confirms the draft, unlocking strategy.

The playground page drives all five steps over HTTP and shows live WebSocket
progress events.

---

## Prerequisites

Install once on your machine:

| Tool | Why | Install |
| --- | --- | --- |
| Docker | runs local PostgreSQL | <https://docs.docker.com/get-docker> |
| Node.js 20+ | runs NestJS API | <https://nodejs.org> |
| `uv` | runs the FastAI service | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |

You also need both `.env` files filled in:

- `apps/api/.env` — copy from `apps/api/.env.example`
  - required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
    `AI_SERVICE_BASE_URL`, and any search provider keys you want to test
    (`SERPAPI_KEY` and/or `APIFY_TOKEN`).
- `services/ai/.env` — copy from `services/ai/.env.example`
  - choose `AI_PROVIDER_MODE` (`mock`, `openai`, `gemini_dev`, or
    `openrouter`) and add the matching provider key. Use `mock` for a
    deterministic, key-free smoke test.

> If anyone on the team lacks search/LLM keys, set `AI_PROVIDER_MODE=mock`
> in `services/ai/.env`; the flow still runs end-to-end with canned responses.

---

## One-command startup

From the repo root:

```bash
./dev-up.sh
```

This starts, in order:

1. PostgreSQL via Docker (`infra/docker/docker-compose.local.yml`)
2. Prisma migrations + RBAC seed (`apps/api`)
3. FastAI service on `http://localhost:8000` (with `--reload`)
4. NestJS API on `http://localhost:3001/api/v1` (with `--watch`)
5. Opens `apps/web/discovery-playground.html` in your default browser

The script waits for each service's health endpoint before continuing. Logs
stream to `output/dev-up-ai.log` and `output/dev-up-api.log` (these are
gitignored runtime artifacts, not committed).

Useful flags:

- `./dev-up.sh --skip-migrate` — DB already current; just start AI + API.
- `./dev-up.sh --no-open` — do not auto-open the browser.

### What to do when a service fails to start

```bash
# Tail both logs
tail -f output/dev-up-ai.log output/dev-up-api.log

# Check what is listening
lsof -nP -iTCP:3001 -sTCP:LISTEN   # API
lsof -nP -iTCP:8000 -sTCP:LISTEN   # AI
docker ps                          # Postgres

# Stop everything and retry
./dev-down.sh && ./dev-up.sh
```

---

## Stopping everything

```bash
./dev-down.sh        # stop API + AI + Postgres (keep data)
./dev-down.sh -v     # also wipe the Postgres volume (destructive)
```

---

## Using the playground page

The playground is a single static HTML file at
`apps/web/discovery-playground.html`. No build step — just open it in a
browser. It talks directly to the API over HTTP and to the WebSocket gateway.

> The API has dev-only CORS enabled (`apps/api/src/main.ts`) so a `file://`
> page can call it. Do not deploy that change to production.

### Recommended test flow

1. **Auth**
   - In the **Auth** panel, enter an email + password (and a full name the
     first time), then click **Register** followed by **Login**.
   - New users default to the `OWNER` role, which holds every discovery
     permission. The badge turns blue and shows your email + roles.
   - Tokens are stored in `localStorage`; click **Logout** to clear them.

2. **Start a session**
   - In the **Start Discovery** panel, fill at least `business_name`,
     `business_type`, and `city`. Optional fields (`area`, goals,
     competitors, audience, notes) give the AI more context.
   - Add social links with **+ add link** (up to 8). These become
     `source_type: owner_link` entries in the intelligence result.
   - Pick a **language mode** (`mixed`, `ar-EG`, `en`) — this is passed to
     the AI and influences the assistant's message language.
   - Click **Start session**. The page stores the returned `session_id`,
     connects the WebSocket, begins polling status every 4s, and opens the
     chat.

3. **Watch the progress stream**
   - The top strip shows live `discovery.progress` events from the WebSocket
     (`/ws/v1/discovery`). Each line is `time · status · stage · message_key`
     plus the human-readable `message_text`.
   - Use this to see exactly when intelligence starts/finishes, when the AI
     turn runs, and when anything fails (`status: failed` is red).

4. **Inspect status & intelligence**
   - The **Status & intelligence** panel (left, middle) updates every poll:
     - session status badge and `strategy_locked` flag
     - the current question the AI is asking
     - source refs (type · platform · title)
     - research observations (kind, confidence, statement)
     - conversation hooks the AI may surface
   - Click **Refresh status** any time to force a poll.

5. **Chat with the assistant**
   - Type answers in the composer at the bottom-right and press **Enter**
     (Shift+Enter for a newline) or click **Send**. Each send calls
     `POST /discovery/:id/respond`.
   - The assistant's reply appears as a left-aligned bubble; your messages
     are right-aligned. The **Profile state & readiness** panel updates
     after every turn: domain scores, readiness flag, turn count, and any
     produced draft.

6. **Summarize**
   - When `ready_to_summarize` is `true` (or whenever you want to force it),
     click **Summarize now** (left panel) or **Summarize** (composer). The
     page will prompt for `finish_anyway` (true = produce a draft even if
     incomplete).
   - The returned `BusinessProfileDraft` is shown in the **Raw response**
     panel; its `id` is auto-filled into the confirm field.

7. **Confirm the profile**
   - Tick **acknowledge_incomplete** if the draft is incomplete, then click
     **Confirm profile**. This calls
     `POST /discovery/:id/confirm-profile`, sets the session to `confirmed`,
     and sets `strategy_locked: false` (unlocking the next stage).

8. **Inspect raw payloads**
   - The **Raw response** panel at the bottom-left shows the full JSON of
     the last response (start, status, respond, summarize, or confirm).
     Expand it to copy payloads for debugging or for filing issues.

---

## Comparing runs (what changes)

Because the whole point of manual testing here is to *monitor results and see
what changes*, keep these tips in mind:

- **Same intake, different prompts** — the AI prompts live in
  `services/ai/app/discovery/prompts.py` and `prompt_versions.py`. Edit them,
  save (uvicorn reloads), then start a new session with identical intake and
  diff the assistant messages and the profile draft in the raw panel.
- **Same intake, different providers** — switch `AI_PROVIDER_MODE` in
  `services/ai/.env` (`mock` vs `gemini_dev` vs `openrouter`) and re-run.
  The page makes it easy to start several sessions back-to-back; each gets a
  fresh `session_id`.
- **Same intake, different intake richness** — run once with only the three
  required fields, then again with goals + competitors + 3 social links, and
  compare the intelligence panel (source refs + observations) and the AI's
  first question.
- **Language modes** — run the same intake with `ar-EG`, `en`, and `mixed`
  and compare the assistant message `language` field and question phrasing.

> Tip: keep one browser tab on the playground and a terminal running
> `tail -f output/dev-up-ai.log` so you can correlate UI behaviour with the
> FastAI service logs (provider calls, prompt versions, safe failures).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `401 Unauthorized` on any call | not logged in, or access token expired (15m) | click **Login** again |
| `403 Forbidden` on start/respond | role lacks the permission | new users are `OWNER`; if not, re-seed via `./dev-up.sh` |
| Start returns 202 but chat never progresses | AI service down or timed out | check `output/dev-up-ai.log`; ensure `AI_SERVICE_BASE_URL` points to `http://localhost:8000` |
| WebSocket never connects (yellow dot) | wrong API base or token | confirm the **API** field in the header is `http://localhost:3001/api/v1` and you are logged in |
| `safe_failure` action in raw response | provider returned invalid output or errored | see the AI log; switch to `mock` mode to isolate |
| Postgres connection refused | Docker container not running | `docker ps`; restart with `./dev-up.sh` |
| Seed fails with `DATABASE_URL not found` | `.env` not loaded for the seed step | re-run `./dev-up.sh` (it sources `apps/api/.env` before seeding) |

---

## Files this branch adds

| Path | Purpose |
| --- | --- |
| `dev-up.sh` | one-command startup: Docker + migrate + seed + AI + API + open page |
| `dev-down.sh` | stop all services (use `-v` to wipe data) |
| `apps/web/discovery-playground.html` | self-contained manual testing page |
| `apps/api/src/main.ts` | dev-only `enableCors` so the page can call the API |
| `Docs/testing/README.md` | this guide |

Runtime logs and pids land in `output/` and are gitignored.

---

## Do not commit

- Real LLM / search provider keys (they live in `.env`, which is gitignored).
- The `output/dev-up-*.log` and `output/dev-up-*.pid` files.
- Changes to `apps/api/.env` or `services/ai/.env` (already gitignored).
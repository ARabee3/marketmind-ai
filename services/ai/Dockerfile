# MarketMind AI Service — production image (FastAPI + uv, runs uvicorn)
# Build context: repository root.

# Stage 1 — install locked deps and the project into a .venv.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
WORKDIR /app/services/ai
COPY services/ai/ ./
RUN uv sync --frozen --no-dev

# Stage 2 — runtime image with app source, shared Python contracts, and the
# knowledge corpus. The repo-root layout at /app is required so that
# `app/main.py` can insert `packages/contracts/python` into sys.path and the
# knowledge CLI can resolve `Docs/marketing-knowledge`.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV PATH="/app/services/ai/.venv/bin:$PATH"
WORKDIR /app
COPY --from=builder /app/services/ai/.venv ./services/ai/.venv
COPY services/ai/app ./services/ai/app
COPY packages/contracts/python ./packages/contracts/python
COPY Docs/marketing-knowledge ./Docs/marketing-knowledge
COPY package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
WORKDIR /app/services/ai
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
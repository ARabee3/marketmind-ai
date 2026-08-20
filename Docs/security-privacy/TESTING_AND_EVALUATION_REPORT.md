# Testing & Evaluation Report

**MarketMind AI — testing audit, evaluation methodology, and evidence**

- **Date:** 2026-08-20
- **Branch:** `docs/security-privacy-testing-roadmap` (verified against base commit `170d98a` plus the fixes in this PR)
- **Truthfulness statement:** no test result in this document is invented. The checks listed in §12 were executed locally in an isolated PR worktree on 2026-08-20 unless labelled `LIVE (CI)`, `NOT RUN`, or `NOT VERIFIED`. Local API e2e and the full web e2e matrix were not run because the former requires a disposable database and the latter was not needed beyond the targeted landing/legal smoke; hosted-production behavior remains unverified.

---

## 1. Testing Strategy

The repository uses layered automated testing per workspace:

| Layer | API (`apps/api`) | Web (`apps/web`) | AI (`services/ai`) |
| --- | --- | --- | --- |
| Unit | Jest, `src/**/*.spec.ts` | Vitest + Testing Library (jsdom) | pytest |
| Integration / DB | Jest `test/jest-db.json` vs real PostgreSQL | — | pytest `integration` marker (phase-0 durability vs real Postgres) |
| API e2e | Nest app booted vs real Postgres+Redis (`jest-e2e.json`) | — | provider fakes; `network` marker for real-provider opt-in |
| UI e2e | — | Playwright (chromium + mobile-chrome) vs mock session-server | — |
| Contracts | 13 TS/JS/Python validation scripts (`npm run check -w @marketmind/contracts`) incl. example JSON validation | shared | shared (pydantic mirrors) |
| Evaluation | — | — | pytest-marked eval suites (content guardrails; RAG) |

Strategy notes (from code/config): API e2e is self-sufficient on any runner (in-process env fallbacks); web e2e deliberately runs against a **mock API** (`e2e/support/session-server.mjs`), so web e2e does not exercise the real backend; the publishing e2e executes the real n8n workflow JavaScript over a loopback harness (`test/harness/fake-n8n-harness.ts`) — no live Meta calls.

## 2. Test Environment

- **CI (LIVE):** GitHub Actions, ubuntu-latest; Node 20; Python 3.12 via uv; Postgres 16 + Redis 7 service containers for API integration; Playwright chromium for web.
- **Local dev:** Docker Compose (Postgres :5433, Redis :6379, Qdrant :6333, n8n :5678). Note the CI-vs-local port mismatch (CI Postgres on 5432, local on 5433) — running the CI integration job verbatim locally requires a `DATABASE_URL` override.
- **This audit's environment:** backing Postgres/Redis/Qdrant/n8n containers were up. Checks ran in `/tmp/marketmind-pr258-fix.wUsCmR`; API e2e was intentionally not run against the shared development database.

## 3. Unit Tests (inventory — verified on disk)

| Suite | Files | Framework | Command |
| --- | --- | --- | --- |
| API unit | **168** `.spec.ts` under `apps/api/src` | Jest | `npm run test -w @marketmind/api` |
| Web unit | **90** `.test.{ts,tsx}` under `apps/web/src` | Vitest | `npm run test -w @marketmind/web` |
| AI tests | **98** `test_*.py` under `services/ai/tests` (incl. eval suites) | pytest | `npm run check:ai` (excl. network/integration) |

Local run status: **NOT RUN in this audit** (see truthfulness statement). CI status: executed on every PR/push to main (see §8).

## 4. Integration / DB Tests

- 12 `.db-spec.ts` files (content outbox/schedule/checksum, marketing-knowledge governance, optimization + performance migrations, publication outbox, publishing unique index/migration) — require a migrated live PostgreSQL; CI applies `prisma migrate deploy` first.
- 9 top-level `.e2e-spec.ts` + harness spec (auth+oauth, admin, rbac, discovery, content, strategy, health, callback routing, publishing-integration 89 KB suites A–I).
- AI: `tests/orchestration/test_phase0_durability.py` (integration marker) runs against a real Postgres service container in CI (LangGraph interrupt/resume durability).
- Local run status: **NOT RUN in this audit.**

## 5. E2E Tests (web)

- 22 Playwright spec files (`apps/web/e2e/`), 21 by default (`rehearsal/` excluded): auth, register/verify, forgot/reset password, oauth-callback, session, landing, locale, mobile-shell, not-found, dashboard, discovery-intake, discovery-interview, strategy, content-cycle, content-review, publishing, connections, meta-connection, billing, performance.
- Config: `workers: 1`, CI retries 2, two projects (chromium, mobile-chrome — chromium only installed in CI).
- **Known coverage boundary (honest):** e2e runs against the mock session-server, not the real API — real backend behavior is covered by API e2e instead; cross-layer UI→DB journeys are not covered end-to-end anywhere.
- Local run status: **NOT RUN in this audit.**

## 6. Manual QA

| Journey | Classification | Evidence |
| --- | --- | --- |
| Registration / login / logout / password reset / email verification | Automated (web e2e + API e2e) | `e2e/auth.spec.ts`, `forgot-password.spec.ts`, `reset-password.spec.ts`, `verify-email.spec.ts`, `test/auth-oauth.e2e-spec.ts` |
| RBAC / unauthorized access | Automated | `test/rbac.e2e-spec.ts`, `test/admin.e2e-spec.ts` (401 anonymous, 403 owner) |
| Discovery → strategy → content → review → publish | Automated (API e2e + publishing integration harness; UI e2e with mocked API) | `test/strategy.e2e-spec.ts`, `test/content.e2e-spec.ts`, `test/publishing-integration.e2e-spec.ts` |
| Voice discovery | Unit + endpoint tests | `tests/voice_transcription/test_voice_transcription.py` |
| Billing / points | Unit + webhook specs + web e2e (mock) | `billing.service.webhook.spec.ts`, `e2e/billing.spec.ts` |
| Admin console | API e2e + unit | `test/admin.e2e-spec.ts`, `users-page.test.tsx` |
| New Privacy/Terms pages (this branch) | Static verification only (typecheck, lint, dictionary parity executed) — **browser walkthrough NOT performed** → human review item | §13 |
| Production hosted demo end-to-end | NOT TESTED in this audit (no browser/credentials used) | — |

## 7. Security Testing

| Check | Status | Evidence |
| --- | --- | --- |
| SAST (CodeQL/Semgrep/bandit) | MISSING (no config in repo) | `.github/workflows/` |
| Dependency audit (npm audit / pip-audit) | MISSING | idem |
| Secret scanning (gitleaks/push rules) | MISSING | idem |
| Container scanning (trivy/grype) | MISSING | idem |
| Security regression tests (authz/auth flows, webhook HMAC, tamper detection) | IMPLEMENTED as code-level automated tests | rbac/admin/publishing e2e specs; billing webhook specs; `CANDIDATE_TAMPERED`/`ASSET_TAMPERED` tests |
| Adversarial AI tests | IMPLEMENTED (eval mutation suite incl. prompt-injection case) | `services/ai/tests/evaluation/content/cases/cases_mutation.json` |
| Penetration testing | NOT PERFORMED | — |

## 8. CI / Automation (LIVE evidence, fetched 2026-08-19 via `gh run list`)

| Workflow | What it runs | Last main-branch result |
| --- | --- | --- |
| `api-ci.yml` | contracts check → API build → unit tests (`--runInBand`) → integration job (real Postgres+Redis, `prisma migrate deploy`, e2e + db specs) | **SUCCESS** — run `32265605430`, 5m39s, 2026-08-19 (LIVE) |
| `ai-ci.yml` | eval-smoke; content-eval + **hard-guardrail threshold assertion**; agentic phase4/5; phase0 durability (real Postgres) | **SUCCESS** — run `32271456381`, 45s, 2026-08-19 (LIVE) |
| `web-ci.yml` | typecheck + eslint + vitest + dictionary parity; production build; Playwright e2e (chromium) | **SUCCESS on main** — run `32265605329`, 4m39s, 2026-08-19 (LIVE). ⚠ Two PR-branch runs (`fix/253-content-points-confirmation`) were cancelled at ~20m and one failed at 7m18s — flagged as a current CI-flakiness known issue. |
| `build-push-images.yml` | Buildx build+push of api/web/ai images to GHCR | **completed success** — run `32271456341`, 2m54s (LIVE). Whether images actually landed in GHCR is NOT VERIFIED; `DEPLOY_HOSTED.md` documents a previously blocked push for the owner account. |

CI gaps: no lint/typecheck for API in CI (apps/api has no ESLint config at all — `typecheck` script exists but is not wired), no Python lint, no coverage reporting, no artifact upload of playwright reports, no required-status documentation.

## 9. Monitoring / Observability

- Health endpoints: `GET /api/v1/health` (DB `SELECT 1`, Redis `PING`, queue status) and `GET /health` on AI (Qdrant reachability + collection count) — both used as Docker healthchecks in prod compose.
- Logging: Nest default logger; AI service stdlib logging with a strong **redaction layer** (`services/ai/app/core/logging.py`); publishing `safeHttp` sanitization.
- Metrics/alerting/tracing: **NONE** (no Prometheus, Sentry, OTel, Grafana; Langfuse exporter exists but disabled by default). No BullMQ dashboard.
- Log-privacy concern: 3 API paths log email addresses; mock mailer logs raw token links (dev/test only); AI strategy endpoints return `str(e)` in error bodies (see security package R-05/R-06).

## 10. LLM Evaluation

**A formal LLM evaluation framework exists** (`services/ai/tests/evaluation/content/`):

- **Dataset:** 34 frozen synthetic cases — 15 baseline (5 sectors × 3) + 19 adversarial mutations (unapproved strategy, stale profile, unsupported price/testimonial/competitor/guarantee/regulated/health claims, wrong channel/pillar, **prompt injection**, missing asset, invalid schema, cycle state violations, provider timeout, failed image, unapproved offer, approval blocked, revision preservation). All business data is fictional (`SYNTHETIC`), versioned (`content-eval-v1`), schema-frozen.
- **What is measured:** hard guardrail outcomes (every case's expected blocking/validation outcome must match actual validator behavior) and a separate human rubric (4 named reviewers per case, ≥4/5 on applicable dimensions).
- **Thresholds (design values, from `docs/thresholds.md`):** hard guardrails bar **1.0** (enforced in CI via `--hard-guardrails-only`), human rubric **0.9**.
- **Real-provider spot-checks:** manual opt-in only (`MARKETMIND_CONTENT_REAL_PROVIDER=1`), never in CI, never silently faked.
- **Status of measured numbers:** the CI content-eval job passed on main on 2026-08-19 (LIVE, run `32271456381`) which asserts the 1.0 hard-guardrail bar against the fake provider matrix. **Per-case numeric outputs were not re-run locally in this audit (NOT RUN), and no accuracy/quality percentage beyond the described bars is claimed.**

## 11. RAG Evaluation

`services/ai/tests/evaluation/` contains a retrieval-evaluation framework:

- **Dataset:** 5-sector × language cases with per-case `expected_chunk_ids`, `forbidden_chunk_ids` (expired/unapproved/wrong-locale/wrong-sector), `required_gap_categories`, and per-case `min_top5_hit_rate` (default 0.8) — human-labelled, synthetic.
- **Metrics implemented:** precision@5 / recall@5 / MRR@5 computed **only from complete human labels**, with explicit `unmeasured_reasons` instead of imputed zeros (`runner/metrics.py:24-95`); RAG-vs-no-RAG comparison rubric with grounding diagnostics (citation integrity, retrieval resolution, benchmark validation); privacy evaluation; hard-filter evaluation; semantic-vs-MMR comparison; determinism tests.
- **Runtime:** in-memory Qdrant + deterministic fake embeddings (no paid providers).
- **Status:** CI runs the eval-smoke marker; **full per-case metric values were NOT re-measured in this audit (NOT RUN locally).** No production/live-corpus retrieval metrics exist anywhere (honest gap → roadmap).

## 12. Actual Test Results (everything executed for or verified by this audit)

| Check | Scope | Result | Label |
| --- | --- | --- | --- |
| Dictionary parity | `apps/web` messages (`Legal` namespace, ar/en) | **PASS** — all keys match | LOCAL (executed 2026-08-20) |
| Web typecheck / lint / unit | full `npm run check -w @marketmind/web` | **PASS** — 95 files, 703 tests; lint had one existing unused-import warning and no errors | LOCAL (executed 2026-08-20) |
| Web production build | `npm run build -w @marketmind/web` | **PASS** — Next.js build completed and rendered 59 routes | LOCAL (executed 2026-08-20) |
| Legal-page browser smoke | en/ar Privacy and Terms navigation at desktop/mobile sizes | **PASS** — targeted landing suite 12 passed, 2 expected skips; canonical, locale, RTL, anchor, overflow, and mobile-header spacing also verified | LOCAL (executed 2026-08-20) |
| Contracts check | `npm run check -w @marketmind/contracts` | **PASS** — all contract, example, lifecycle, and Python checks completed | LOCAL (executed 2026-08-20) |
| API build | `npm run build -w @marketmind/api` | **PASS** — Nest build and Prisma client generation completed | LOCAL (executed 2026-08-20) |
| API unit suite | `npm run test -w @marketmind/api -- --runInBand` | **PASS** — 176 suites, 1,536 tests | LOCAL (executed 2026-08-20) |
| API e2e / DB suites | full suites | **NOT RUN locally** — requires a dedicated disposable database; historical CI results remain in §8 | NOT RUN (local) / LIVE (historical CI) |
| AI pytest (non-network) | `npm run check:ai` | **PASS** — 1,018 passed, 1 skipped, 74 deselected | LOCAL (executed 2026-08-20) |
| AI content threshold | `npm run check:ai:content:threshold` | **PARTIAL / exit 1** — hard guardrails 100% PASS; rubric quality 0% because no human-reviewed cases are present, with no unmet deterministic cases | LOCAL (executed 2026-08-20) |
| Web full Playwright matrix | all `apps/web/e2e` specs | **NOT RUN locally** — targeted landing/legal smoke ran against the isolated worktree; historical CI results remain in §8 | NOT RUN (local) / LIVE (historical CI) |

## 13. Limitations of this report

1. API e2e and the full web Playwright matrix were not run locally; their historical CI records are listed in §8 and are not a substitute for a new post-fix run.
2. No coverage percentages are reported anywhere in this document because no coverage tool runs in CI and none was run locally.
3. Web e2e validates the mock API boundary only (§5).
4. Hosted-production behavior (https://marketmindai.duckdns.org) was not exercised — no browser credentials or live provider calls were used in this audit.
5. Legal pages were browser-walked locally in both locales and responsive sizes; the remaining human gate is legal approval of the explicit `[LEGAL REVIEW]` placeholders.

## 14. Evidence pointers

- CI workflows: `.github/workflows/{api-ci,web-ci,ai-ci,build-push-images}.yml`
- Content eval: `services/ai/tests/evaluation/content/` (+ `docs/thresholds.md`, `docs/mutation-to-guardrail.md`)
- RAG eval: `services/ai/tests/evaluation/{dataset,runner,run_evaluation.py}`
- E2E: `apps/api/test/*.e2e-spec.ts`, `apps/web/e2e/*.spec.ts`, `apps/web/playwright.config.ts`
- Commands: root `package.json` `check`, workspace `test`/`test:e2e`/`test:db`/`check` scripts
- LIVE CI records: GitHub run IDs `32271456381` (ai-ci), `32265605430` (api-ci), `32265605329` (web-ci main success), `32271456343` (web-ci cancelled, PR branch), `32271456341` (images)

# Known Issues & Future Roadmap

**MarketMind AI — current known issues, limitations, deferred scope, and roadmap**

- **Date:** 2026-08-19
- Every item below carries its evidence location. Items are honest statements of current state; roadmap items are **PLANNED**, not implemented.

---

## 1. Current Known Issues

| ID | Issue | Impact | Severity/Priority | Evidence | Next step |
| --- | --- | --- | --- | --- | --- |
| K-01 | `ThrottlerGuard` never registered → all `@Throttle` decorators inert (auth session-limit, facebook, billing decorators); no global default throttle | Unthrottled abuse surface on billing/admin/content-owner GET routes | **High** | `apps/api/src/app.module.ts:42-48`; grep `APP_GUARD\|ThrottlerGuard` → 0 matches | Register guard as `APP_GUARD` (short term) |
| K-02 | AI service `/internal/v1/*` endpoints unauthenticated (all LLM-spend + Qdrant-read routes) | Anyone with network reach can invoke paid LLM calls; relies on network isolation | **High** (mitigated in current single-host deploy) | `services/ai/app/main.py:74-90` | Shared internal service token or network policy (short term) |
| K-03 | `web-ci` PR-branch runs cancelled (~20m) and one failure on `fix/253-content-points-confirmation` (2026-08-19) | CI signal unreliable for PRs | Medium | LIVE `gh run list`: runs `32271456343`, `32269194807` cancelled; `32265470267` failed | Investigate stuck e2e/job timeout; add timeout tuning |
| K-04 | `voice_transcription_rate_limit_per_minute` defined but never enforced in AI service | Documented control does not exist at that layer (API-side 4/min Redis guard does exist) | Medium | `services/ai/app/core/config.py:116` (sole reference) | Enforce or delete the setting |
| K-05 | `str(e)` in HTTP error bodies on 4 strategy endpoints + AI health endpoint | Internal exception text disclosure to internal callers | Medium | `services/ai/app/api/internal_v1/strategy.py:145-149, 394-398, 469-476, 584-591`; `app/api/health.py:18-20` | Map to stable error codes |
| K-06 | Email addresses logged in 3 API paths; mock mailer logs raw reset/verify links (dev default) | PII in logs; token-bearing URLs in dev logs | Medium | `auth.service.ts:280-300`, `oauth-account-policy.service.ts:90-92`, `mail/mock-mail.provider.ts:9-13` | Structured, redacting logger (pino) |
| K-07 | Auth Redis rate limiter fails open on Redis outage | Temporary loss of abuse protection | Medium (deliberate trade-off, commented) | `auth-rate-limiter.service.ts:55-58` | Fail-closed policy decision + alerting |
| K-08 | No helmet/CSP/HSTS/X-Frame-Options on API | Missing baseline browser-facing hardening (mostly compensated by Caddy TLS + single-origin design) | Medium | `apps/api/src/main.ts` | Add helmet (short term) |
| K-09 | No database backup strategy for prod volumes | Total data loss on host failure | **High** (operational) | grep `backup\|pg_dump` in `infra/`, `DEPLOY_HOSTED.md` → none | Nightly `pg_dump` + off-box copy |
| K-10 | GHCR image push previously blocked (`permission_denied: create_package` documented) while workflow reports success | Deployment relies on VM-local builds; image registry path uncertain | Low | `DEPLOY_HOSTED.md` (Phase 0 caveat); LIVE run `32271456341` success | Verify GHCR state; document canonical build path |
| K-11 | `.env.test` (gitignored, local-only) contains a real-format Google OAuth client secret despite its "public fixtures" header | Local hygiene risk only — verified NOT git-tracked | Low | `git ls-files apps/api` (only `.env.example` tracked) | Replace with placeholder secret locally |
| K-12 | Access tokens remain valid ≤15 min after logout/role change (no denylist) | Standard stateless-JWT trade-off | Low | `strategies/jwt.strategy.ts:20-30` | Documented; optional denylist later |
| K-13 | `POST /auth/reset-password` lacks the custom Redis limiter (relies on inert `@Throttle`) | Token-guess surface bounded only by 256-bit entropy + 30-min TTL | Low | `auth.controller.ts:264-270` | Covered by K-01 fix |

## 2. Security Limitations (summary)

No SAST/secret-scanning/dependency/container scanning in CI; no penetration test ever performed; `InternalAuthGuard` compare not timing-safe; no `trust proxy` configuration behind reverse proxy (OAuth limiter keys may collapse); admin health endpoint returns raw DB error text (`health.controller.ts:55`). Details: security package §3/§23.

## 3. Privacy Limitations

No account deletion, no self-service data export, no automated retention or log pruning, `FederatedIdentity.rawProfile` retains full Google ID-token payload (minimization gap), no DPA/legal review of processors, no records of processing. Details: security package §18-§22.

## 4. AI/LLM Limitations

- No runtime prompt-injection scanner (eval-harness-only capability).
- No dedicated content-moderation classifier (integrity guardrails only).
- Strategy/discovery prompts intentionally include full business profile → provider-side processing is unavoidable for the product; content prompts are scrubbed.
- No production-quality measurement loop for live outputs (evaluation is offline, synthetic, fake-provider in CI; real-provider spot-checks manual).
- Orchestration/Langfuse tracing implemented but disabled pending shadow rollout (`ai_orchestration_enabled=False`).

## 5. RAG Limitations

- Evaluation metrics (precision/recall/MRR@5) are framework-ready with human labels but **no current measured numbers are published** — nothing was re-run in this audit, and no live-corpus metrics exist.
- Corpus is a small curated Markdown set (5 sectors); coverage gaps are tracked as `required_gap_categories` in eval cases rather than automatically filled.
- Qdrant runs without API key (network-isolated container); acceptable in the single-host demo, not for shared infrastructure.

## 6. Testing Limitations

- Web e2e targets a mock API (real backend not covered by UI e2e).
- No coverage tooling/reporting anywhere.
- `apps/api` has no ESLint config/lint script; `typecheck` script exists but is not run in CI.
- Local-vs-CI Postgres port mismatch (5433 vs 5432) adds friction to running CI jobs verbatim locally.
- Full local suites not executed during this audit (see Testing report truthfulness statement).

## 7. Observability Limitations

No metrics, no alerting, no error tracking (Sentry-class), no log shipping/retention policy, no BullMQ dashboard; health endpoints only. AI trace export disabled by default.

## 8. Technical Debt (selected)

- Legacy `SocialConnection` encrypted-token path coexists with `PublishingCredential` vault (two encryption code paths).
- `User.refreshToken` legacy single-token fallback path still accepted by the refresh strategy.
- Hardcoded dev webhook secret default (`configuration.ts:219-221`, fake provider only).
- Personal Gmail address as `SMTP_USER` example in `apps/api/.env.example:121`.
- No standard linter/formatter enforcement for API/Python code in CI.

## 9. Deferred Scope (explicitly out of current scope)

Video generation, paid-ads automation, multi-platform publishing beyond Facebook, real production payments activation (Paymob is sandbox-verified only; hosted demo runs `BILLING_PROVIDER=fake`), agentic orchestration rollout (code present, disabled), Langfuse tracing rollout, automatic multi-language strategy generation beyond current bilingual support. Source: `Docs/planning/00_START_HERE.md` (included/deferred lists) + config flags.

## 10. Current Risks (top, in priority order)

1. K-01/K-02 (abuse + unauthenticated internal AI service) — the two highest-severity technical gaps.
2. K-09 (no backups) — operational data-loss risk.
3. Privacy tooling debt (deletion/export/retention) — blocks any real-customer onboarding.
4. Supply-chain scanning absence.
5. CI reliability on PR branches (K-03).

---

## 11. Short-Term Roadmap (0–2 weeks)

| # | Item | Addresses | Effort (S/M/L) |
| --- | --- | --- | --- |
| S-1 | Register `ThrottlerGuard` as `APP_GUARD`; verify `@Throttle` coverage; decide fail-open vs fail-closed limiter policy | K-01, K-07, K-13 | S |
| S-2 | Add `helmet` + basic security headers to API | K-08 | S |
| S-3 | Internal service token (or network policy) for AI `/internal/v1/*` routes | K-02 | S–M |
| S-4 | Replace `str(e)` responses with stable error codes (strategy + health) | K-05 | S |
| S-5 | Nightly Postgres `pg_dump` backup + off-box copy + restore rehearsal | K-09 | S |
| S-6 | Remove email logging + raw-link mock mailer logs; adopt redacting logger | K-06 | S |
| S-7 | Add `npm audit` + gitleaks/CodeQL to CI; enable Dependabot | §2 | S |
| S-8 | Enforce or remove the voice AI-side rate-limit setting | K-04 | S |
| S-9 | Investigate web-ci cancellations; stabilize e2e job | K-03 | M |
| S-10 | Browser-walk the new Privacy/Terms pages in ar+en and confirm footer links (human) | Testing report §6 | S (human) |

## 12. Medium-Term Roadmap (1–2 months)

| # | Item | Addresses |
| --- | --- | --- |
| M-1 | Account deletion + data export (owner self-service or admin-operated) with cascade review across 86 models | Privacy §19-20 |
| M-2 | Retention automation: session/log/payload pruning crons aligned to the sprint-1 documented policy (180d/30d/14d) | Privacy §18 |
| M-3 | Runtime prompt-injection scanner on inbound free-text fields (reuse eval-harness patterns) | AI §4 |
| M-4 | Content-moderation decision: adopt provider-side moderation endpoints or keep integrity-only posture with documented rationale | Security §8 |
| M-5 | Observability baseline: structured logging, error tracking, queue/health metrics, alert on queue backlog + webhook failures | §7 |
| M-6 | Coverage reporting for API/web/AI; API lint+typecheck wired into CI | §6 |
| M-7 | RAG metric dashboard: publish precision/recall/MRR per release on the labelled dataset; wire `check:ai:content:threshold` style gating for retrieval | §5 |
| M-8 | Federated-identity data minimization (drop/shrink `rawProfile`) | Privacy §3 |
| M-9 | Backup/restore runbook + DR note for the hosted demo | K-09 |

## 13. Long-Term Roadmap (3–6+ months)

| # | Item | Addresses |
| --- | --- | --- |
| L-1 | GDPR readiness → review: legal counsel pass over policy/terms, DPA inventory for processors, records of processing, transfer mechanism decision | Privacy §22 |
| L-2 | Production payments activation (Paymob live keys, webhook monitoring, reconciliation alerts) — only after M-1/M-2 | Deferred scope |
| L-3 | Agentic orchestration shadow rollout with Langfuse tracing (already code-complete, disabled) | AI §4 |
| L-4 | Real-provider LLM quality benchmarking cadence (monthly spot-checks using the manual opt-in runner) | AI §4 |
| L-5 | Multi-worker deployment hardening: shared rate-limit store, Qdrant API key, service mesh/network policy | K-02, §5 |
| L-6 | Second publishing platform (per planning docs' deferred list) with the same approval-gate architecture | Deferred scope |
| L-7 | Live-corpus RAG evaluation (sampled production queries, anonymized) with drift detection | §5 |

## 14. Priorities

Order of execution recommended: **S-1 → S-3 → S-5 → S-7 → M-1 → M-2 → M-5**, because they map to the highest-severity technical risks (abuse, internal auth, data loss) and to the only blockers for handling real user data responsibly (deletion/export/retention). Everything else can proceed in parallel per team capacity.

---

## Evidence index

All file references in this document were verified at commit `637a0b4` on branch `docs/security-privacy-testing-roadmap`. LIVE CI records are GitHub Actions run IDs listed in `TESTING_AND_EVALUATION_REPORT.md` §8. Companion documents: `SECURITY_AND_PRIVACY_GDPR_PACKAGE.md` (risk register, safeguards, GDPR coverage, evidence matrix) and `TESTING_AND_EVALUATION_REPORT.md` (inventory, methodology, executed results).

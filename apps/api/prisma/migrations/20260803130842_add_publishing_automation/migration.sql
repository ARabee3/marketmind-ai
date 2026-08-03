-- CreateEnum
CREATE TYPE "PublishingCandidateStatus" AS ENUM ('ACTIVE', 'REVOKED', 'REPLACED');

-- CreateEnum
CREATE TYPE "PublishingTargetProvider" AS ENUM ('META');

-- CreateEnum
CREATE TYPE "PublishingTargetConnectionState" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "PublishingIntentStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'DISPATCHING', 'SUCCEEDED', 'FAILED', 'ACTION_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublishingMode" AS ENUM ('REAL', 'MANUAL_EXPORT', 'SIMULATION');

-- CreateEnum
CREATE TYPE "PublishingApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublishingAttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'DISPATCHING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublishingOutcome" AS ENUM ('PUBLISHED', 'EXPORTED', 'SIMULATED', 'FAILED', 'CANCELLED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "publishing_candidates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "external_content_id" TEXT NOT NULL,
    "candidate_checksum" TEXT NOT NULL,
    "event_fingerprint" TEXT NOT NULL,
    "status" "PublishingCandidateStatus" NOT NULL DEFAULT 'ACTIVE',
    "payload" JSONB NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "strategy_week_number" INTEGER,
    "source_state_version" INTEGER NOT NULL DEFAULT 1,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_targets" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "provider" "PublishingTargetProvider" NOT NULL,
    "channel" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "connection_state" "PublishingTargetConnectionState" NOT NULL DEFAULT 'CONNECTED',
    "credential_ref" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "last_verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_intents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "target_id" UUID,
    "mode" "PublishingMode" NOT NULL DEFAULT 'REAL',
    "status" "PublishingIntentStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_local_at" TIMESTAMP(6),
    "timezone" TEXT,
    "scheduled_utc_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_approvals" (
    "id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "intent_version_at_decision" INTEGER NOT NULL,
    "candidate_checksum" TEXT NOT NULL,
    "decision" "PublishingApprovalDecision" NOT NULL,
    "decided_by_user_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    -- Canonical HMAC of every exact field the owner approved (contract
    -- publication-approval-v1.approval_fingerprint). Rejects post-approval
    -- tampering of mode/target/time/checksum/version without a new row.
    "approval_fingerprint" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_attempts" (
    "id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "intent_version" INTEGER NOT NULL,
    "attempt_sequence" INTEGER NOT NULL,
    "status" "PublishingAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "workflow_version" TEXT,
    -- Contract publication-attempt-v1.request_fingerprint: canonical hash of
    -- the signed dispatch body. Combined with idempotency_key it lets a
    -- delayed-job replay resolve to the SAME attempt (identical fingerprint)
    -- rather than a new one, and reject conflicting bytes for the same key.
    "provider_request_fingerprint" TEXT,
    -- Contract publication-attempt-v1.idempotency_key: one per owner action,
    -- unique per intent. Replay of the same delayed job reuses the same key.
    "idempotency_key" TEXT NOT NULL,
    "n8n_execution_ref" TEXT,
    "sanitized_error" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_results" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "outcome" "PublishingOutcome" NOT NULL,
    "provider" TEXT,
    "remote_publication_id" TEXT,
    "remote_url" TEXT,
    "export_artifact_id" UUID,
    "simulation_label" TEXT,
    "error_code" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "raw_payload_hash" TEXT,
    "sanitized_error" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_callback_identities" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "external_callback_id" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload_timestamp" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_callback_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_export_metadata" (
    "id" UUID NOT NULL,
    "intent_id" UUID NOT NULL,
    "export_type" TEXT NOT NULL,
    "destination_ref" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "exported_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_export_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publishing_candidates_business_id_status_idx" ON "publishing_candidates"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_candidates_business_id_external_content_id_candi_key" ON "publishing_candidates"("business_id", "external_content_id", "candidate_checksum");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_candidates_event_fingerprint_key" ON "publishing_candidates"("event_fingerprint");

-- CreateIndex
CREATE INDEX "publishing_targets_business_id_connection_state_idx" ON "publishing_targets"("business_id", "connection_state");

-- CreateIndex
CREATE INDEX "publishing_intents_business_id_status_idx" ON "publishing_intents"("business_id", "status");

-- CreateIndex
CREATE INDEX "publishing_intents_candidate_id_idx" ON "publishing_intents"("candidate_id");

-- CreateIndex
CREATE INDEX "publishing_intents_scheduled_utc_at_idx" ON "publishing_intents"("scheduled_utc_at");

-- CreateIndex
CREATE INDEX "publishing_approvals_intent_id_idx" ON "publishing_approvals"("intent_id");

-- CreateIndex
-- Contract publication-approval-v1.approval_fingerprint is the canonical HMAC
-- of the exact approved decision. Make it unique so a replayed exact decision
-- resolves to the existing row (no-op) while a conflicting decision for the
-- same intent+version surfaces as PUBLISHING_STATE_CONFLICT.
CREATE UNIQUE INDEX "publishing_approvals_approval_fingerprint_key"
  ON "publishing_approvals"("approval_fingerprint");

-- CreateIndex
CREATE INDEX "publishing_approvals_idempotency_key_idx"
  ON "publishing_approvals"("idempotency_key");

-- CreateIndex
CREATE INDEX "publishing_attempts_intent_id_intent_version_idx" ON "publishing_attempts"("intent_id", "intent_version");

-- CreateIndex
CREATE INDEX "publishing_attempts_status_created_at_idx" ON "publishing_attempts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_attempts_intent_id_intent_version_attempt_sequen_key" ON "publishing_attempts"("intent_id", "intent_version", "attempt_sequence");

-- CreateIndex
-- Issue #119 acceptance: "Queue replay resolves to the same attempt or a recorded
-- no-op", and contract publication-attempt-v1.idempotency_key: one key per owner
-- action, unique per intent. A delayed-job BullMQ replay carrying the same key
-- must resolve to the SAME attempt row (identical replay → no-op) — the
-- dispatch processor looks up by (intent_id, idempotency_key) before creating.
-- Conflicting canonical bytes under the same key surface as
-- PUBLISHING_IDEMPOTENCY_CONFLICT at the app layer.
CREATE UNIQUE INDEX "publishing_attempts_intent_id_idempotency_key_key"
  ON "publishing_attempts"("intent_id", "idempotency_key");

-- CreateIndex
-- Fast lookup of an attempt by its signed dispatch fingerprint, used by the
-- duplicate-job replay path to detect identical-vs-conflicting bytes.
CREATE INDEX "publishing_attempts_provider_request_fingerprint_idx"
  ON "publishing_attempts"("provider_request_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_results_attempt_id_key" ON "publishing_results"("attempt_id");

-- CreateIndex
CREATE INDEX "publishing_results_intent_id_idx" ON "publishing_results"("intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "publishing_callback_identities_external_callback_id_key" ON "publishing_callback_identities"("external_callback_id");

-- CreateIndex
CREATE INDEX "publishing_callback_identities_attempt_id_idx" ON "publishing_callback_identities"("attempt_id");

-- CreateIndex
CREATE INDEX "publishing_export_metadata_intent_id_idx" ON "publishing_export_metadata"("intent_id");

-- AddForeignKey
ALTER TABLE "publishing_intents" ADD CONSTRAINT "publishing_intents_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "publishing_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_intents" ADD CONSTRAINT "publishing_intents_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "publishing_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_approvals" ADD CONSTRAINT "publishing_approvals_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "publishing_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_attempts" ADD CONSTRAINT "publishing_attempts_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "publishing_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_results" ADD CONSTRAINT "publishing_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "publishing_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_callback_identities" ADD CONSTRAINT "publishing_callback_identities_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "publishing_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publishing_export_metadata" ADD CONSTRAINT "publishing_export_metadata_intent_id_fkey" FOREIGN KEY ("intent_id") REFERENCES "publishing_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Partial unique index: at most one ACTIVE (non-terminal) intent per candidate ──
-- Issue #119 acceptance: "Unique constraints prevent duplicate ... active
-- intents", and §7.3: "MVP permits one non-cancelled intent per candidate."
-- The app-layer `findFirst` check in IntentsService.createIntent is a friendly
-- fast-path, but it is a TOCTOU race — two concurrent POSTs both pass the check
-- and both insert. This partial unique index is the authoritative guarantee:
-- a duplicate active insert raises SQL state 23505 (Prisma P2002), which the
-- service maps to PUBLISHING_STATE_CONFLICT.
--
-- Prisma's schema DSL cannot express filtered unique indexes, so this index is
-- managed in raw SQL (mirrored by a documentation comment on the model in
-- schema.prisma). Cancelled/failed/succeeded intents do NOT occupy the slot,
-- so a candidate whose intent was cancelled can later receive a fresh intent.
CREATE UNIQUE INDEX "publishing_intents_candidate_id_active_uniq"
  ON "publishing_intents" ("candidate_id")
  WHERE
    "status" IN ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'DISPATCHING');

-- ── Partial unique index: idempotent create-intent per (business, owner key) ──
-- Contract idempotency matrix "Create intent": an identical create replay with
-- the same client `idempotency_key` resolves to the existing intent (no-op),
-- while reusing a key with different bytes surfaces as
-- PUBLISHING_IDEMPOTENCY_CONFLICT. Prisma cannot model filtered unique
-- indexes, so this lives in raw SQL (mirrored by a doc comment on the model).
-- The service's pre-insert lookup is a friendly fast-path; this index is the
-- race-proof guarantee — a concurrent identical create hits 23505 (P2002),
-- which the service resolves back to the existing intent.
CREATE UNIQUE INDEX "publishing_intents_business_id_idempotency_key_uniq"
  ON "publishing_intents" ("business_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- ── Partial unique index: at most one PUBLISHED result per intent ──
-- Issue #119 acceptance: "Unique constraints prevent duplicate ... confirmed
-- publications". The dispatch-time DUPLICATE_DISPATCH check and the
-- attempt-level idempotency key guard in-flight duplication, but a
-- pathological double-callback (or two attempts both claiming PUBLISHED) could
-- otherwise persist two confirmed publications for one logical publication.
-- This partial unique index is the authoritative DB guarantee: a second
-- outcome='PUBLISHED' row for the same intent raises 23505 (P2002), mapped to
-- PUBLISHING_DUPLICATE_DISPATCH. Exported/Simulated are deliberately NOT in
-- the WHERE clause — they are deterministic local actions and re-running an
-- export can legitimately produce a second EXPORTED row (the artifact id
-- differs), which is fine because EXPORTED is not a provider-confirmed remote
-- state. Failed/Unknown/Cancelled obviously do not claim a publication slot.
CREATE UNIQUE INDEX "publishing_results_intent_id_published_uniq"
  ON "publishing_results" ("intent_id")
  WHERE "outcome" = 'PUBLISHED';

-- Fast provider-side lookup: find a result by the remote publication id the
-- provider returned (used by the reconciliation path to dedupe a separately
-- polled confirmation against a recorded callback).
CREATE INDEX "publishing_results_remote_publication_id_idx"
  ON "publishing_results"("remote_publication_id")
  WHERE "remote_publication_id" IS NOT NULL;

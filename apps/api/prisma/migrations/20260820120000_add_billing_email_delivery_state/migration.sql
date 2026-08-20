-- Issue #247: durable delivery state for the billing outbox so a transient
-- mail-provider failure is retried (leased, backoff) without undoing the
-- confirmed payment, wallet credit, or ledger entry. Duplicate webhooks and
-- outbox retries stay idempotent via the existing unique dedupe_key.
-- AlterTable
ALTER TABLE "billing_outbox"
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;

-- CreateIndex
CREATE INDEX "billing_outbox_state_next_attempt_at_idx" ON "billing_outbox"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "billing_outbox_lease_expires_at_idx" ON "billing_outbox"("lease_expires_at");
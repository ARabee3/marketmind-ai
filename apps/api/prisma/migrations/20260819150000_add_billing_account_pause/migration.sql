-- Operator fraud/safety pause for a billing account. Additive only.
-- `status` defaults to "active"; "paused" blocks new checkouts and point
-- spends (enforced in BillingService). Pause is reversible via the admin
-- resume action and every transition is audit-trailed.

-- AlterTable
ALTER TABLE "billing_accounts" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "billing_accounts" ADD COLUMN "paused_reason" TEXT;
ALTER TABLE "billing_accounts" ADD COLUMN "paused_at" TIMESTAMP(3);
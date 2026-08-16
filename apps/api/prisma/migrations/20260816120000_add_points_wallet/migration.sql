-- Prepaid points wallet: bundle points on the price catalog plus the point
-- balance and append-only ledger. Additive only — the legacy subscription and
-- usage tables are retained read-only for history and admin surfaces.

-- AlterTable
ALTER TABLE "billing_prices" ADD COLUMN "points_granted" INTEGER;

-- CreateTable
CREATE TABLE "billing_point_balances" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetime_granted" INTEGER NOT NULL DEFAULT 0,
    "lifetime_spent" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_point_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_point_ledger" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metric" TEXT,
    "points" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "claim_key" TEXT NOT NULL,
    "transaction_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_point_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_point_balances_billing_account_id_key" ON "billing_point_balances"("billing_account_id");

-- CreateIndex
CREATE INDEX "billing_point_ledger_billing_account_id_created_at_idx" ON "billing_point_ledger"("billing_account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "billing_point_ledger_billing_account_id_claim_key_key" ON "billing_point_ledger"("billing_account_id", "claim_key");

-- AddForeignKey
ALTER TABLE "billing_point_balances" ADD CONSTRAINT "billing_point_balances_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_point_ledger" ADD CONSTRAINT "billing_point_ledger_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing account gets a balance row and the one-time trial
-- grant. Billing is not live (fake provider), so all pre-existing accounts are
-- effectively trial accounts; the grant is idempotent via the ledger claim key.
INSERT INTO "billing_point_balances" ("id", "billing_account_id", "balance", "lifetime_granted", "lifetime_spent", "updated_at", "created_at")
SELECT gen_random_uuid(), a."id", 65, 65, 0, NOW(), NOW()
FROM "billing_accounts" a
WHERE NOT EXISTS (SELECT 1 FROM "billing_point_balances" b WHERE b."billing_account_id" = a."id");

INSERT INTO "billing_point_ledger" ("id", "billing_account_id", "direction", "reason", "metric", "points", "balance_after", "claim_key", "created_at")
SELECT gen_random_uuid(), a."id", 'credit', 'trial_grant', NULL, 65, 65, 'trial-grant:' || a."id", NOW()
FROM "billing_accounts" a
WHERE NOT EXISTS (SELECT 1 FROM "billing_point_ledger" l WHERE l."claim_key" = 'trial-grant:' || a."id");

-- Billing is provider-neutral at this stage. The first live adapter is gated
-- behind merchant approval; the local tables are still the source of truth.

CREATE TABLE "billing_accounts" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "active_business_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_prices" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "amount_egp" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "period_days" INTEGER NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "display_name_en" TEXT NOT NULL,
    "display_name_ar" TEXT NOT NULL,
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_subscriptions" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "price_id" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'trialing',
    "renewal_mode" TEXT NOT NULL DEFAULT 'none',
    "provider" TEXT,
    "provider_customer_ref" TEXT,
    "provider_agreement_ref" TEXT,
    "masked_payment_method" TEXT,
    "trial_started_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "paid_through_at" TIMESTAMP(3),
    "grace_ends_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancel_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_checkout_attempts" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "price_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_checkout_ref" TEXT,
    "provider_checkout_url" TEXT,
    "amount_egp" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "payment_mode" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_checkout_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_payment_transactions" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "subscription_id" UUID,
    "checkout_attempt_id" UUID,
    "provider" TEXT NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amount_egp" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "payment_mode" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_payment_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_provider_events" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID,
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_provider_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_usage_ledger" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "business_id" UUID,
    "metric" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "claim_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_usage_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_provider_cost_ledger" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "business_id" UUID,
    "billing_period_start" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "logical_artifact_key" TEXT NOT NULL,
    "input_units" INTEGER,
    "output_units" INTEGER,
    "native_cost" DECIMAL(18,8),
    "native_currency" TEXT,
    "egp_rate" DECIMAL(18,8),
    "egp_cost" DECIMAL(18,8),
    "successful_artifact" BOOLEAN NOT NULL DEFAULT false,
    "quota_effect" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "snapshot_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_provider_cost_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_outbox" (
    "id" UUID NOT NULL,
    "billing_account_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dispatched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_accounts_owner_user_id_key" ON "billing_accounts"("owner_user_id");
CREATE INDEX "billing_accounts_active_business_id_idx" ON "billing_accounts"("active_business_id");
CREATE UNIQUE INDEX "billing_prices_code_key" ON "billing_prices"("code");
CREATE INDEX "billing_prices_plan_code_public_retired_at_idx" ON "billing_prices"("plan_code", "public", "retired_at");
CREATE INDEX "billing_subscriptions_billing_account_id_state_created_at_idx" ON "billing_subscriptions"("billing_account_id", "state", "created_at");
CREATE INDEX "billing_subscriptions_paid_through_at_idx" ON "billing_subscriptions"("paid_through_at");
CREATE UNIQUE INDEX "billing_checkout_attempts_provider_checkout_ref_key" ON "billing_checkout_attempts"("provider_checkout_ref");
CREATE UNIQUE INDEX "billing_checkout_attempts_billing_account_id_idempotency_key_key" ON "billing_checkout_attempts"("billing_account_id", "idempotency_key");
CREATE INDEX "billing_checkout_attempts_billing_account_id_status_idx" ON "billing_checkout_attempts"("billing_account_id", "status");
CREATE INDEX "billing_checkout_attempts_expires_at_status_idx" ON "billing_checkout_attempts"("expires_at", "status");
CREATE UNIQUE INDEX "billing_payment_transactions_provider_provider_transaction_id_key" ON "billing_payment_transactions"("provider", "provider_transaction_id");
CREATE INDEX "billing_payment_transactions_billing_account_id_occurred_at_idx" ON "billing_payment_transactions"("billing_account_id", "occurred_at");
CREATE UNIQUE INDEX "billing_provider_events_provider_external_event_id_key" ON "billing_provider_events"("provider", "external_event_id");
CREATE INDEX "billing_provider_events_fingerprint_idx" ON "billing_provider_events"("fingerprint");
CREATE INDEX "billing_provider_events_status_received_at_idx" ON "billing_provider_events"("status", "received_at");
CREATE UNIQUE INDEX "billing_usage_ledger_billing_account_id_metric_period_start_claim_key_key" ON "billing_usage_ledger"("billing_account_id", "metric", "period_start", "claim_key");
CREATE INDEX "billing_usage_ledger_billing_account_id_metric_period_start_period_end_idx" ON "billing_usage_ledger"("billing_account_id", "metric", "period_start", "period_end");
CREATE UNIQUE INDEX "billing_provider_cost_ledger_billing_account_id_logical_artifact_key_key" ON "billing_provider_cost_ledger"("billing_account_id", "logical_artifact_key");
CREATE INDEX "billing_provider_cost_ledger_billing_account_id_billing_period_start_idx" ON "billing_provider_cost_ledger"("billing_account_id", "billing_period_start");
CREATE UNIQUE INDEX "billing_outbox_dedupe_key_key" ON "billing_outbox"("dedupe_key");
CREATE INDEX "billing_outbox_dispatched_at_created_at_idx" ON "billing_outbox"("dispatched_at", "created_at");

ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_active_business_id_fkey"
  FOREIGN KEY ("active_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_price_id_fkey"
  FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id") ON UPDATE CASCADE;
ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_price_id_fkey"
  FOREIGN KEY ("price_id") REFERENCES "billing_prices"("id") ON UPDATE CASCADE;
ALTER TABLE "billing_payment_transactions" ADD CONSTRAINT "billing_payment_transactions_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_payment_transactions" ADD CONSTRAINT "billing_payment_transactions_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_payment_transactions" ADD CONSTRAINT "billing_payment_transactions_checkout_attempt_id_fkey"
  FOREIGN KEY ("checkout_attempt_id") REFERENCES "billing_checkout_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "billing_usage_ledger" ADD CONSTRAINT "billing_usage_ledger_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_provider_cost_ledger" ADD CONSTRAINT "billing_provider_cost_ledger_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_outbox" ADD CONSTRAINT "billing_outbox_billing_account_id_fkey"
  FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Issue #175 — Meta OAuth connection boundary, credential vault, and state store.
--
-- Adds:
--   publishing_credentials            encrypted credential vault records
--   publishing_provider_connections   owner-scoped Meta connections (one per Page)
--   publishing_connection_audit       non-sensitive connection lifecycle audit trail
--   meta_oauth_states                 single-use OAuth state (hash only)
--   publishing_targets.connection_id  FK to the owning provider connection
--   publishing_targets uniqueness     one target per (business, provider, channel, account)

-- CreateEnum
CREATE TYPE "PublishingConnectionState" AS ENUM ('PENDING_SELECTION', 'ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateTable
CREATE TABLE "publishing_credentials" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "provider" "PublishingTargetProvider" NOT NULL,
    "kind" TEXT NOT NULL,
    "key_version" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "provider_user_id" TEXT,
    "provider_account_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_provider_connections" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "PublishingTargetProvider" NOT NULL,
    "provider_identity" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "state" "PublishingConnectionState" NOT NULL DEFAULT 'PENDING_SELECTION',
    "requested_channel" TEXT,
    "requested_capability" TEXT NOT NULL DEFAULT 'static_image',
    "locale" TEXT,
    "return_path" TEXT,
    "fingerprint" TEXT,
    "user_credential_ref" UUID,
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publishing_provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishing_connection_audit" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "connection_id" UUID,
    "target_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publishing_connection_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_oauth_states" (
    "id" UUID NOT NULL,
    "state_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "locale" TEXT,
    "return_path" TEXT,
    "requested_channel" TEXT,
    "requested_capability" TEXT NOT NULL DEFAULT 'static_image',
    "fingerprint" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_oauth_states_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "publishing_targets" ADD COLUMN "connection_id" UUID;

-- CreateIndex
CREATE INDEX "publishing_credentials_business_id_idx" ON "publishing_credentials"("business_id");
CREATE INDEX "publishing_credentials_provider_account_id_idx" ON "publishing_credentials"("provider_account_id");
CREATE UNIQUE INDEX "publishing_provider_connections_business_id_provider_external_account_id_key" ON "publishing_provider_connections"("business_id", "provider", "external_account_id");
CREATE INDEX "publishing_provider_connections_business_id_state_idx" ON "publishing_provider_connections"("business_id", "state");
CREATE INDEX "publishing_connection_audit_business_id_created_at_idx" ON "publishing_connection_audit"("business_id", "created_at");
CREATE UNIQUE INDEX "meta_oauth_states_state_hash_key" ON "meta_oauth_states"("state_hash");
CREATE INDEX "meta_oauth_states_business_id_idx" ON "meta_oauth_states"("business_id");
CREATE INDEX "meta_oauth_states_expires_at_idx" ON "meta_oauth_states"("expires_at");
CREATE INDEX "publishing_targets_connection_id_idx" ON "publishing_targets"("connection_id");

-- Issue #175 uniqueness: the same provider/channel/external account cannot be
-- connected twice for one business.
CREATE UNIQUE INDEX "publishing_targets_business_id_provider_channel_external_account_id_key" ON "publishing_targets"("business_id", "provider", "channel", "external_account_id");

-- AddForeignKey
ALTER TABLE "publishing_credentials" ADD CONSTRAINT "publishing_credentials_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publishing_provider_connections" ADD CONSTRAINT "publishing_provider_connections_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publishing_connection_audit" ADD CONSTRAINT "publishing_connection_audit_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publishing_targets" ADD CONSTRAINT "publishing_targets_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "publishing_provider_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ActionTokenType" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

-- CreateTable
CREATE TABLE "action_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "ActionTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "raw_profile" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "federated_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_tokens_token_hash_key" ON "action_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "action_tokens_user_id_type_idx" ON "action_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "action_tokens_expires_at_idx" ON "action_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "federated_identities_user_id_idx" ON "federated_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "federated_identities_provider_provider_subject_key" ON "federated_identities"("provider", "provider_subject");

-- AddForeignKey
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "federated_identities" ADD CONSTRAINT "federated_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

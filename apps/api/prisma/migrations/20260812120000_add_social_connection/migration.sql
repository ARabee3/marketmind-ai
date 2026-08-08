-- Facebook Page connection (dev milestone): one connected Page per user.
--
-- The Page access token is stored reversibly encrypted (AES-256-GCM) — never
-- hashed — because the raw token is required for Graph API publish calls.
-- Token validity is checked reactively (at publish/test time); error code 190
-- marks the connection invalid and triggers the reconnect email.

-- CreateTable
CREATE TABLE "social_connections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'facebook',
    "page_id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "encryption_iv" TEXT NOT NULL,
    "auth_tag" TEXT NOT NULL,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_tested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_user_id_key" ON "social_connections"("user_id");

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

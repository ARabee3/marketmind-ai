-- Track the Facebook Page connection token expiry returned by the long-lived
-- token exchange (`expires_in`). Nullable: legacy rows predate the field and
-- connections that only carry `is_valid` still work.

-- AlterTable
ALTER TABLE "social_connections" ADD COLUMN "expires_at" TIMESTAMP(3);
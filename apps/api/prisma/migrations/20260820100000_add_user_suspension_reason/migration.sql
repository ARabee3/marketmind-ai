-- Keep the latest operator-provided suspension reason on the account so a
-- suspended owner receives the same explanation at sign-in.
ALTER TABLE "User" ADD COLUMN "suspension_reason" TEXT;

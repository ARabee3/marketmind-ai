-- Convert existing free-text status values to the future enum members before
-- changing the column type. Rows outside these three values are defensive no-ops.
UPDATE "User" SET "status" = 'ACTIVE' WHERE "status" = 'active';
UPDATE "User" SET "status" = 'SUSPENDED' WHERE "status" = 'suspended';
UPDATE "User" SET "status" = 'DISABLED' WHERE "status" = 'disabled';

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- The existing default is the text literal 'active', which cannot be cast to the
-- enum, so drop it before the type change and restore the enum-typed default.
ALTER TABLE "User" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "status" TYPE "UserStatus" USING ("status"::"UserStatus");
ALTER TABLE "User" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
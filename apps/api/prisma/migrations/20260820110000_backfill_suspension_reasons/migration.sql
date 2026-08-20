-- Preserve the latest operator-provided reason for already-suspended users.
-- The audit log predates the dedicated account field, so use its latest
-- suspension event as the initial value without reviving an older reason when
-- the latest suspension was recorded without one.
WITH latest_suspensions AS (
    SELECT DISTINCT ON ("target_id")
        "target_id",
        "reason"
    FROM "audit_logs"
    WHERE "action" = 'user.suspend'
      AND "target_type" = 'user'
      AND "target_id" IS NOT NULL
    ORDER BY "target_id", "created_at" DESC
)
UPDATE "User" AS u
SET "suspension_reason" = latest."reason"
FROM latest_suspensions AS latest
WHERE u."id"::text = latest."target_id"
  AND u."status" = 'SUSPENDED'
  AND u."suspension_reason" IS NULL
  AND latest."reason" IS NOT NULL;

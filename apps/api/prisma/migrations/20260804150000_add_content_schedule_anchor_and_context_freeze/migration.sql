-- Persist the immutable Week-1 Cairo calendar anchor. Existing rows are
-- backfilled from the old Week-2 cursor, with created_at as a safe fallback
-- for cycles that never had a cursor.
ALTER TABLE "content_cycles"
  ADD COLUMN "week_1_start_date" DATE;

UPDATE "content_cycles"
SET "week_1_start_date" = COALESCE(
  ("next_generation_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date - 7,
  ("created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date
);

ALTER TABLE "content_cycles"
  ALTER COLUMN "week_1_start_date" SET NOT NULL;

ALTER TABLE "content_cycles"
  ADD COLUMN "idempotency_fingerprint" TEXT;

ALTER TABLE "content_week_contexts"
  ADD COLUMN "frozen_at" TIMESTAMP(3);

-- Existing system defaults and contexts that already have a pack are already
-- claimed. Preserve that fact while leaving an owner-confirmed, packless row
-- open for the owner to refine.
UPDATE "content_week_contexts" AS context
SET "frozen_at" = COALESCE(
  (
    SELECT pack."created_at"
    FROM "content_packs" AS pack
    WHERE pack."week_context_id" = context."id"
    ORDER BY pack."created_at" ASC
    LIMIT 1
  ),
  context."system_defaulted_at",
  context."created_at"
)
WHERE context."context_source" = 'system_defaulted'
   OR EXISTS (
     SELECT 1
     FROM "content_packs" AS pack
     WHERE pack."week_context_id" = context."id"
   );

CREATE OR REPLACE FUNCTION prevent_content_cycle_anchor_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."week_1_start_date" IS DISTINCT FROM OLD."week_1_start_date" THEN
    RAISE EXCEPTION 'content cycle week_1_start_date is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_cycles_week_1_start_date_immutable
BEFORE UPDATE ON "content_cycles"
FOR EACH ROW
EXECUTE FUNCTION prevent_content_cycle_anchor_update();

CREATE OR REPLACE FUNCTION prevent_frozen_content_context_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."frozen_at" IS NOT NULL THEN
    IF NEW."frozen_at" IS DISTINCT FROM OLD."frozen_at"
       OR (to_jsonb(NEW) - 'frozen_at') IS DISTINCT FROM (to_jsonb(OLD) - 'frozen_at') THEN
      RAISE EXCEPTION 'frozen content week context is immutable';
    END IF;
  ELSIF NEW."frozen_at" IS NOT NULL
        AND (to_jsonb(NEW) - 'frozen_at') IS DISTINCT FROM (to_jsonb(OLD) - 'frozen_at') THEN
    RAISE EXCEPTION 'context fields must be frozen in a separate conditional update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER content_week_context_frozen_immutable
BEFORE UPDATE ON "content_week_contexts"
FOR EACH ROW
EXECUTE FUNCTION prevent_frozen_content_context_update();

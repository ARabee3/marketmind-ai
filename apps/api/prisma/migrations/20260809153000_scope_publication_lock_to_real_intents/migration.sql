-- Export and simulation are local actions: they must remain available before
-- or after the owner's one protected real-publication lifecycle. Keep the
-- duplicate/ambiguous-delivery safeguard for REAL mode only.
DROP INDEX IF EXISTS "publishing_intents_candidate_id_active_uniq";

CREATE UNIQUE INDEX "publishing_intents_candidate_id_active_uniq"
  ON "publishing_intents" ("candidate_id")
  WHERE
    "mode" = 'REAL'
    AND "status" IN (
      'DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'DISPATCHING',
      'SUCCEEDED', 'FAILED', 'ACTION_REQUIRED'
    );

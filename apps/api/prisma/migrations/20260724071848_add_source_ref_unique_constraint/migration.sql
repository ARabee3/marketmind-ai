-- AddUniqueConstraint
-- Enforces a DB-level guard against duplicate (entry_version_id, reference)
-- pairs on marketing_knowledge_source_refs, as flagged in PR #94 review.
-- Previously the seed needed a delete-then-create workaround specifically
-- because no such constraint existed; an upsert by the compound key is now
-- possible (see entryVersionId_reference in the Prisma client).
ALTER TABLE "marketing_knowledge_source_refs"
  ADD CONSTRAINT "uq_mksr_entry_version_reference"
    UNIQUE ("entry_version_id", "reference");
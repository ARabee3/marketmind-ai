ALTER TABLE "publication_candidate_outbox"
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "publication_candidate_outbox_lease_expires_at_idx"
  ON "publication_candidate_outbox"("lease_expires_at");

ALTER TABLE "content_decisions"
  ADD COLUMN "request_fingerprint" TEXT NOT NULL DEFAULT '';

ALTER TABLE "content_decisions"
  ALTER COLUMN "request_fingerprint" DROP DEFAULT;

CREATE UNIQUE INDEX "content_decisions_content_item_version_id_key"
  ON "content_decisions"("content_item_version_id");

CREATE UNIQUE INDEX "publication_candidates_content_item_version_id_key"
  ON "publication_candidates"("content_item_version_id");

-- AlterTable
-- Add a stable deterministic chunk_id to marketing_knowledge_chunks so that
-- the ingestion pipeline can store the same UUID used for Qdrant point IDs.
ALTER TABLE "marketing_knowledge_chunks" ADD COLUMN "chunk_id" UUID;

-- Backfill existing rows with the primary key so the NOT NULL unique
-- constraint can be applied safely. These rows were created before chunk_id
-- existed; using the generated id preserves uniqueness and is acceptable
-- only because no Qdrant points for them were created with a different id.
UPDATE "marketing_knowledge_chunks" SET "chunk_id" = "id";

-- Make chunk_id non-nullable and unique.
ALTER TABLE "marketing_knowledge_chunks" ALTER COLUMN "chunk_id" SET NOT NULL;
ALTER TABLE "marketing_knowledge_chunks" ADD CONSTRAINT "marketing_knowledge_chunks_chunk_id_key" UNIQUE ("chunk_id");

-- CreateIndex
CREATE INDEX "marketing_knowledge_chunks_chunk_id_idx" ON "marketing_knowledge_chunks"("chunk_id");

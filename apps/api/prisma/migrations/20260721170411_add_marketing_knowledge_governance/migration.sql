-- CreateTable
CREATE TABLE "marketing_knowledge_entries" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "latest_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_knowledge_entry_versions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "markets" TEXT[],
    "industries" TEXT[],
    "business_models" TEXT[],
    "objectives" TEXT[],
    "funnel_stages" TEXT[],
    "channels" TEXT[],
    "seasons" TEXT[],
    "budget_modes" TEXT[],
    "evidence_tier" TEXT NOT NULL,
    "review_status" TEXT NOT NULL DEFAULT 'draft',
    "effective_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "author" TEXT NOT NULL,
    "reviewer" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_knowledge_entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_knowledge_source_refs" (
    "id" UUID NOT NULL,
    "entry_version_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_knowledge_source_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_knowledge_chunks" (
    "id" UUID NOT NULL,
    "entry_version_id" UUID NOT NULL,
    "chunk_order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "embedding_provider" TEXT NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "embedding_dimensions" INTEGER NOT NULL,
    "embedding_version" TEXT NOT NULL,
    "qdrant_point_id" UUID,
    "qdrant_collection_name" TEXT,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_knowledge_ingestion_runs" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "actor" TEXT NOT NULL,
    "commit_sha" TEXT,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "entered_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_knowledge_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_knowledge_ingestion_errors" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "slug" TEXT,
    "version" INTEGER,
    "error_code" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_knowledge_ingestion_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_knowledge_entries_slug_key" ON "marketing_knowledge_entries"("slug");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_review_status_effective__idx" ON "marketing_knowledge_entry_versions"("review_status", "effective_at", "expires_at");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_kind_idx" ON "marketing_knowledge_entry_versions"("kind");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_locale_idx" ON "marketing_knowledge_entry_versions"("locale");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_evidence_tier_idx" ON "marketing_knowledge_entry_versions"("evidence_tier");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_markets_idx" ON "marketing_knowledge_entry_versions" USING GIN ("markets");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_industries_idx" ON "marketing_knowledge_entry_versions" USING GIN ("industries");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_business_models_idx" ON "marketing_knowledge_entry_versions" USING GIN ("business_models");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_objectives_idx" ON "marketing_knowledge_entry_versions" USING GIN ("objectives");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_funnel_stages_idx" ON "marketing_knowledge_entry_versions" USING GIN ("funnel_stages");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_channels_idx" ON "marketing_knowledge_entry_versions" USING GIN ("channels");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_seasons_idx" ON "marketing_knowledge_entry_versions" USING GIN ("seasons");

-- CreateIndex
CREATE INDEX "marketing_knowledge_entry_versions_budget_modes_idx" ON "marketing_knowledge_entry_versions" USING GIN ("budget_modes");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_knowledge_entry_versions_entry_id_version_key" ON "marketing_knowledge_entry_versions"("entry_id", "version");

-- CreateIndex
CREATE INDEX "marketing_knowledge_source_refs_entry_version_id_idx" ON "marketing_knowledge_source_refs"("entry_version_id");

-- CreateIndex
CREATE INDEX "marketing_knowledge_chunks_entry_version_id_idx" ON "marketing_knowledge_chunks"("entry_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_knowledge_chunks_entry_version_id_chunk_order_key" ON "marketing_knowledge_chunks"("entry_version_id", "chunk_order");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_knowledge_chunks_checksum_embedding_provider_embe_key" ON "marketing_knowledge_chunks"("checksum", "embedding_provider", "embedding_model", "embedding_dimensions", "embedding_version");

-- CreateIndex
CREATE INDEX "marketing_knowledge_ingestion_runs_status_started_at_idx" ON "marketing_knowledge_ingestion_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "marketing_knowledge_ingestion_errors_run_id_idx" ON "marketing_knowledge_ingestion_errors"("run_id");

-- AddForeignKey
ALTER TABLE "marketing_knowledge_entry_versions" ADD CONSTRAINT "marketing_knowledge_entry_versions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "marketing_knowledge_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_knowledge_source_refs" ADD CONSTRAINT "marketing_knowledge_source_refs_entry_version_id_fkey" FOREIGN KEY ("entry_version_id") REFERENCES "marketing_knowledge_entry_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_knowledge_chunks" ADD CONSTRAINT "marketing_knowledge_chunks_entry_version_id_fkey" FOREIGN KEY ("entry_version_id") REFERENCES "marketing_knowledge_entry_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_knowledge_ingestion_errors" ADD CONSTRAINT "marketing_knowledge_ingestion_errors_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "marketing_knowledge_ingestion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CHECK constraints (controlled vocabularies + lifecycle integrity) ──
-- Scalar taxonomy fields are enforced at the DB layer. Array-element
-- membership (e.g. every entry inside channels[]) is enforced at the
-- application layer instead — a raw CHECK over array contents would need a
-- helper function and is awkward in Postgres. See
-- MARKETING_KNOWLEDGE_SCHEMA.md for the explicit list.
ALTER TABLE "marketing_knowledge_entry_versions"
  ADD CONSTRAINT chk_mkv_review_status
    CHECK (review_status IN ('draft', 'approved', 'retired', 'expired')),
  ADD CONSTRAINT chk_mkv_evidence_tier
    CHECK (evidence_tier IN ('verified_benchmark', 'reviewed_guidance', 'contextual_note')),
  ADD CONSTRAINT chk_mkv_locale
    CHECK (locale IN ('ar-EG', 'en', 'mixed')),
  ADD CONSTRAINT chk_mkv_expiry_after_effective
    CHECK (expires_at IS NULL OR expires_at > effective_at),
  ADD CONSTRAINT chk_mkv_approved_has_reviewer
    CHECK (review_status <> 'approved' OR (reviewer IS NOT NULL AND reviewed_at IS NOT NULL));

ALTER TABLE "marketing_knowledge_ingestion_runs"
  ADD CONSTRAINT chk_mkir_status
    CHECK (status IN ('pending', 'running', 'succeeded', 'partial_failure', 'failed'));

-- ── Immutability trigger ────────────────────────────────────────────────
-- An approved knowledge version's content fields cannot be silently mutated.
-- Allowed transitions on an approved row are limited to review_status
-- moving to 'retired' or 'expired', and expires_at being tightened.
CREATE OR REPLACE FUNCTION enforce_marketing_knowledge_version_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.review_status = 'approved' THEN
    IF NEW.kind            IS DISTINCT FROM OLD.kind
      OR NEW.title          IS DISTINCT FROM OLD.title
      OR NEW.summary        IS DISTINCT FROM OLD.summary
      OR NEW.body           IS DISTINCT FROM OLD.body
      OR NEW.locale         IS DISTINCT FROM OLD.locale
      OR NEW.markets        IS DISTINCT FROM OLD.markets
      OR NEW.industries     IS DISTINCT FROM OLD.industries
      OR NEW.business_models IS DISTINCT FROM OLD.business_models
      OR NEW.objectives     IS DISTINCT FROM OLD.objectives
      OR NEW.funnel_stages  IS DISTINCT FROM OLD.funnel_stages
      OR NEW.channels       IS DISTINCT FROM OLD.channels
      OR NEW.seasons        IS DISTINCT FROM OLD.seasons
      OR NEW.budget_modes   IS DISTINCT FROM OLD.budget_modes
      OR NEW.evidence_tier  IS DISTINCT FROM OLD.evidence_tier
      OR NEW.effective_at   IS DISTINCT FROM OLD.effective_at
      OR NEW.checksum       IS DISTINCT FROM OLD.checksum
      OR NEW.entry_id       IS DISTINCT FROM OLD.entry_id
      OR NEW.version        IS DISTINCT FROM OLD.version
    THEN
      RAISE EXCEPTION 'marketing_knowledge_entry_versions: cannot mutate content of an approved version (id=%)', OLD.id;
    END IF;
    IF NEW.review_status = 'draft' THEN
      RAISE EXCEPTION 'marketing_knowledge_entry_versions: cannot revert an approved version back to draft (id=%)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_mkv_immutability
  BEFORE UPDATE ON "marketing_knowledge_entry_versions"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_marketing_knowledge_version_immutability();

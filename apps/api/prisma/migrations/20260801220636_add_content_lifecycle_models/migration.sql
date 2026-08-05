-- CreateTable
CREATE TABLE "content_cycles" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v1',
    "business_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "strategy_version" INTEGER NOT NULL,
    "strategy_decision_id" UUID NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "current_week_number" INTEGER NOT NULL DEFAULT 1,
    "next_generation_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo',
    "pause_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "owner_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_week_contexts" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v1',
    "content_cycle_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "week_start_date" DATE NOT NULL,
    "promotion_mode" TEXT NOT NULL,
    "promotion" JSONB,
    "must_include" JSONB NOT NULL DEFAULT '[]',
    "must_avoid" JSONB NOT NULL DEFAULT '[]',
    "approved_asset_ids" JSONB NOT NULL DEFAULT '[]',
    "cta_destination" JSONB,
    "generation_cutoff_at" TIMESTAMP(3) NOT NULL,
    "weekly_claim_id" UUID NOT NULL,
    "context_source" TEXT NOT NULL,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMP(3),
    "system_defaulted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_week_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_packs" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v1',
    "content_cycle_id" UUID NOT NULL,
    "weekly_claim_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "business_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "strategy_version" INTEGER NOT NULL,
    "strategy_decision_id" UUID NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "week_context_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "retry_eligible" BOOLEAN NOT NULL DEFAULT true,
    "item_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "content_pack_id" UUID NOT NULL,
    "current_version_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_item_versions" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v1',
    "content_item_id" UUID NOT NULL,
    "content_pack_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "language_mode" TEXT NOT NULL,
    "strategy_trace" JSONB NOT NULL,
    "caption_variants" JSONB NOT NULL,
    "cta" TEXT,
    "hashtags" JSONB NOT NULL,
    "creative_brief" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,
    "short_video_script" JSONB,
    "recommended_publish_window" JSONB NOT NULL,
    "claim_sources" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "blockers" JSONB NOT NULL,
    "asset_required" BOOLEAN NOT NULL,
    "asset_ids" JSONB NOT NULL,
    "generation_provenance" JSONB NOT NULL,
    "version_checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_item_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_assets" (
    "id" UUID NOT NULL,
    "content_item_version_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mime_type" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "storage_key" TEXT,
    "checksum" TEXT,
    "alt_text" TEXT NOT NULL,
    "provider_name" TEXT,
    "provider_model" TEXT,
    "provider_request_id" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_generation_runs" (
    "id" UUID NOT NULL,
    "content_pack_id" UUID NOT NULL,
    "content_cycle_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "run_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_name" TEXT,
    "provider_model" TEXT,
    "input_hash" TEXT,
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_generation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_progress_events" (
    "id" BIGSERIAL NOT NULL,
    "content_pack_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message_key" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_progress_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_decisions" (
    "id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "content_item_version_id" UUID NOT NULL,
    "content_item_version" INTEGER NOT NULL,
    "content_item_version_checksum" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "revision_notes" TEXT,
    "decided_by_user_id" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_candidates" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v1',
    "payload" JSONB NOT NULL,
    "candidate_checksum" TEXT NOT NULL,
    "content_cycle_id" UUID NOT NULL,
    "content_pack_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "content_item_version_id" UUID NOT NULL,
    "content_item_version" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_candidate_statuses" (
    "id" BIGSERIAL NOT NULL,
    "candidate_id" UUID NOT NULL,
    "candidate_checksum" TEXT NOT NULL,
    "state_version" INTEGER NOT NULL,
    "candidate_state" TEXT NOT NULL,
    "replacement_candidate_id" UUID,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_candidate_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_candidate_outbox" (
    "id" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "correlation_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),

    CONSTRAINT "publication_candidate_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_cycles_business_id_idx" ON "content_cycles"("business_id");

-- CreateIndex
CREATE INDEX "content_cycles_strategy_id_strategy_version_idx" ON "content_cycles"("strategy_id", "strategy_version");

-- CreateIndex
CREATE UNIQUE INDEX "content_cycles_owner_user_id_idempotency_key_key" ON "content_cycles"("owner_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "content_week_contexts_content_cycle_id_idx" ON "content_week_contexts"("content_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_week_contexts_content_cycle_id_week_number_key" ON "content_week_contexts"("content_cycle_id", "week_number");

-- CreateIndex
CREATE INDEX "content_packs_content_cycle_id_idx" ON "content_packs"("content_cycle_id");

-- CreateIndex
CREATE INDEX "content_packs_status_idx" ON "content_packs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "content_packs_content_cycle_id_week_number_key" ON "content_packs"("content_cycle_id", "week_number");

-- CreateIndex
CREATE INDEX "content_items_content_pack_id_idx" ON "content_items"("content_pack_id");

-- CreateIndex
CREATE INDEX "content_item_versions_content_pack_id_idx" ON "content_item_versions"("content_pack_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_item_versions_content_item_id_version_key" ON "content_item_versions"("content_item_id", "version");

-- CreateIndex
CREATE INDEX "content_assets_content_item_version_id_idx" ON "content_assets"("content_item_version_id");

-- CreateIndex
CREATE INDEX "content_assets_checksum_idx" ON "content_assets"("checksum");

-- CreateIndex
CREATE INDEX "content_generation_runs_content_pack_id_idx" ON "content_generation_runs"("content_pack_id");

-- CreateIndex
CREATE INDEX "content_generation_runs_status_idx" ON "content_generation_runs"("status");

-- CreateIndex
CREATE INDEX "content_progress_events_content_pack_id_created_at_idx" ON "content_progress_events"("content_pack_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_progress_events_content_pack_id_seq_key" ON "content_progress_events"("content_pack_id", "seq");

-- CreateIndex
CREATE INDEX "content_decisions_content_item_id_idx" ON "content_decisions"("content_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_decisions_owner_user_id_idempotency_key_key" ON "content_decisions"("owner_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "publication_candidates_candidate_id_key" ON "publication_candidates"("candidate_id");

-- CreateIndex
CREATE INDEX "publication_candidates_business_id_idx" ON "publication_candidates"("business_id");

-- CreateIndex
CREATE INDEX "publication_candidates_content_item_version_id_idx" ON "publication_candidates"("content_item_version_id");

-- CreateIndex
CREATE INDEX "publication_candidate_statuses_candidate_id_idx" ON "publication_candidate_statuses"("candidate_id");

-- CreateIndex
CREATE UNIQUE INDEX "publication_candidate_statuses_candidate_id_state_version_key" ON "publication_candidate_statuses"("candidate_id", "state_version");

-- CreateIndex
CREATE UNIQUE INDEX "publication_candidate_outbox_event_id_key" ON "publication_candidate_outbox"("event_id");

-- CreateIndex
CREATE INDEX "publication_candidate_outbox_state_next_attempt_at_idx" ON "publication_candidate_outbox"("state", "next_attempt_at");

-- CreateIndex
CREATE INDEX "publication_candidate_outbox_candidate_id_idx" ON "publication_candidate_outbox"("candidate_id");

-- AddForeignKey
ALTER TABLE "content_cycles" ADD CONSTRAINT "content_cycles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_cycles" ADD CONSTRAINT "content_cycles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_cycles" ADD CONSTRAINT "content_cycles_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "business_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_week_contexts" ADD CONSTRAINT "content_week_contexts_content_cycle_id_fkey" FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_week_contexts" ADD CONSTRAINT "content_week_contexts_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_content_cycle_id_fkey" FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_week_context_id_fkey" FOREIGN KEY ("week_context_id") REFERENCES "content_week_contexts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "business_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_item_version_id_fkey" FOREIGN KEY ("content_item_version_id") REFERENCES "content_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_generation_runs" ADD CONSTRAINT "content_generation_runs_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_generation_runs" ADD CONSTRAINT "content_generation_runs_content_cycle_id_fkey" FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_progress_events" ADD CONSTRAINT "content_progress_events_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_decisions" ADD CONSTRAINT "content_decisions_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_decisions" ADD CONSTRAINT "content_decisions_content_item_version_id_fkey" FOREIGN KEY ("content_item_version_id") REFERENCES "content_item_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_decisions" ADD CONSTRAINT "content_decisions_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_decisions" ADD CONSTRAINT "content_decisions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_candidates" ADD CONSTRAINT "publication_candidates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_candidates" ADD CONSTRAINT "publication_candidates_content_cycle_id_fkey" FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_candidates" ADD CONSTRAINT "publication_candidates_content_pack_id_fkey" FOREIGN KEY ("content_pack_id") REFERENCES "content_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_candidate_statuses" ADD CONSTRAINT "publication_candidate_statuses_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "publication_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_candidate_statuses" ADD CONSTRAINT "publication_candidate_statuses_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

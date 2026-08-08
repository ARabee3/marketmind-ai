-- Issue #187: Content v2 owner-first weekly studio domain.
-- New v2 cycles write contract_version "content-v2"; legacy v1 rows keep
-- "content-v1" and are never reinterpreted. New item-version columns are
-- nullable so historical v1 versions stay untouched.

-- 1. ContentItemVersion gains immutable edit metadata (v2 only).
ALTER TABLE "content_item_versions" ADD COLUMN "edit_kind" TEXT;
ALTER TABLE "content_item_versions" ADD COLUMN "base_version_id" UUID;
ALTER TABLE "content_item_versions" ADD COLUMN "base_version_checksum" TEXT;
ALTER TABLE "content_item_versions" ADD COLUMN "edited_by_user_id" UUID;
ALTER TABLE "content_item_versions" ADD COLUMN "validation_state" TEXT;
ALTER TABLE "content_item_versions" ADD COLUMN "edited_at" TIMESTAMP(3);

-- 2. ContentPack optionally links to the v2 week plan it was claimed from.
ALTER TABLE "content_packs" ADD COLUMN "week_plan_id" UUID;

-- 3. New v2 tables.
-- CreateTable
CREATE TABLE "content_editorial_profiles" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v2',
    "content_cycle_id" UUID NOT NULL,
    "audience_nuance" TEXT NOT NULL,
    "voice" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'ar-EG',
    "writing_guardrails" JSONB NOT NULL DEFAULT '[]',
    "default_visual_guidance" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_editorial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_cta_library_entries" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v2',
    "content_cycle_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "destination" JSONB NOT NULL,
    "campaign_context" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_cta_library_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media_library_entries" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v2',
    "business_id" UUID NOT NULL,
    "content_cycle_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "storage_key" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_media_library_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_week_plans" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v2',
    "content_cycle_id" UUID NOT NULL,
    "week_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "frozen_input" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_week_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_post_plans" (
    "id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL DEFAULT 'content-v2',
    "content_week_plan_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "intended_audience" TEXT,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "cta_library_entry_id" UUID,
    "owner_instructions" TEXT,
    "visual_direction" TEXT,
    "selected_media_ids" JSONB NOT NULL DEFAULT '[]',
    "plan_state" TEXT NOT NULL DEFAULT 'planned',
    "source" TEXT NOT NULL,
    "content_item_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_post_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_editorial_profiles_content_cycle_id_key"
    ON "content_editorial_profiles"("content_cycle_id");

-- CreateIndex
CREATE INDEX "content_cta_library_entries_content_cycle_id_idx"
    ON "content_cta_library_entries"("content_cycle_id");

-- CreateIndex
CREATE INDEX "content_media_library_entries_business_id_idx"
    ON "content_media_library_entries"("business_id");

-- CreateIndex
CREATE INDEX "content_media_library_entries_content_cycle_id_idx"
    ON "content_media_library_entries"("content_cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_week_plans_content_cycle_id_week_number_key"
    ON "content_week_plans"("content_cycle_id", "week_number");

-- CreateIndex
CREATE UNIQUE INDEX "content_post_plans_content_week_plan_id_position_key"
    ON "content_post_plans"("content_week_plan_id", "position");

-- CreateIndex
CREATE INDEX "content_post_plans_content_week_plan_id_idx"
    ON "content_post_plans"("content_week_plan_id");

-- CreateIndex
CREATE INDEX "content_item_versions_base_version_id_idx"
    ON "content_item_versions"("base_version_id");

-- AddForeignKey
ALTER TABLE "content_packs"
    ADD CONSTRAINT "content_packs_week_plan_id_fkey"
    FOREIGN KEY ("week_plan_id") REFERENCES "content_week_plans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_editorial_profiles"
    ADD CONSTRAINT "content_editorial_profiles_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_cta_library_entries"
    ADD CONSTRAINT "content_cta_library_entries_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media_library_entries"
    ADD CONSTRAINT "content_media_library_entries_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media_library_entries"
    ADD CONSTRAINT "content_media_library_entries_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_media_library_entries"
    ADD CONSTRAINT "content_media_library_entries_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_week_plans"
    ADD CONSTRAINT "content_week_plans_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_plans"
    ADD CONSTRAINT "content_post_plans_content_week_plan_id_fkey"
    FOREIGN KEY ("content_week_plan_id") REFERENCES "content_week_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

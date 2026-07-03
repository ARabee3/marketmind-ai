ALTER TABLE "discovery_sessions"
ADD COLUMN "profile_state" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "owner_turn_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "completion_reason" TEXT;

ALTER TABLE "business_profile_drafts"
ADD COLUMN "completeness" TEXT NOT NULL DEFAULT 'incomplete',
ADD COLUMN "completion_reason" TEXT NOT NULL DEFAULT 'owner_finished_early',
ADD COLUMN "readiness" JSONB NOT NULL DEFAULT '{}';

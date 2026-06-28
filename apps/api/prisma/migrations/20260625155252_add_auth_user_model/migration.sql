-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER_DEMO');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY['OWNER']::"Role"[],
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "refreshToken" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "fullName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "preferredLocale" TEXT NOT NULL DEFAULT 'ar-EG',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" "Role" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "address_text" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "primary_locale" TEXT NOT NULL DEFAULT 'ar-EG',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_sessions" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "language_mode" TEXT NOT NULL DEFAULT 'mixed',
    "current_question" TEXT,
    "profile_draft_id" UUID,
    "confirmed_profile_version_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepared_discovery_intakes" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "address_text" TEXT,
    "owner_goal_text" TEXT,
    "known_competitors_text" TEXT,
    "target_audience_text" TEXT,
    "notes" TEXT,
    "raw_payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prepared_discovery_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_links" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "business_id" UUID,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "owner_submitted" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "search_mode" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_refs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "intelligence_run_id" UUID,
    "source_type" TEXT NOT NULL,
    "platform" TEXT,
    "url" TEXT,
    "title" TEXT,
    "snippet" TEXT,
    "fetched_at" TIMESTAMP(3),
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_observations" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_ref_id" UUID,
    "kind" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "discard_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_hooks" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "source_observation_id" UUID,
    "hook_text" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'mixed',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_gaps" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "question_hint" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_messages" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'mixed',
    "source" TEXT NOT NULL DEFAULT 'chat',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profile_drafts" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "business_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "confirmed_facts" JSONB NOT NULL DEFAULT '{}',
    "research_observations" JSONB NOT NULL DEFAULT '[]',
    "uncertainties" JSONB NOT NULL DEFAULT '[]',
    "owner_goals" JSONB NOT NULL DEFAULT '[]',
    "strategy_relevant_notes" JSONB NOT NULL DEFAULT '[]',
    "raw_ai_output" JSONB NOT NULL DEFAULT '{}',
    "created_by_agent_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profile_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profile_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "draft_id" UUID,
    "version" INTEGER NOT NULL,
    "profile" JSONB NOT NULL,
    "confirmed_by_user_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "session_id" UUID,
    "run_type" TEXT NOT NULL,
    "provider_mode" TEXT NOT NULL,
    "model_name" TEXT,
    "prompt_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input_hash" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "output_json" JSONB NOT NULL DEFAULT '{}',
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_progress_events" (
    "id" BIGSERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message_key" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_progress_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE INDEX "businesses_owner_user_id_idx" ON "businesses"("owner_user_id");

-- CreateIndex
CREATE INDEX "businesses_city_area_idx" ON "businesses"("city", "area");

-- CreateIndex
CREATE INDEX "discovery_sessions_owner_user_id_status_idx" ON "discovery_sessions"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "discovery_sessions_business_id_idx" ON "discovery_sessions"("business_id");

-- CreateIndex
CREATE INDEX "discovery_sessions_created_at_idx" ON "discovery_sessions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prepared_discovery_intakes_session_id_key" ON "prepared_discovery_intakes"("session_id");

-- CreateIndex
CREATE INDEX "social_links_session_id_platform_idx" ON "social_links"("session_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_links_session_id_url_key" ON "social_links"("session_id", "url");

-- CreateIndex
CREATE INDEX "intelligence_runs_session_id_idx" ON "intelligence_runs"("session_id");

-- CreateIndex
CREATE INDEX "intelligence_runs_status_idx" ON "intelligence_runs"("status");

-- CreateIndex
CREATE INDEX "source_refs_session_id_idx" ON "source_refs"("session_id");

-- CreateIndex
CREATE INDEX "source_refs_confidence_idx" ON "source_refs"("confidence");

-- CreateIndex
CREATE INDEX "source_refs_url_idx" ON "source_refs"("url");

-- CreateIndex
CREATE INDEX "research_observations_session_id_status_idx" ON "research_observations"("session_id", "status");

-- CreateIndex
CREATE INDEX "research_observations_kind_idx" ON "research_observations"("kind");

-- CreateIndex
CREATE INDEX "conversation_hooks_session_id_status_idx" ON "conversation_hooks"("session_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_gaps_session_id_status_priority_idx" ON "knowledge_gaps"("session_id", "status", "priority");

-- CreateIndex
CREATE INDEX "discovery_messages_session_id_created_at_idx" ON "discovery_messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "business_profile_drafts_session_id_status_idx" ON "business_profile_drafts"("session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_profile_drafts_session_id_version_key" ON "business_profile_drafts"("session_id", "version");

-- CreateIndex
CREATE INDEX "business_profile_versions_business_id_idx" ON "business_profile_versions"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_profile_versions_business_id_version_key" ON "business_profile_versions"("business_id", "version");

-- CreateIndex
CREATE INDEX "agent_runs_session_id_idx" ON "agent_runs"("session_id");

-- CreateIndex
CREATE INDEX "agent_runs_run_type_status_idx" ON "agent_runs"("run_type", "status");

-- CreateIndex
CREATE INDEX "agent_runs_created_at_idx" ON "agent_runs"("created_at");

-- CreateIndex
CREATE INDEX "discovery_progress_events_session_id_created_at_idx" ON "discovery_progress_events"("session_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_progress_events_session_id_seq_key" ON "discovery_progress_events"("session_id", "seq");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prepared_discovery_intakes" ADD CONSTRAINT "prepared_discovery_intakes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_links" ADD CONSTRAINT "social_links_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_links" ADD CONSTRAINT "social_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_runs" ADD CONSTRAINT "intelligence_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_refs" ADD CONSTRAINT "source_refs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_refs" ADD CONSTRAINT "source_refs_intelligence_run_id_fkey" FOREIGN KEY ("intelligence_run_id") REFERENCES "intelligence_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_observations" ADD CONSTRAINT "research_observations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_observations" ADD CONSTRAINT "research_observations_source_ref_id_fkey" FOREIGN KEY ("source_ref_id") REFERENCES "source_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_hooks" ADD CONSTRAINT "conversation_hooks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_hooks" ADD CONSTRAINT "conversation_hooks_source_observation_id_fkey" FOREIGN KEY ("source_observation_id") REFERENCES "research_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_messages" ADD CONSTRAINT "discovery_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_drafts" ADD CONSTRAINT "business_profile_drafts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_drafts" ADD CONSTRAINT "business_profile_drafts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_drafts" ADD CONSTRAINT "business_profile_drafts_created_by_agent_run_id_fkey" FOREIGN KEY ("created_by_agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_versions" ADD CONSTRAINT "business_profile_versions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_versions" ADD CONSTRAINT "business_profile_versions_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "business_profile_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profile_versions" ADD CONSTRAINT "business_profile_versions_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_progress_events" ADD CONSTRAINT "discovery_progress_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

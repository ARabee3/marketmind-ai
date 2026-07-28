-- CreateTable
CREATE TABLE "strategies" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'needs_brief',
    "current_version_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_briefs" (
    "id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "business_profile_version_id" UUID NOT NULL,
    "primary_objective" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "plan_language" TEXT NOT NULL,
    "paid_media_allowed" BOOLEAN NOT NULL,
    "external_budget_mode" TEXT NOT NULL,
    "team_capacity" TEXT NOT NULL,
    "constraints" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_versions" (
    "id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "retrieval_run_id" UUID,
    "prompt_config" JSONB NOT NULL DEFAULT '{}',
    "plan_data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_decisions" (
    "id" UUID NOT NULL,
    "strategy_version_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategies_business_id_idx" ON "strategies"("business_id");

-- CreateIndex
CREATE INDEX "strategies_owner_user_id_idx" ON "strategies"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_briefs_strategy_id_key" ON "strategy_briefs"("strategy_id");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_versions_strategy_id_version_key" ON "strategy_versions"("strategy_id", "version");

-- AddForeignKey
ALTER TABLE "strategy_retrieval_runs" ADD CONSTRAINT "strategy_retrieval_runs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_retrieval_runs" ADD CONSTRAINT "strategy_retrieval_runs_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "strategy_briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_retrieval_runs" ADD CONSTRAINT "strategy_retrieval_runs_profile_version_id_fkey" FOREIGN KEY ("profile_version_id") REFERENCES "business_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_briefs" ADD CONSTRAINT "strategy_briefs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_briefs" ADD CONSTRAINT "strategy_briefs_business_profile_version_id_fkey" FOREIGN KEY ("business_profile_version_id") REFERENCES "business_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_decisions" ADD CONSTRAINT "strategy_decisions_strategy_version_id_fkey" FOREIGN KEY ("strategy_version_id") REFERENCES "strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_decisions" ADD CONSTRAINT "strategy_decisions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE

-- CreateTable
CREATE TABLE "strategy_progress_events" (
    "id" BIGSERIES NOT NULL,
    "strategy_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message_key" TEXT NOT NULL,
    "message_text" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_progress_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_progress_events_strategy_id_seq_key" ON "strategy_progress_events"("strategy_id", "seq");

-- CreateIndex
CREATE INDEX "strategy_progress_events_strategy_id_created_at_idx" ON "strategy_progress_events"("strategy_id", "created_at");

-- AddForeignKey
ALTER TABLE "strategy_progress_events" ADD CONSTRAINT "strategy_progress_events_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;;

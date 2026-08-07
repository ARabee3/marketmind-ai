-- CreateTable
CREATE TABLE "orchestration_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "contract_version" TEXT NOT NULL,
    "graph_name" TEXT NOT NULL,
    "graph_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_role" TEXT,
    "current_stage" TEXT NOT NULL,
    "feature_cohort" TEXT NOT NULL,
    "checkpoint_thread_id" TEXT NOT NULL,
    "checkpoint_version" INTEGER,
    "immutable_input_refs" JSONB NOT NULL DEFAULT '{}',
    "output_refs" JSONB NOT NULL DEFAULT '{}',
    "bounds" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "idempotency_fingerprint" TEXT NOT NULL,
    "terminal_error" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orchestration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "contract_version" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "current_role" TEXT,
    "current_stage" TEXT NOT NULL,
    "node" TEXT,
    "tool" TEXT,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orchestration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_runs_checkpoint_thread_id_key"
    ON "orchestration_runs"("checkpoint_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_runs_owner_user_id_idempotency_key_key"
    ON "orchestration_runs"("owner_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "orchestration_runs_business_id_status_idx"
    ON "orchestration_runs"("business_id", "status");

-- CreateIndex
CREATE INDEX "orchestration_runs_owner_user_id_status_idx"
    ON "orchestration_runs"("owner_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orchestration_events_run_id_seq_key"
    ON "orchestration_events"("run_id", "seq");

-- CreateIndex
CREATE INDEX "orchestration_events_run_id_created_at_idx"
    ON "orchestration_events"("run_id", "created_at");

-- AddForeignKey
ALTER TABLE "orchestration_runs"
    ADD CONSTRAINT "orchestration_runs_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_runs"
    ADD CONSTRAINT "orchestration_runs_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orchestration_events"
    ADD CONSTRAINT "orchestration_events_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "orchestration_runs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

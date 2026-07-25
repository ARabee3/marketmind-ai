-- CreateTable
CREATE TABLE "strategy_retrieval_runs" (
    "id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "brief_id" UUID NOT NULL,
    "profile_version_id" UUID NOT NULL,
    "query_summary" TEXT NOT NULL,
    "query_context" JSONB NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "gap_count" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_retrieval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_retrieval_items" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "entry_version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '{}',
    "relevance_score" DOUBLE PRECISION NOT NULL,
    "evidence_tier" TEXT NOT NULL,
    "source_references" TEXT[],
    "effective_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "review_status" TEXT NOT NULL,
    "market_tier" TEXT NOT NULL,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "fallback_label" TEXT,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_retrieval_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_retrieval_gaps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,

    CONSTRAINT "strategy_retrieval_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategy_retrieval_runs_strategy_id_created_at_idx" ON "strategy_retrieval_runs"("strategy_id", "created_at");

-- CreateIndex
CREATE INDEX "strategy_retrieval_items_run_id_idx" ON "strategy_retrieval_items"("run_id");

-- CreateIndex
CREATE INDEX "strategy_retrieval_items_chunk_id_idx" ON "strategy_retrieval_items"("chunk_id");

-- CreateIndex
CREATE INDEX "strategy_retrieval_gaps_run_id_idx" ON "strategy_retrieval_gaps"("run_id");

-- AddForeignKey
ALTER TABLE "strategy_retrieval_items" ADD CONSTRAINT "strategy_retrieval_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "strategy_retrieval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_retrieval_gaps" ADD CONSTRAINT "strategy_retrieval_gaps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "strategy_retrieval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_mksr_entry_version_reference" RENAME TO "marketing_knowledge_source_refs_entry_version_id_reference_key";

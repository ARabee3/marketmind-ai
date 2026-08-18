-- Optimization v1: deterministic, immutable, owner-pending Facebook
-- recommendations. No provider payloads or credentials are persisted.

CREATE TABLE "optimization_proposals" (
    "id" UUID NOT NULL,
    "contract_version" VARCHAR(64) NOT NULL DEFAULT 'optimization-v1',
    "business_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "strategy_version" INTEGER NOT NULL,
    "content_cycle_id" UUID NOT NULL,
    "format_cohort" VARCHAR(64) NOT NULL,
    "basis_snapshot_ids" JSONB NOT NULL,
    "evidence_checksum" TEXT NOT NULL,
    "deterministic_comparison" JSONB NOT NULL,
    "change_kind" VARCHAR(32) NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "uncertainty" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "model_version" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "generation_fingerprint" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING_OWNER_DECISION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optimization_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "optimization_proposals_contract_version_check" CHECK ("contract_version" = 'optimization-v1'),
    CONSTRAINT "optimization_proposals_strategy_version_check" CHECK ("strategy_version" > 0),
    CONSTRAINT "optimization_proposals_format_check" CHECK ("format_cohort" IN ('text_post', 'static_image_post')),
    CONSTRAINT "optimization_proposals_change_kind_check" CHECK ("change_kind" IN ('hook_style', 'cta_wording_style')),
    CONSTRAINT "optimization_proposals_status_check" CHECK ("status" = 'PENDING_OWNER_DECISION'),
    CONSTRAINT "optimization_proposals_prompt_version_check" CHECK ("prompt_version" = 'optimization-prompt-v1'),
    CONSTRAINT "optimization_proposals_evidence_checksum_check" CHECK ("evidence_checksum" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "optimization_proposals_generation_fingerprint_check" CHECK ("generation_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "optimization_proposals_snapshot_ids_check" CHECK (
        jsonb_typeof("basis_snapshot_ids") = 'array'
        AND jsonb_array_length("basis_snapshot_ids") >= 3
    ),
    CONSTRAINT "optimization_proposals_comparison_check" CHECK (
        jsonb_typeof("deterministic_comparison") = 'array'
        AND jsonb_array_length("deterministic_comparison") = 2
    )
);

CREATE UNIQUE INDEX "optimization_proposals_business_id_generation_fingerprint_key"
    ON "optimization_proposals"("business_id", "generation_fingerprint");
CREATE INDEX "optimization_proposals_business_id_status_created_at_idx"
    ON "optimization_proposals"("business_id", "status", "created_at");
CREATE INDEX "optimization_proposals_content_cycle_id_strategy_id_strategy_version_idx"
    ON "optimization_proposals"("content_cycle_id", "strategy_id", "strategy_version");

ALTER TABLE "optimization_proposals"
    ADD CONSTRAINT "optimization_proposals_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "optimization_proposals"
    ADD CONSTRAINT "optimization_proposals_strategy_id_fkey"
    FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "optimization_proposals"
    ADD CONSTRAINT "optimization_proposals_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_optimization_proposal_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'optimization_proposals are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "optimization_proposals_immutable"
BEFORE UPDATE OR DELETE ON "optimization_proposals"
FOR EACH ROW EXECUTE FUNCTION "prevent_optimization_proposal_mutation"();

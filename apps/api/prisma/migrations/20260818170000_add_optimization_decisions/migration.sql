-- Optimization 2: immutable owner decisions and one-time approved guidance.
-- The proposal row stays immutable; these records add the terminal decision
-- and the forward-only consumption boundary used by Content V2.

CREATE TABLE "optimization_decisions" (
    "id" UUID NOT NULL,
    "contract_version" VARCHAR(64) NOT NULL DEFAULT 'optimization-decision-v1',
    "proposal_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "strategy_version" INTEGER NOT NULL,
    "content_cycle_id" UUID NOT NULL,
    "format_cohort" VARCHAR(64) NOT NULL,
    "evidence_checksum" TEXT NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "note" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optimization_decisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "optimization_decisions_contract_version_check" CHECK ("contract_version" = 'optimization-decision-v1'),
    CONSTRAINT "optimization_decisions_strategy_version_check" CHECK ("strategy_version" > 0),
    CONSTRAINT "optimization_decisions_format_check" CHECK ("format_cohort" IN ('text_post', 'static_image_post')),
    CONSTRAINT "optimization_decisions_action_check" CHECK ("action" IN ('approve', 'dismiss')),
    CONSTRAINT "optimization_decisions_evidence_checksum_check" CHECK ("evidence_checksum" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "optimization_decisions_request_fingerprint_check" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "optimization_decisions_idempotency_key_length_check" CHECK (char_length("idempotency_key") BETWEEN 1 AND 256),
    CONSTRAINT "optimization_decisions_note_length_check" CHECK ("note" IS NULL OR char_length("note") <= 1000)
);

CREATE UNIQUE INDEX "optimization_decisions_proposal_id_key"
    ON "optimization_decisions"("proposal_id");
CREATE UNIQUE INDEX "optimization_decisions_owner_user_id_idempotency_key_key"
    ON "optimization_decisions"("owner_user_id", "idempotency_key");
CREATE UNIQUE INDEX "optimization_decisions_owner_user_id_request_fingerprint_key"
    ON "optimization_decisions"("owner_user_id", "request_fingerprint");
CREATE INDEX "optimization_decisions_business_id_created_at_idx"
    ON "optimization_decisions"("business_id", "created_at");
CREATE INDEX "optimization_decisions_content_cycle_id_strategy_id_strategy_version_idx"
    ON "optimization_decisions"("content_cycle_id", "strategy_id", "strategy_version");

CREATE TABLE "approved_optimization_instructions" (
    "id" UUID NOT NULL,
    "contract_version" VARCHAR(64) NOT NULL DEFAULT 'optimization-instruction-v1',
    "proposal_id" UUID NOT NULL,
    "approved_decision_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "strategy_version" INTEGER NOT NULL,
    "content_cycle_id" UUID NOT NULL,
    "format_cohort" VARCHAR(64) NOT NULL,
    "evidence_checksum" TEXT NOT NULL,
    "change_kind" VARCHAR(32) NOT NULL,
    "instruction" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING_CONSUMPTION',
    "consumed_content_pack_id" UUID,
    "consumed_week_plan_id" UUID,
    "approved_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approved_optimization_instructions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approved_optimization_instructions_contract_version_check" CHECK ("contract_version" = 'optimization-instruction-v1'),
    CONSTRAINT "approved_optimization_instructions_strategy_version_check" CHECK ("strategy_version" > 0),
    CONSTRAINT "approved_optimization_instructions_format_check" CHECK ("format_cohort" IN ('text_post', 'static_image_post')),
    CONSTRAINT "approved_optimization_instructions_change_kind_check" CHECK ("change_kind" IN ('hook_style', 'cta_wording_style')),
    CONSTRAINT "approved_optimization_instructions_status_check" CHECK ("status" IN ('PENDING_CONSUMPTION', 'CONSUMED', 'SUPERSEDED', 'EXPIRED')),
    CONSTRAINT "approved_optimization_instructions_evidence_checksum_check" CHECK ("evidence_checksum" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "approved_optimization_instructions_instruction_length_check" CHECK (char_length("instruction") BETWEEN 1 AND 2000),
    CONSTRAINT "approved_optimization_instructions_pending_shape_check" CHECK (
        "status" <> 'PENDING_CONSUMPTION'
        OR ("consumed_content_pack_id" IS NULL AND "consumed_week_plan_id" IS NULL AND "consumed_at" IS NULL)
    ),
    CONSTRAINT "approved_optimization_instructions_consumed_shape_check" CHECK (
        "status" <> 'CONSUMED'
        OR ("consumed_content_pack_id" IS NOT NULL AND "consumed_week_plan_id" IS NOT NULL AND "consumed_at" IS NOT NULL)
    ),
    CONSTRAINT "approved_optimization_instructions_terminal_shape_check" CHECK (
        "status" NOT IN ('SUPERSEDED', 'EXPIRED')
        OR ("superseded_at" IS NOT NULL AND "consumed_content_pack_id" IS NULL AND "consumed_week_plan_id" IS NULL AND "consumed_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "approved_optimization_instructions_proposal_id_key"
    ON "approved_optimization_instructions"("proposal_id");
CREATE UNIQUE INDEX "approved_optimization_instructions_approved_decision_id_key"
    ON "approved_optimization_instructions"("approved_decision_id");
CREATE UNIQUE INDEX "approved_optimization_instructions_consumed_content_pack_id_key"
    ON "approved_optimization_instructions"("consumed_content_pack_id");
CREATE UNIQUE INDEX "approved_optimization_instructions_consumed_week_plan_id_key"
    ON "approved_optimization_instructions"("consumed_week_plan_id");
CREATE INDEX "approved_optimization_instructions_business_id_status_created_at_idx"
    ON "approved_optimization_instructions"("business_id", "status", "created_at");
CREATE INDEX "approved_optimization_instructions_content_cycle_id_strategy_id_strategy_version_format_cohort_status_idx"
    ON "approved_optimization_instructions"("content_cycle_id", "strategy_id", "strategy_version", "format_cohort", "status");

ALTER TABLE "optimization_decisions"
    ADD CONSTRAINT "optimization_decisions_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "optimization_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "optimization_decisions"
    ADD CONSTRAINT "optimization_decisions_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "optimization_decisions"
    ADD CONSTRAINT "optimization_decisions_strategy_id_fkey"
    FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "optimization_decisions"
    ADD CONSTRAINT "optimization_decisions_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "optimization_decisions"
    ADD CONSTRAINT "optimization_decisions_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_proposal_id_fkey"
    FOREIGN KEY ("proposal_id") REFERENCES "optimization_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_approved_decision_id_fkey"
    FOREIGN KEY ("approved_decision_id") REFERENCES "optimization_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_strategy_id_fkey"
    FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_content_cycle_id_fkey"
    FOREIGN KEY ("content_cycle_id") REFERENCES "content_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_consumed_content_pack_id_fkey"
    FOREIGN KEY ("consumed_content_pack_id") REFERENCES "content_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approved_optimization_instructions"
    ADD CONSTRAINT "approved_optimization_instructions_consumed_week_plan_id_fkey"
    FOREIGN KEY ("consumed_week_plan_id") REFERENCES "content_week_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_optimization_decision_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'optimization_decisions are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "optimization_decisions_immutable"
BEFORE UPDATE OR DELETE ON "optimization_decisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_optimization_decision_mutation"();

CREATE OR REPLACE FUNCTION "enforce_optimization_instruction_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'PENDING_CONSUMPTION'
     AND NEW.status = 'CONSUMED'
     AND NEW.consumed_content_pack_id IS NOT NULL
     AND NEW.consumed_week_plan_id IS NOT NULL
     AND NEW.consumed_at IS NOT NULL
     AND NEW.proposal_id = OLD.proposal_id
     AND NEW.approved_decision_id = OLD.approved_decision_id
     AND NEW.business_id = OLD.business_id
     AND NEW.strategy_id = OLD.strategy_id
     AND NEW.strategy_version = OLD.strategy_version
     AND NEW.content_cycle_id = OLD.content_cycle_id
     AND NEW.format_cohort = OLD.format_cohort
     AND NEW.evidence_checksum = OLD.evidence_checksum
     AND NEW.change_kind = OLD.change_kind
     AND NEW.instruction = OLD.instruction
     AND NEW.approved_at = OLD.approved_at
     AND NEW.contract_version = OLD.contract_version
     AND NEW.created_at = OLD.created_at
     AND NEW.superseded_at IS NOT DISTINCT FROM OLD.superseded_at
     AND NEW.consumed_content_pack_id IS DISTINCT FROM OLD.consumed_content_pack_id
     AND NEW.consumed_week_plan_id IS DISTINCT FROM OLD.consumed_week_plan_id
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING_CONSUMPTION'
     AND NEW.status IN ('SUPERSEDED', 'EXPIRED')
     AND NEW.superseded_at IS NOT NULL
     AND NEW.consumed_content_pack_id IS NULL
     AND NEW.consumed_week_plan_id IS NULL
     AND NEW.consumed_at IS NULL
     AND NEW.contract_version = OLD.contract_version
     AND NEW.proposal_id = OLD.proposal_id
     AND NEW.approved_decision_id = OLD.approved_decision_id
     AND NEW.business_id = OLD.business_id
     AND NEW.strategy_id = OLD.strategy_id
     AND NEW.strategy_version = OLD.strategy_version
     AND NEW.content_cycle_id = OLD.content_cycle_id
     AND NEW.format_cohort = OLD.format_cohort
     AND NEW.evidence_checksum = OLD.evidence_checksum
     AND NEW.change_kind = OLD.change_kind
     AND NEW.instruction = OLD.instruction
     AND NEW.approved_at = OLD.approved_at
     AND NEW.created_at = OLD.created_at
     AND NEW.consumed_content_pack_id IS NOT DISTINCT FROM OLD.consumed_content_pack_id
     AND NEW.consumed_week_plan_id IS NOT DISTINCT FROM OLD.consumed_week_plan_id
     AND NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'approved optimization instructions allow only one forward transition' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "approved_optimization_instructions_forward_only"
BEFORE UPDATE OR DELETE ON "approved_optimization_instructions"
FOR EACH ROW EXECUTE FUNCTION "enforce_optimization_instruction_transition"();

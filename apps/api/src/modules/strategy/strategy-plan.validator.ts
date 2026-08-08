import { BadRequestException, Logger } from "@nestjs/common";

const logger = new Logger("StrategyPlanValidator");

/**
 * Required top-level fields on a StrategyPlan per the shared contract
 * (packages/contracts/src/strategy/strategy-plan.ts). This is a structural
 * gate — it does not deeply validate every nested object, but it catches
 * malformed provider responses early with a clear error message instead of
 * persisting garbage that would surface as a confusing deserialization error
 * on the read path.
 */
const REQUIRED_PLAN_FIELDS = [
  "id",
  "strategy_id",
  "version",
  "contract_version",
  "brief_id",
  "retrieval_run_id",
  "executive_summary",
  "situation_diagnosis",
  "primary_objective",
  "selected_channels",
  "all_channel_scores",
  "content_strategy",
  "budget_mode",
  "kpi_targets",
  "citations",
  "created_at",
] as const;

/**
 * Required top-level fields on an owner-first StrategyPlanV2
 * (packages/contracts/src/strategy/strategy-v2.ts).
 */
const REQUIRED_PLAN_V2_FIELDS = [
  "id",
  "strategy_id",
  "version",
  "contract_version",
  "brief_id",
  "retrieval_run_id",
  "goal",
  "primary_objective",
  "funnel_stage",
  "plan_language",
  "start_date",
  "calendar_weeks",
  "owner_advice",
  "channel_commitments",
  "evidence_summary",
  "risks",
  "knowledge_gaps",
  "blockers",
  "citations",
  "content_handoff",
  "created_at",
] as const;

/**
 * Validates the structural shape of a plan returned by the FastAPI generation
 * or revision endpoint before it is persisted as an immutable StrategyVersion.
 *
 * Dispatches on `plan.contract_version`: owner-first v2 plans require the v2
 * field set; legacy v1 plans keep the exact v1 shape.
 *
 * Throws BadRequestException with the list of missing fields so the processor
 * can fail the job with a descriptive, stable error rather than persisting
 * an invalid plan that would break downstream reads.
 */
export function validatePlanShape(planData: unknown): void {
  if (!planData || typeof planData !== "object" || Array.isArray(planData)) {
    throw new BadRequestException(
      "AI generation service returned an invalid plan: expected a JSON object",
    );
  }

  const plan = planData as Record<string, unknown>;
  const isV2 = plan["contract_version"] === "strategy-v2";
  const required = isV2 ? REQUIRED_PLAN_V2_FIELDS : REQUIRED_PLAN_FIELDS;
  const missing: string[] = [];

  for (const field of required) {
    if (plan[field] === undefined || plan[field] === null) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    const message = `AI generation service returned an incomplete plan: missing fields [${missing.join(", ")}]`;
    logger.warn(message);
    throw new BadRequestException(message);
  }

  if (isV2) {
    if (!Array.isArray(plan["calendar_weeks"])) {
      throw new BadRequestException(
        "AI generation service returned an invalid plan: calendar_weeks must be an array",
      );
    }
    if (!Array.isArray(plan["channel_commitments"])) {
      throw new BadRequestException(
        "AI generation service returned an invalid plan: channel_commitments must be an array",
      );
    }
    if (!Array.isArray(plan["citations"])) {
      throw new BadRequestException(
        "AI generation service returned an invalid plan: citations must be an array",
      );
    }
    return;
  }

  // Spot-check critical nested shapes.
  if (!Array.isArray(plan["selected_channels"])) {
    throw new BadRequestException(
      "AI generation service returned an invalid plan: selected_channels must be an array",
    );
  }

  if (!Array.isArray(plan["kpi_targets"])) {
    throw new BadRequestException(
      "AI generation service returned an invalid plan: kpi_targets must be an array",
    );
  }

  if (!Array.isArray(plan["citations"])) {
    throw new BadRequestException(
      "AI generation service returned an invalid plan: citations must be an array",
    );
  }
}
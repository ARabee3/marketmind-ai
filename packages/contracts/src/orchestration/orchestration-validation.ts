import type {
  CampaignOrchestrationResumeV1,
  CampaignOrchestrationStartV1,
  ContentDecisionBindingV1,
  OrchestrationDecisionBindingV1,
  StrategyDecisionBindingV1,
} from "./orchestration-types";
import type { ErrorCode } from "../errors/error-codes";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function assertUuid(field: string, value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      `${field} must be a UUID.`,
    );
  }
}

export class OrchestrationContractValidationError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "OrchestrationContractValidationError";
    this.code = code;
  }
}

export function assertCampaignOrchestrationStartV1(
  input: CampaignOrchestrationStartV1,
): void {
  for (const [field, value] of [
    ["run_id", input.run_id],
    ["owner_user_id", input.owner_user_id],
    ["business_id", input.business_id],
    ["confirmed_profile_version_id", input.confirmed_profile_version_id],
    ["strategy_id", input.strategy_id],
    ["strategy_brief_id", input.strategy_brief_id],
  ] as const) {
    assertUuid(field, value);
  }

  if (input.week_context_id) {
    assertUuid("week_context_id", input.week_context_id);
    if (
      !input.week_context_checksum ||
      !SHA256_PATTERN.test(input.week_context_checksum)
    ) {
      throw new OrchestrationContractValidationError(
        "VALIDATION_FAILED",
        "week_context_checksum must be a SHA-256 hex digest when supplied.",
      );
    }
  }

  if (!SHA256_PATTERN.test(input.confirmed_profile_checksum)) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      "confirmed_profile_checksum must be a SHA-256 hex digest.",
    );
  }

  if (Boolean(input.week_context_id) !== Boolean(input.week_context_checksum)) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      "week_context_id and week_context_checksum must be supplied together.",
    );
  }

  const bounds = input.bounds;
  if (
    !Number.isInteger(bounds.tool_calls_used) ||
    !Number.isInteger(bounds.tool_calls_limit) ||
    !Number.isInteger(bounds.replans_used) ||
    !Number.isInteger(bounds.replans_limit) ||
    bounds.tool_calls_used < 0 ||
    bounds.tool_calls_limit < 0 ||
    bounds.replans_used < 0 ||
    bounds.replans_limit < 0 ||
    bounds.tool_calls_used > bounds.tool_calls_limit ||
    bounds.replans_used > bounds.replans_limit
  ) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      "orchestration bounds must be non-negative and used values cannot exceed limits.",
    );
  }
  if (
    bounds.token_budget !== null &&
    (!Number.isFinite(bounds.token_budget) || bounds.token_budget < 0)
  ) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      "token_budget must be a finite non-negative number.",
    );
  }
  if (
    bounds.cost_budget_usd !== null &&
    (!Number.isFinite(bounds.cost_budget_usd) || bounds.cost_budget_usd < 0)
  ) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      "cost_budget_usd must be a finite non-negative number.",
    );
  }
}

export function assertCampaignOrchestrationResumeV1(
  input: CampaignOrchestrationResumeV1,
): void {
  assertUuid("run_id", input.run_id);
  assertUuid("owner_user_id", input.owner_user_id);
  assertUuid("business_id", input.business_id);
  if (input.checkpoint_thread_id !== input.run_id) {
    throw new OrchestrationContractValidationError(
      "ORCHESTRATION_SCOPE_MISMATCH",
      "checkpoint_thread_id must match run_id.",
    );
  }

  const binding = input.decision_binding;
  if (
    binding.run_id !== input.run_id ||
    binding.business_id !== input.business_id
  ) {
    throw new OrchestrationContractValidationError(
      "ORCHESTRATION_SCOPE_MISMATCH",
      "decision binding must belong to the resumed run and business.",
    );
  }

  const bindingIds =
    input.decision_binding.binding_type === "strategy"
      ? [
          ["strategy_id", input.decision_binding.strategy_id],
          ["strategy_version_id", input.decision_binding.strategy_version_id],
          ["decision_id", input.decision_binding.decision_id],
          ["decided_by_user_id", input.decision_binding.decided_by_user_id],
        ]
      : [
          ["content_cycle_id", input.decision_binding.content_cycle_id],
          ["content_pack_id", input.decision_binding.content_pack_id],
          ["content_item_id", input.decision_binding.content_item_id],
          [
            "content_item_version_id",
            input.decision_binding.content_item_version_id,
          ],
          ["decision_id", input.decision_binding.decision_id],
          ["decided_by_user_id", input.decision_binding.decided_by_user_id],
        ];
  for (const [field, value] of bindingIds) {
    assertUuid(field, value);
  }

  assertDecisionBinding(binding);
}

function assertDecisionBinding(
  binding: OrchestrationDecisionBindingV1,
): asserts binding is StrategyDecisionBindingV1 | ContentDecisionBindingV1 {
  const checksum =
    binding.binding_type === "strategy"
      ? binding.strategy_checksum
      : binding.content_item_version_checksum;
  if (!SHA256_PATTERN.test(checksum)) {
    throw new OrchestrationContractValidationError(
      "VALIDATION_FAILED",
      "decision binding checksum must be a SHA-256 hex digest.",
    );
  }
}

import { ERROR_CODES } from "../errors/error-codes";

export const ORCHESTRATION_STATUSES = [
  "queued",
  "running",
  "awaiting_strategy_approval",
  "awaiting_content_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];

export function isOrchestrationStatus(
  value: string,
): value is OrchestrationStatus {
  return (ORCHESTRATION_STATUSES as readonly string[]).includes(value);
}

export const ORCHESTRATION_ROLES = ["research", "strategy", "content"] as const;
export type OrchestrationRole = (typeof ORCHESTRATION_ROLES)[number];

export const ORCHESTRATION_STAGES = [
  "prepare",
  "research",
  "strategy",
  "strategy_approval",
  "content",
  "content_approval",
  "complete",
  "failed",
  "cancelled",
] as const;

export type OrchestrationStage = (typeof ORCHESTRATION_STAGES)[number];

export const ORCHESTRATION_EVENT_TYPES = [
  "run_created",
  "node_started",
  "node_completed",
  "tool_started",
  "tool_completed",
  "validation",
  "interrupt",
  "resume",
  "terminal",
  "error",
] as const;

export type OrchestrationEventType = (typeof ORCHESTRATION_EVENT_TYPES)[number];

export const ORCHESTRATION_ALLOWED_TRANSITIONS: Record<
  OrchestrationStatus,
  readonly OrchestrationStatus[]
> = {
  queued: ["running", "cancelled", "failed"],
  running: [
    "awaiting_strategy_approval",
    "awaiting_content_approval",
    "completed",
    "failed",
    "cancelled",
  ],
  awaiting_strategy_approval: ["running", "cancelled", "failed"],
  awaiting_content_approval: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionOrchestrationRun(
  from: OrchestrationStatus,
  to: OrchestrationStatus,
): boolean {
  return ORCHESTRATION_ALLOWED_TRANSITIONS[from].includes(to);
}

export class OrchestrationLifecycleError extends Error {
  readonly code = ERROR_CODES.ORCHESTRATION_INVALID_TRANSITION;

  constructor(
    readonly from: OrchestrationStatus,
    readonly to: OrchestrationStatus,
  ) {
    super(`Invalid orchestration lifecycle transition: ${from} -> ${to}`);
    this.name = "OrchestrationLifecycleError";
  }
}

export function transitionOrchestrationRun(
  from: OrchestrationStatus,
  to: OrchestrationStatus,
): OrchestrationStatus {
  if (!canTransitionOrchestrationRun(from, to)) {
    throw new OrchestrationLifecycleError(from, to);
  }
  return to;
}

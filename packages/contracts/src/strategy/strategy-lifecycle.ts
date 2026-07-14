import type {
  UUID,
  IsoDateTime,
} from "../discovery/prepared-discovery-contracts";
import type { StrategyId, StrategyVersionId } from "./strategy-ids";

export const STRATEGY_STATUSES = [
  "needs_brief",
  "ready",
  "retrieving",
  "queued",
  "generating",
  "validating",
  "draft",
  "approved",
  "rejected",
  "failed",
] as const;

export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export const STRATEGY_ALLOWED_TRANSITIONS: Record<
  StrategyStatus,
  readonly StrategyStatus[]
> = {
  needs_brief: ["ready", "failed"],
  ready: ["retrieving", "failed"],
  retrieving: ["queued", "failed"],
  queued: ["generating", "failed"],
  generating: ["validating", "failed"],
  validating: ["draft", "failed"],
  draft: ["approved", "rejected", "ready"],
  approved: [],
  rejected: ["ready"],
  failed: ["ready"],
};

export function canTransitionStrategy(
  from: StrategyStatus,
  to: StrategyStatus,
): boolean {
  return STRATEGY_ALLOWED_TRANSITIONS[from].includes(to);
}

export const STRATEGY_PROGRESS_STAGES = [
  "queued",
  "query_planning",
  "retrieval",
  "generating",
  "validating",
  "ready",
  "failed",
] as const;

export type StrategyProgressStage = (typeof STRATEGY_PROGRESS_STAGES)[number];

export const STRATEGY_PROGRESS_STATUSES = [
  "started",
  "progress",
  "complete",
  "failed",
] as const;

export type StrategyProgressStatus =
  (typeof STRATEGY_PROGRESS_STATUSES)[number];

export interface OwnerDecision {
  id: UUID;
  strategy_id: UUID;
  strategy_version: number;
  decision: "approved" | "rejected" | "revision_requested";
  revision_notes: string | null;
  decided_by_user_id: UUID;
  decided_at: IsoDateTime;
}

export interface StrategyVersionSummary {
  strategy_id: UUID;
  version: number;
  status: StrategyStatus;
  brief_id: UUID;
  retrieval_run_id: UUID;
  created_at: IsoDateTime;
  decision?: OwnerDecision;
}

export interface StrategyProgressEvent {
  type: "strategy_progress";
  strategy_id: UUID;
  seq: number;
  stage: StrategyProgressStage;
  status: StrategyProgressStatus;
  message_key: string;
  message_text: string;
  retryable?: boolean;
  payload: Record<string, unknown>;
  created_at: IsoDateTime;
}

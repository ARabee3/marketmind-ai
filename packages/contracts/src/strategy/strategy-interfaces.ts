import type { BusinessProfile } from "../discovery/business-profile.schema";
import type { UUID } from "../discovery/prepared-discovery-contracts";
import type { StrategyBrief } from "./strategy-brief";
import type { ContractVersion } from "./strategy-ids";
import type { OwnerDecision, StrategyStatus } from "./strategy-lifecycle";
import type {
  DeterministicChannelScorecard,
  StrategyPlan,
} from "./strategy-plan";
import type {
  RetrievedKnowledgePack,
  RetrievalQueryContext,
} from "./strategy-retrieval";

/** POST /api/v1/strategies */
export interface CreateStrategyRequest {
  business_profile_version_id: UUID;
}

/** PUT /api/v1/strategies/:id/brief */
export type UpdateStrategyBriefRequest = Omit<
  StrategyBrief,
  "id" | "strategy_id" | "created_at" | "updated_at"
>;

/** POST /api/v1/strategies/:id/generate and /retry */
export interface GenerateStrategyRequest {
  expected_profile_version_id: UUID;
  idempotency_key: string;
}

/** POST /api/v1/strategies/:id/decisions */
export type SubmitStrategyDecisionRequest = Pick<
  OwnerDecision,
  "strategy_version" | "decision" | "revision_notes"
>;

/** POST /internal/v1/ai/knowledge/retrieve */
export interface StrategyKnowledgeRetrievalRequest {
  contract_version: ContractVersion;
  strategy_id: UUID;
  brief: StrategyBrief;
  /** Privacy-minimized query fields only; never the complete profile. */
  query_context: RetrievalQueryContext;
}

/**
 * POST /internal/v1/ai/strategy/generate
 *
 * The complete immutable profile is supplied directly by NestJS. It is never
 * reconstructed from Qdrant or from the privacy-minimized retrieval context.
 */
export interface StrategyGenerateRequest {
  contract_version: ContractVersion;
  strategy_id: UUID;
  business_profile: BusinessProfile;
  brief: StrategyBrief;
  retrieved_knowledge_pack: RetrievedKnowledgePack;
  deterministic_channel_scores: DeterministicChannelScorecard[];
}

/** POST /internal/v1/ai/strategy/revise */
export interface StrategyReviseRequest extends StrategyGenerateRequest {
  previous_plan: StrategyPlan;
  revision_notes: string;
}

export interface StrategyResource {
  strategy_id: UUID;
  status: StrategyStatus;
  brief: StrategyBrief | null;
  latest_plan: StrategyPlan | null;
}

export interface StrategyGenerateResponse {
  plan: StrategyPlan;
  validation: StrategyValidationResult;
}

export interface StrategyValidationIssue {
  code: StrategyValidationCode;
  field: string;
  message: string;
}

export type StrategyValidationCode =
  | "STRATEGY_PROFILE_STALE"
  | "STRATEGY_PROFILE_UNCONFIRMED"
  | "STRATEGY_KNOWLEDGE_GAP"
  | "STRATEGY_RETRIEVAL_FAILURE"
  | "STRATEGY_INVALID_CITATION"
  | "STRATEGY_INVALID_BENCHMARK"
  | "STRATEGY_ARITHMETIC_FAILURE"
  | "STRATEGY_RULE_VIOLATION"
  | "STRATEGY_BUDGET_MISMATCH"
  | "STRATEGY_CHANNEL_LIMIT_EXCEEDED"
  | "STRATEGY_EVIDENCE_NOT_APPROVED"
  | "STRATEGY_SCORE_MISMATCH"
  | "STRATEGY_APPROVAL_BLOCKED";

export interface StrategyValidationResult {
  valid: boolean;
  issues: StrategyValidationIssue[];
}

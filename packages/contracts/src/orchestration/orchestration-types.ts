import type { ErrorCode } from "../errors/error-codes";
import type {
  IsoDateTime,
  UUID,
} from "../discovery/prepared-discovery-contracts";
import type {
  OrchestrationEventType,
  OrchestrationRole,
  OrchestrationStage,
  OrchestrationStatus,
} from "./orchestration-lifecycle";

export type OrchestrationContractVersion = "orchestration-v1";
export type ResearchPackContractVersion = "research-pack-v1";

export type ResearchSourceKind =
  | "owner_input"
  | "discovery_evidence"
  | "approved_knowledge"
  | "trusted_research";

export interface ResearchFactV1 {
  statement: string;
  source_ref: string;
  source_kind: ResearchSourceKind;
  fetched_at: IsoDateTime;
  confidence: number;
  relevance: number;
}

export interface ResearchAssumptionV1 {
  statement: string;
  source_ref: string | null;
  reason: string;
}

export interface ResearchKnowledgeGapV1 {
  field_key: string;
  question_hint: string;
  priority: number;
  blocking: boolean;
}

export interface ResearchPackV1 {
  contract_version: ResearchPackContractVersion;
  run_id: UUID;
  business_id: UUID;
  profile_version_id: UUID;
  facts: ResearchFactV1[];
  assumptions: ResearchAssumptionV1[];
  knowledge_gaps: ResearchKnowledgeGapV1[];
  source_quality_summary: string;
  stop_reason:
    | "sufficient_evidence"
    | "owner_blocker"
    | "budget_exhausted"
    | "provider_failure";
}

export interface OrchestrationImmutableInputRefsV1 {
  confirmed_profile_version_id: UUID;
  confirmed_profile_version: number;
  confirmed_profile_checksum: string;
  strategy_id: UUID;
  strategy_brief_id: UUID;
  requested_week_number: number | null;
  week_context_id: UUID | null;
  week_context_checksum: string | null;
}

export interface StrategyDecisionBindingV1 {
  binding_type: "strategy";
  run_id: UUID;
  business_id: UUID;
  strategy_id: UUID;
  strategy_version_id: UUID;
  strategy_version: number;
  strategy_checksum: string;
  decision_id: UUID;
  decision: "approved" | "rejected" | "revision_requested";
  decided_by_user_id: UUID;
  decided_at: IsoDateTime;
}

export interface ContentDecisionBindingV1 {
  binding_type: "content";
  run_id: UUID;
  business_id: UUID;
  content_cycle_id: UUID;
  content_pack_id: UUID;
  content_item_id: UUID;
  content_item_version_id: UUID;
  content_item_version: number;
  content_item_version_checksum: string;
  decision_id: UUID;
  decision: "approved" | "rejected" | "revision_requested";
  decided_by_user_id: UUID;
  decided_at: IsoDateTime;
}

export type OrchestrationDecisionBindingV1 =
  | StrategyDecisionBindingV1
  | ContentDecisionBindingV1;

export interface CampaignOrchestrationStartV1 {
  contract_version: OrchestrationContractVersion;
  run_id: UUID;
  correlation_id: string;
  idempotency_key: string;
  owner_user_id: UUID;
  business_id: UUID;
  graph_name: string;
  graph_version: string;
  feature_cohort: string;
  confirmed_profile_version_id: UUID;
  confirmed_profile_version: number;
  confirmed_profile_checksum: string;
  strategy_id: UUID;
  strategy_brief_id: UUID;
  requested_week_number: number | null;
  requested_at: IsoDateTime;
}

export interface CampaignOrchestrationResumeV1 {
  contract_version: OrchestrationContractVersion;
  run_id: UUID;
  checkpoint_thread_id: string;
  correlation_id: string;
  idempotency_key: string;
  owner_user_id: UUID;
  business_id: UUID;
  decision_binding: OrchestrationDecisionBindingV1;
  requested_at: IsoDateTime;
}

export interface OrchestrationStrategyStateV1 {
  draft_id: UUID | null;
  version_id: UUID | null;
  version: number | null;
  checksum: string | null;
  validation_valid: boolean | null;
  pending_decision: boolean;
}

export interface OrchestrationContentStateV1 {
  cycle_id: UUID | null;
  pack_id: UUID | null;
  item_id: UUID | null;
  item_version_id: UUID | null;
  item_version: number | null;
  checksum: string | null;
  validation_valid: boolean | null;
  pending_decision: boolean;
}

export interface OrchestrationBoundsV1 {
  tool_calls_used: number;
  tool_calls_limit: number;
  replans_used: number;
  replans_limit: number;
  token_budget: number | null;
  cost_budget_usd: number | null;
  deadline_at: IsoDateTime | null;
}

export interface OrchestrationAuditV1 {
  prompt_versions: string[];
  provider_versions: string[];
  action_summaries: string[];
  stable_errors: ErrorCode[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CampaignOrchestrationStateV1 {
  contract_version: OrchestrationContractVersion;
  run_id: UUID;
  correlation_id: string;
  owner_user_id: UUID;
  business_id: UUID;
  graph_name: string;
  graph_version: string;
  status: OrchestrationStatus;
  current_role: OrchestrationRole | null;
  current_stage: OrchestrationStage;
  feature_cohort: string;
  immutable_input: OrchestrationImmutableInputRefsV1;
  research_pack: ResearchPackV1 | null;
  strategy: OrchestrationStrategyStateV1;
  content: OrchestrationContentStateV1;
  bounds: OrchestrationBoundsV1;
  audit: OrchestrationAuditV1;
}

export interface OrchestrationErrorV1 {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

export interface CampaignOrchestrationResultV1 {
  contract_version: OrchestrationContractVersion;
  run_id: UUID;
  status: OrchestrationStatus;
  checkpoint_thread_id: string;
  checkpoint_version: number;
  state: CampaignOrchestrationStateV1;
  error: OrchestrationErrorV1 | null;
}

export interface CampaignOrchestrationEventV1 {
  contract_version: OrchestrationContractVersion;
  event_id: UUID;
  run_id: UUID;
  seq: number;
  event_type: OrchestrationEventType;
  status: OrchestrationStatus;
  current_role: OrchestrationRole | null;
  current_stage: OrchestrationStage;
  node: string | null;
  tool: string | null;
  summary: string;
  payload: Record<string, unknown>;
  created_at: IsoDateTime;
}

import type {
  DiscoveryProgressStage,
  DiscoveryProgressStatus,
  DiscoverySessionStatus,
} from "./discovery-lifecycle";
import type {
  DiscoveryProfileDomain,
  Uncertainty,
  UncertaintyInput,
} from "./uncertainty.schema";

export type UUID = string;
export type IsoDateTime = string;

export type LanguageMode = "ar-EG" | "en" | "mixed";

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "website"
  | "google_maps"
  | "delivery"
  | "other";

export type SourceType =
  | "owner_link"
  | "metadata"
  | "search_result"
  | "manual_owner_answer";

export interface SocialLinkInput {
  platform: SocialPlatform;
  url: string;
}

export interface PreparedDiscoveryIntake {
  business_name: string;
  business_type: string;
  city: string;
  area?: string;
  address_text?: string;
  owner_goal_text?: string;
  known_competitors_text?: string;
  target_audience_text?: string;
  notes?: string;
  social_links?: SocialLinkInput[];
}

export interface SourceRef {
  id: UUID;
  source_type: SourceType;
  platform?: string;
  url?: string;
  title?: string;
  snippet?: string;
  fetched_at?: IsoDateTime;
  confidence: number;
  metadata: Record<string, unknown>;
}

export type ResearchObservationKind =
  | "digital_presence"
  | "competitor"
  | "market_context"
  | "social_signal"
  | "metadata";

export interface ResearchObservation {
  id: UUID;
  source_ref_id?: UUID;
  kind: ResearchObservationKind;
  statement: string;
  confidence: number;
  visibility: "owner_visible" | "internal";
  status: "accepted" | "discarded";
  discard_reason?: string;
  metadata: Record<string, unknown>;
}

export interface ConversationHook {
  id: UUID;
  source_observation_id?: UUID;
  hook_text: string;
  language: LanguageMode;
  status: "active" | "used" | "discarded";
}

export interface KnowledgeGap {
  id: UUID;
  field_key: string;
  question_hint: string;
  priority: number;
  status: "open" | "answered" | "skipped";
}

export interface IntelligenceResult {
  status: "running" | "partial" | "complete" | "failed";
  search_mode: "metadata_only" | "free_search" | "provider_later";
  source_refs: SourceRef[];
  research_observations: ResearchObservation[];
  conversation_hooks: ConversationHook[];
  knowledge_gaps: KnowledgeGap[];
  safe_error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface BusinessIdentityFacts {
  business_name?: string;
  business_type?: string;
  city?: string;
  area?: string;
}

export interface OfferFacts {
  core_offerings: string[];
  best_sellers: string[];
  price_range?: string;
  purchase_occasions: string[];
}

export interface CustomerFacts {
  primary_segments: string[];
  visit_or_order_occasions: string[];
  peak_periods: string[];
  customer_needs: string[];
}

export interface DifferentiationFacts {
  owner_claimed_strengths: string[];
  customer_choice_reasons: string[];
  proof_points: string[];
}

export interface CurrentMarketingFacts {
  active_channels: string[];
  current_activities: string[];
  delivery_platforms: string[];
  available_assets: string[];
}

export interface GoalsAndConstraintsFacts {
  growth_goals: string[];
  timeframe?: string;
  marketing_budget_range?: string;
  team_capacity?: string;
  operational_constraints: string[];
}

export interface MarketAwareBusinessFacts {
  identity: BusinessIdentityFacts;
  offer: OfferFacts;
  customers: CustomerFacts;
  differentiation: DifferentiationFacts;
  current_marketing: CurrentMarketingFacts;
  goals_and_constraints: GoalsAndConstraintsFacts;
}

export interface MarketEvidence {
  observation_id: UUID;
  source_ref_id?: UUID;
  statement: string;
  confidence: number;
}

export interface MarketContextSnapshot {
  competitor_landscape: MarketEvidence[];
  local_demand_signals: MarketEvidence[];
  digital_presence_signals: MarketEvidence[];
  other_signals: MarketEvidence[];
}

export interface DiscoveryDomainScores {
  identity: number;
  offer: number;
  customers: number;
  differentiation: number;
  current_marketing: number;
  goals_and_constraints: number;
  market_context: number;
  research_confidence: number;
  profile_readiness: number;
}

export type DiscoveryCompletionReason =
  | "sufficient"
  | "owner_finished_early"
  | "turn_limit";

export interface DiscoveryReadiness {
  ready: boolean;
  llm_recommended: boolean;
  profile_readiness: number;
  domain_scores: DiscoveryDomainScores;
  blocking_domains: DiscoveryProfileDomain[];
  owner_turn_count: number;
  max_owner_turns: number;
  completion_reason?: DiscoveryCompletionReason;
}

export interface DiscoveryProfileState {
  known_facts: MarketAwareBusinessFacts;
  uncertainties: UncertaintyInput[];
  readiness: DiscoveryReadiness;
}

export interface DiscoveryCompletionContext {
  reason: DiscoveryCompletionReason;
  completeness: "complete" | "incomplete";
  readiness: DiscoveryReadiness;
}

export interface BusinessProfileDraft {
  id: UUID;
  session_id: UUID;
  version: number;
  status: "draft" | "ready_for_confirmation" | "confirmed" | "superseded";
  completeness: "complete" | "incomplete";
  completion_reason: DiscoveryCompletionReason;
  readiness: DiscoveryReadiness;
  confirmed_facts: MarketAwareBusinessFacts;
  market_context: MarketContextSnapshot;
  research_observations: ResearchObservation[];
  uncertainties: Uncertainty[];
  owner_goals: string[];
  strategy_relevant_notes: string[];
  raw_ai_output: Record<string, unknown>;
}

export interface DiscoveryMessage {
  id: UUID;
  role: "owner" | "assistant" | "system";
  content: string;
  language: LanguageMode;
  source: "chat" | "research_hook" | "summary";
  suggested_answers?: string[];
  created_at: IsoDateTime;
}

export interface DiscoveryProgressEvent {
  type: "progress";
  session_id: UUID;
  seq: number;
  stage: DiscoveryProgressStage;
  status: DiscoveryProgressStatus;
  message_key: string;
  message_text: string;
  retryable?: boolean;
  payload: Record<string, unknown>;
  created_at: IsoDateTime;
}

export interface StartPreparedDiscoveryRequest {
  intake: PreparedDiscoveryIntake;
  language_mode?: LanguageMode;
}

export interface StartPreparedDiscoveryResponse {
  session_id: UUID;
  status: Extract<DiscoverySessionStatus, "researching">;
  progress_ws_url: string;
  status_url: string;
  accepted_at: IsoDateTime;
}

export interface DiscoveryStatusResponse {
  session_id: UUID;
  status: DiscoverySessionStatus;
  language_mode: LanguageMode;
  current_question?: string;
  current_suggested_answers?: string[];
  intake_summary: Pick<
    PreparedDiscoveryIntake,
    "business_name" | "business_type" | "city" | "area"
  >;
  intelligence: IntelligenceResult;
  messages: DiscoveryMessage[];
  profile_draft?: BusinessProfileDraft;
  profile_state: DiscoveryProfileState;
  progress_events: DiscoveryProgressEvent[];
  strategy_locked: boolean;
}

export interface DiscoveryRespondRequest {
  message: string;
  language?: LanguageMode;
}

export interface DiscoveryRespondResponse {
  session_id: UUID;
  status: Extract<DiscoverySessionStatus, "in_progress" | "summary_ready">;
  assistant_message?: DiscoveryMessage;
  updated_known_facts: MarketAwareBusinessFacts;
  uncertainties: UncertaintyInput[];
  readiness: DiscoveryReadiness;
  profile_draft?: BusinessProfileDraft;
  strategy_locked: true;
}

export interface DiscoverySummarizeRequest {
  finish_anyway?: boolean;
}

export interface DiscoverySummarizeResponse {
  session_id: UUID;
  status: Extract<DiscoverySessionStatus, "summary_ready">;
  profile_draft: BusinessProfileDraft;
  strategy_locked: true;
}

export interface ConfirmProfileRequest {
  profile_draft_id: UUID;
  owner_confirmation: true;
  acknowledge_incomplete?: true;
}

export interface ConfirmProfileResponse {
  session_id: UUID;
  status: Extract<DiscoverySessionStatus, "confirmed">;
  business_profile_version_id: UUID;
  confirmed_at: IsoDateTime;
  strategy_locked: false;
}

export type AiDiscoveryAction =
  | "ask_next_question"
  | "ask_clarification"
  | "produce_profile_draft"
  | "safe_failure";

export interface AiDiscoveryStartRequest {
  session_id: UUID;
  language_mode: LanguageMode;
  intake: PreparedDiscoveryIntake;
  intelligence: IntelligenceResult;
}

export interface AiDiscoveryRespondRequest {
  session_id: UUID;
  language_mode: LanguageMode;
  intake: PreparedDiscoveryIntake;
  intelligence: IntelligenceResult;
  messages: DiscoveryMessage[];
  owner_message: DiscoveryMessage;
}

export interface AiDiscoverySummarizeRequest {
  session_id: UUID;
  language_mode: LanguageMode;
  intake: PreparedDiscoveryIntake;
  intelligence: IntelligenceResult;
  messages: DiscoveryMessage[];
  completion_context: DiscoveryCompletionContext;
}

export interface AiDiscoveryResult {
  action: AiDiscoveryAction;
  next_question?: string;
  suggested_answers?: string[];
  updated_known_facts: MarketAwareBusinessFacts;
  updated_uncertainties: UncertaintyInput[];
  research_observations: ResearchObservation[];
  source_refs: SourceRef[];
  domain_scores: DiscoveryDomainScores;
  ready_to_summarize: boolean;
  profile_draft?: BusinessProfileDraft;
  safe_error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

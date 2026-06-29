import { LanguageModeDto, PreparedDiscoveryIntakeDto } from "./dto/start-discovery.dto";

export type DiscoverySessionStatus =
  | "not_started"
  | "researching"
  | "partial_ready"
  | "ready_for_chat"
  | "in_progress"
  | "summary_ready"
  | "confirmed"
  | "research_failed"
  | "failed"
  | "cancelled";

export type IntelligenceResult = {
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
};

export type SourceType = "owner_link" | "metadata" | "search_result" | "manual_owner_answer";

export type SourceRef = {
  id: string;
  source_type: SourceType;
  platform?: string;
  url?: string;
  title?: string;
  snippet?: string;
  fetched_at?: string;
  confidence: number;
  metadata: Record<string, unknown>;
};

export type ResearchObservationKind =
  | "digital_presence"
  | "competitor"
  | "market_context"
  | "social_signal"
  | "metadata";

export type ResearchObservation = {
  id: string;
  source_ref_id?: string;
  kind: ResearchObservationKind;
  statement: string;
  confidence: number;
  visibility: "owner_visible" | "internal";
  status: "accepted" | "discarded";
  discard_reason?: string;
  metadata: Record<string, unknown>;
};

export type ConversationHook = {
  id: string;
  source_observation_id?: string;
  hook_text: string;
  language: LanguageModeDto;
  status: "active" | "used" | "discarded";
};

export type KnowledgeGap = {
  id: string;
  field_key: string;
  question_hint: string;
  priority: number;
  status: "open" | "answered" | "skipped";
};

export type StartDiscoveryResponse = {
  session_id: string;
  status: "researching";
  progress_ws_url: string;
  status_url: string;
  accepted_at: string;
};

export type DiscoveryStatusResponse = {
  session_id: string;
  status: DiscoverySessionStatus;
  language_mode: LanguageModeDto;
  current_question?: string;
  intake_summary: Pick<
    PreparedDiscoveryIntakeDto,
    "business_name" | "business_type" | "city" | "area"
  >;
  intelligence: IntelligenceResult;
  messages: readonly DiscoveryMessage[];
  profile_draft?: BusinessProfileDraft;
  progress_events: readonly DiscoveryProgressEvent[];
  strategy_locked: true;
};

export const emptyRunningIntelligence = (): IntelligenceResult => ({
  status: "running",
  search_mode: "metadata_only",
  source_refs: [],
  research_observations: [],
  conversation_hooks: [],
  knowledge_gaps: [],
});

export type DiscoveryProgressEventStatus =
  | "started"
  | "progress"
  | "complete"
  | "completed"
  | "failed";

export type DiscoveryProgressEvent = {
  readonly type: "progress";
  readonly session_id: string;
  readonly seq: number;
  readonly stage: string;
  readonly status: Exclude<DiscoveryProgressEventStatus, "completed">;
  readonly message_key: string;
  readonly message_text: string;
  readonly retryable?: boolean;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
};

export type DiscoveryProgressInput = {
  readonly stage: string;
  readonly status: DiscoveryProgressEventStatus;
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload?: Record<string, unknown>;
};

export type DiscoveryMessage = {
  readonly id: string;
  readonly role: "owner" | "assistant" | "system";
  readonly content: string;
  readonly language: LanguageModeDto;
  readonly source: "chat" | "research_hook" | "summary";
  readonly created_at: string;
};

export type BusinessProfileDraft = {
  readonly id: string;
  readonly session_id: string;
  readonly version: number;
  readonly status: "draft" | "ready_for_confirmation" | "confirmed" | "superseded";
  readonly confirmed_facts: Record<string, unknown>;
  readonly research_observations: readonly ResearchObservation[];
  readonly uncertainties: readonly ProfileUncertainty[];
  readonly owner_goals: readonly string[];
  readonly strategy_relevant_notes: readonly string[];
  readonly raw_ai_output: Record<string, unknown>;
};

export type ProfileUncertainty = {
  readonly field_key: string;
  readonly description: string;
  readonly severity: "low" | "medium" | "high";
};

export type AiDiscoveryAction =
  | "ask_next_question"
  | "ask_clarification"
  | "produce_profile_draft"
  | "safe_failure";

export type AiDiscoveryResult = {
  readonly action: AiDiscoveryAction;
  readonly next_question?: string;
  readonly updated_known_facts: Record<string, unknown>;
  readonly updated_uncertainties: readonly ProfileUncertainty[];
  readonly research_observations: readonly ResearchObservation[];
  readonly source_refs: readonly SourceRef[];
  readonly domain_scores: Record<string, number>;
  readonly profile_draft?: BusinessProfileDraft;
  readonly safe_error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  };
};

export type DiscoveryRespondResponse = {
  readonly session_id: string;
  readonly status: "in_progress" | "summary_ready";
  readonly assistant_message?: DiscoveryMessage;
  readonly updated_known_facts: Record<string, unknown>;
  readonly uncertainties: readonly ProfileUncertainty[];
  readonly profile_draft?: BusinessProfileDraft;
  readonly strategy_locked: true;
};

export type DiscoverySummarizeResponse = {
  readonly session_id: string;
  readonly status: "summary_ready";
  readonly profile_draft: BusinessProfileDraft;
  readonly strategy_locked: true;
};

export type ConfirmProfileResponse = {
  readonly session_id: string;
  readonly status: "confirmed";
  readonly business_profile_version_id: string;
  readonly confirmed_at: string;
  readonly strategy_locked: false;
};

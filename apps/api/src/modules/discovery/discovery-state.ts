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
  messages: unknown[];
  progress_events: unknown[];
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

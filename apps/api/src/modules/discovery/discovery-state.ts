import type {
  AiDiscoveryAction as ContractAiDiscoveryAction,
  AiDiscoveryResult as ContractAiDiscoveryResult,
  BusinessProfileDraft as ContractBusinessProfileDraft,
  ConfirmProfileResponse as ContractConfirmProfileResponse,
  ConversationHook as ContractConversationHook,
  DiscoveryMessage as ContractDiscoveryMessage,
  DiscoveryProgressEvent as ContractDiscoveryProgressEvent,
  DiscoveryRespondResponse as ContractDiscoveryRespondResponse,
  DiscoverySessionStatus as ContractDiscoverySessionStatus,
  DiscoveryStatusResponse as ContractDiscoveryStatusResponse,
  DiscoverySummarizeResponse as ContractDiscoverySummarizeResponse,
  IntelligenceResult as ContractIntelligenceResult,
  KnowledgeGap as ContractKnowledgeGap,
  ResearchObservation as ContractResearchObservation,
  SourceRef as ContractSourceRef,
  SourceType as ContractSourceType,
  StartPreparedDiscoveryResponse as ContractStartDiscoveryResponse,
  UncertaintyInput,
} from "@marketmind/contracts";

export type DiscoverySessionStatus = ContractDiscoverySessionStatus;
export type IntelligenceResult = ContractIntelligenceResult;
export type SourceType = ContractSourceType;
export type SourceRef = ContractSourceRef;
export type ResearchObservationKind = ContractResearchObservation["kind"];
export type ResearchObservation = ContractResearchObservation;
export type ConversationHook = ContractConversationHook;
export type KnowledgeGap = ContractKnowledgeGap;
export type StartDiscoveryResponse = ContractStartDiscoveryResponse;
export type DiscoveryStatusResponse = ContractDiscoveryStatusResponse;

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

export type DiscoveryProgressEvent = ContractDiscoveryProgressEvent;

export type DiscoveryProgressInput = {
  readonly stage:
    | DiscoveryProgressEvent["stage"]
    | "session"
    | "intelligence"
    | "ai_discovery"
    | "background";
  readonly status: DiscoveryProgressEventStatus;
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload?: Record<string, unknown>;
};

export type DiscoveryMessage = ContractDiscoveryMessage;
export type BusinessProfileDraft = ContractBusinessProfileDraft;
export type ProfileUncertainty = UncertaintyInput;
export type AiDiscoveryAction = ContractAiDiscoveryAction;
export type AiDiscoveryResult = ContractAiDiscoveryResult;
export type DiscoveryRespondResponse = ContractDiscoveryRespondResponse;
export type DiscoverySummarizeResponse = ContractDiscoverySummarizeResponse;
export type ConfirmProfileResponse = ContractConfirmProfileResponse;

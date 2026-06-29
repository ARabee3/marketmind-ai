import { LanguageModeDto } from "../dto/start-discovery.dto";
import {
  IntelligenceResult,
  ResearchObservationKind,
  SourceType,
} from "../discovery-state";

export type IntelligenceSourceCandidate = {
  readonly source_type: SourceType | string;
  readonly platform?: string;
  readonly url?: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly fetched_at?: string;
  readonly confidence: number;
  readonly metadata?: Record<string, unknown>;
  readonly status?: "accepted" | "discarded";
  readonly discard_reason?: string;
};

export type IntelligenceObservationCandidate = {
  readonly kind: ResearchObservationKind | "discarded";
  readonly statement: string;
  readonly source_index?: number;
  readonly confidence: number;
  readonly visibility?: "owner_visible" | "internal";
  readonly status?: "accepted" | "discarded";
  readonly discard_reason?: string;
  readonly metadata?: Record<string, unknown>;
};

export type IntelligenceHookCandidate = {
  readonly source_observation_index?: number;
  readonly hook_text: string;
  readonly language: LanguageModeDto;
  readonly status?: "active" | "used" | "discarded";
};

export type IntelligenceKnowledgeGapCandidate = {
  readonly field_key: string;
  readonly question_hint: string;
  readonly priority: number;
  readonly status?: "open" | "answered" | "skipped";
};

export type IntelligenceMappingInput = {
  readonly status: IntelligenceResult["status"];
  readonly source_refs: readonly IntelligenceSourceCandidate[];
  readonly research_observations?: readonly IntelligenceObservationCandidate[];
  readonly conversation_hooks?: readonly IntelligenceHookCandidate[];
  readonly knowledge_gaps?: readonly IntelligenceKnowledgeGapCandidate[];
  readonly safe_error?: IntelligenceResult["safe_error"];
};

export type IntelligenceProgressEvent = {
  readonly stage: string;
  readonly status: "started" | "completed" | "failed";
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload?: Record<string, unknown>;
};

export type IntelligenceProgressCallback = (
  event: IntelligenceProgressEvent,
) => Promise<void>;

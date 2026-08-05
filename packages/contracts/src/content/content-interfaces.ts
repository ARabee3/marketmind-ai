import type {
  ContentCycle,
  ContentPack,
  ContentWeekContext,
  ContentWeekContextOwnerInput,
} from "./content-cycle";
import type { BusinessProfile } from "../discovery/business-profile.schema";
import type { StrategyPlan } from "../strategy/strategy-plan";
import type {
  ContentAsset,
  ContentDecision,
  ContentItemVersion,
} from "./content-item";
import type {
  ContentChannel,
  ContentFormat,
  ContentValidationResult,
  IsoDateTime,
  LanguageMode,
  UUID,
} from "./content-types";
import type { PublicationCandidateV1 } from "./publication-candidate";

export type ContentProgressStage =
  | "queued"
  | "context"
  | "generating"
  | "validating"
  | "ready"
  | "failed";

export type ContentProgressStatus =
  | "started"
  | "progress"
  | "complete"
  | "failed";

export type ContentProgressEvent = {
  readonly type: "content_progress";
  readonly content_pack_id: UUID;
  readonly seq: number;
  readonly stage: ContentProgressStage;
  readonly status: ContentProgressStatus;
  readonly message_key: string;
  readonly message_text: string;
  readonly payload: Record<string, unknown>;
  readonly created_at: IsoDateTime;
};

export type StartContentCycleRequest = {
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
};

export type CreateContentCycleRequest = {
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  readonly idempotency_key: string;
  readonly initial_week_context: UpsertContentWeekContextRequest;
};

export type ContentCycleResponse = {
  readonly content_cycle: ContentCycle;
  readonly initial_week_context: ContentWeekContext;
};

export type UpdateContentWeekContextRequest = UpsertContentWeekContextRequest;

export type GenerateContentWeekRequest = GenerateContentPackRequest;

export type ContentWeekListResponse = {
  readonly weeks: readonly ContentWeekContext[];
};

export type GenerateContentWeekResponse = {
  readonly content_pack: ContentPack;
  readonly item_versions: readonly ContentItemVersion[];
  readonly validation: ContentValidationResult;
};

export type UpsertContentWeekContextRequest = ContentWeekContextOwnerInput;

export type GenerateContentPackRequest = {
  readonly content_cycle_id: UUID;
  readonly week_number: number;
  readonly idempotency_key: string;
};

export type AiContentGenerateRequest = InternalContentGenerateRequest;

export type AiContentGenerateResponse = InternalContentGenerateResponse;

export type AiContentReviseRequest = {
  readonly contract_version: "content-v1";
  readonly content_pack_id: UUID;
  readonly content_item_id: UUID;
  readonly base_item_version_id: UUID;
  readonly revision_notes: string;
  readonly idempotency_key: string;
};

export type AiContentReviseResponse = {
  readonly contract_version: "content-v1";
  readonly item_version: ContentItemVersion;
  readonly validation: ContentValidationResult;
};

export type AiStaticAssetGenerateRequest = {
  readonly contract_version: "content-v1";
  readonly asset_id: UUID;
  readonly content_item_version_id: UUID;
  readonly creative_brief: string;
  readonly alt_text: string;
  readonly width: number;
  readonly height: number;
  readonly idempotency_key: string;
};

export type AiStaticAssetGenerateResponse = {
  readonly contract_version: "content-v1";
  readonly asset: ContentAsset;
  readonly validation: ContentValidationResult;
};

export type InternalContentGenerateRequest = {
  readonly contract_version: "content-v1";
  readonly content_pack_id: UUID;
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  readonly strategy_plan: StrategyPlan;
  readonly business_profile: BusinessProfile;
  readonly week_context: ContentWeekContext;
  readonly selected_channels: readonly ContentChannel[];
  readonly allowed_formats: readonly ContentFormat[];
  readonly language_mode: LanguageMode;
  readonly voice_examples?: readonly string[];
};

export type InternalContentGenerateResponse = {
  readonly contract_version: "content-v1";
  readonly content_pack: ContentPack;
  readonly item_versions: readonly ContentItemVersion[];
  readonly validation: ContentValidationResult;
};

export type ContentDecisionRequest = {
  readonly content_item_id: UUID;
  readonly content_item_version_id: UUID;
  readonly content_item_version_checksum: string;
  readonly decision: ContentDecision["decision"];
  readonly revision_notes: string | null;
  readonly idempotency_key: string;
};

export type ContentDecisionResponse = {
  readonly decision: ContentDecision;
  readonly publication_candidate: PublicationCandidateV1 | null;
};

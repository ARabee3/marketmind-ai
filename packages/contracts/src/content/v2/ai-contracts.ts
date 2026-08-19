import type { BusinessProfile } from "../../discovery/business-profile.schema";
import type {
  ContentChannel,
  ContentErrorCode,
  ContentFormat,
  ContentValidationResult,
  LanguageMode,
  UUID,
} from "../content-types";
import type { StrategyPlanV2 } from "../../strategy/strategy-v2";
import type { ContentCtaLibraryEntryV2 } from "./cta-library";
import type { ContentEditorialProfileV2 } from "./editorial-profile";
import type { ContentMediaLibraryEntryV2 } from "./media-library";
import type { ContentV2FrozenInput, ContentPostPlanV2 } from "./week-plan";
import type { ContentPackV2, ContentCycleV2 } from "./workspace";
import type { ContentItemVersionV2 } from "./version-metadata";

/**
 * Internal AI service contracts (content-v2, issue #187).
 *
 * Two stages: the planner creates only high-level post cards, and the
 * full-draft worker consumes a transactionally frozen snapshot to produce
 * immutable item versions. Both stay inside the explicit-generation
 * boundary; nothing schedules or publishes.
 */

/** Owner-editable plan card surface returned by the planner. */
export type ContentPostPlanDraftV2 = {
  readonly purpose: string;
  readonly intended_audience: string | null;
  readonly channel: ContentChannel;
  readonly format: ContentFormat;
  readonly cta_library_entry_id: UUID | null;
  readonly owner_instructions: string | null;
  readonly visual_direction: string | null;
  readonly selected_media_ids: readonly UUID[];
};

export type AiContentV2PlanRequest = {
  readonly contract_version: "content-v2";
  readonly week_plan_id: UUID;
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  /** The approved Strategy v2 plan; channels/formats validate against it. */
  readonly strategy_plan: StrategyPlanV2;
  readonly week_number: number;
  readonly editorial_profile: ContentEditorialProfileV2;
  readonly cta_library: readonly ContentCtaLibraryEntryV2[];
  readonly media_library: readonly ContentMediaLibraryEntryV2[];
  readonly allowed_channels: readonly ContentChannel[];
  readonly allowed_formats: readonly ContentFormat[];
  readonly language_mode: LanguageMode;
  readonly idempotency_key: string;
};

export type AiContentV2PlanResponse = {
  readonly contract_version: "content-v2";
  readonly week_plan_id: UUID;
  /** Exactly 3–5 high-level post plans; no publishable copy. */
  readonly post_plans: readonly ContentPostPlanDraftV2[];
  readonly validation: ContentValidationResult;
};

/** Safe summary from a previous terminal generation run. */
export type ContentGenerationFailureContextV2 = {
  readonly error_code: ContentErrorCode;
  readonly message: string;
};

export type AiContentV2GenerateRequest = {
  readonly contract_version: "content-v2";
  readonly content_pack_id: UUID;
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  readonly strategy_plan: StrategyPlanV2;
  readonly business_profile: BusinessProfile;
  /** The frozen plan/profile/CTA/media snapshot claimed by this run. */
  readonly frozen_input: ContentV2FrozenInput;
  readonly language_mode: LanguageMode;
  readonly idempotency_key: string;
  /** Present only for an explicit owner regeneration after a failed pack. */
  readonly prior_failure?: ContentGenerationFailureContextV2;
};

export type AiContentV2GenerateResponse = {
  readonly contract_version: "content-v2";
  readonly content_pack: ContentPackV2;
  readonly cycle: ContentCycleV2;
  readonly item_versions: readonly ContentItemVersionV2[];
  readonly validation: ContentValidationResult;
};

/**
 * AI rewrite (content-v2, issue #187). Carries the same frozen generation
 * context as the full-draft worker plus the read-only base version and the
 * owner's revision notes; the AI service reuses the v1 revision machinery
 * against that grounded snapshot.
 */
export type AiContentV2ReviseRequest = AiContentV2GenerateRequest & {
  readonly content_item_id: UUID;
  readonly base_item_version: ContentItemVersionV2;
  readonly revision_notes: string;
};

export type AiContentV2ReviseResponse = {
  readonly contract_version: "content-v2";
  readonly item_version: ContentItemVersionV2;
  readonly validation: ContentValidationResult;
};

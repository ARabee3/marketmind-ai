import type { ContentCycle, ContentPack } from "../content-cycle";
import type { ContentDecision } from "../content-item";
import type {
  ContentChannel,
  ContentFormat,
  IsoDateTime,
  UUID,
} from "../content-types";
import type { PublicationCandidateV1 } from "../publication-candidate";
import type { ContentCtaLibraryEntryV2 } from "./cta-library";
import type { ContentEditorialProfileV2 } from "./editorial-profile";
import type { ContentMediaLibraryEntryV2 } from "./media-library";
import type { ContentPostPlanV2 } from "./week-plan";
import type { ContentItemVersionV2 } from "./version-metadata";

/** v2 cycle row: same shape as v1, new contract tag. */
export type ContentCycleV2 = Omit<ContentCycle, "contract_version"> & {
  readonly contract_version: "content-v2";
};

/** v2 pack row: same shape as v1, new contract tag, plan link. */
export type ContentPackV2 = Omit<ContentPack, "contract_version"> & {
  readonly contract_version: "content-v2";
  readonly week_plan_id: UUID | null;
};

export type ContentWeekHistoryStatusV2 =
  | "not_started"
  | "planned"
  | "generating"
  | "ready"
  | "completed";

/** Compact previous/next week surface for the weekly studio rhythm. */
export type ContentWeekSummaryV2 = {
  readonly week_number: number;
  readonly week_start_date: string;
  readonly status: ContentWeekHistoryStatusV2;
  readonly plan_id: UUID | null;
  readonly pack_id: UUID | null;
  /** True when the pack has an approved publication candidate. */
  readonly publication_candidate_created: boolean;
};

/**
 * "Why this week?" — a collapsed contextual panel sourced from the approved
 * Strategy v2 handoff: focus, expected outcome, measurement check, owner
 * advice, committed channels, and formats.
 */
export type ContentWhyThisWeekV2 = {
  readonly focus: string;
  readonly expected_outcome: string;
  readonly measurement_check: string;
  readonly owner_advice: readonly string[];
  readonly committed_channels: readonly ContentChannel[];
  readonly formats: readonly ContentFormat[];
};

export type ContentStrategyReferenceV2 = {
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  readonly plan_goal: string;
  readonly plan_language: string;
};

/**
 * Real aggregate read model for `GET /content-cycles/:id/workspace`
 * (issue #187). No fixture fallback: loading/error states are explicit.
 */
export type ContentCycleWorkspaceV2 = {
  readonly contract_version: "content-v2";
  readonly cycle: ContentCycleV2;
  readonly editorial_profile: ContentEditorialProfileV2 | null;
  readonly cta_library: readonly ContentCtaLibraryEntryV2[];
  readonly media_library: readonly ContentMediaLibraryEntryV2[];
  readonly current_week: ContentCurrentWeekWorkspaceV2;
  readonly previous_weeks: readonly ContentWeekSummaryV2[];
  readonly next_week: ContentWeekSummaryV2 | null;
  readonly why_this_week: ContentWhyThisWeekV2;
  readonly strategy: ContentStrategyReferenceV2;
  readonly view_full_strategy_route: string;
};

export type ContentCurrentWeekWorkspaceV2 = {
  readonly week_number: number;
  readonly goal: string;
  readonly generation_state:
    | "not_started"
    | "planned"
    | "queued"
    | "generating"
    | "ready"
    | "failed";
  readonly week_plan: {
    readonly id: UUID;
    readonly status: "draft" | "frozen";
    readonly post_plans: readonly ContentPostPlanV2[];
  } | null;
  readonly pack: ContentPackV2 | null;
  readonly next_generation_at: IsoDateTime | null;
  readonly primary_action:
    | "configure_editorial_profile"
    | "plan_week"
    | "refine_plan"
    | "generate"
    | "review_pack"
    | "retry"
    | "none";
};

/**
 * Real aggregate read model for `GET /content-packs/:id/workspace`
 * (issue #187). The frontend fixture fallback is removed once served.
 */
export type ContentPackWorkspaceV2 = {
  readonly contract_version: "content-v2";
  readonly pack: ContentPackV2;
  readonly week_number: number;
  readonly week_start_date: string;
  readonly editorial_profile: ContentEditorialProfileV2 | null;
  readonly items: readonly ContentPackItemWorkspaceV2[];
  readonly publication_candidate: PublicationCandidateV1 | null;
};

export type ContentPackItemWorkspaceV2 = {
  readonly content_item_id: UUID;
  readonly plan: ContentPostPlanV2 | null;
  readonly current_version: ContentItemVersionV2;
  readonly versions: readonly ContentItemVersionV2[];
  readonly decision: ContentDecision | null;
};

export type ContentCycleWorkspaceResponse = {
  readonly workspace: ContentCycleWorkspaceV2;
};

export type ContentPackWorkspaceResponse = {
  readonly workspace: ContentPackWorkspaceV2;
};

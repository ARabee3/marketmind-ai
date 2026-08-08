import type {
  ContentCycleStatus,
  ContentPack,
  ContentWeekContext,
} from "./content-cycle";
import type {
  ContentAsset,
  ContentDecision,
  ContentItemVersion,
} from "./content-item";
import type { InternalContentGenerateRequest } from "./content-interfaces";
import type { StrategyPlan } from "../strategy/strategy-plan";
import { isStrategyPlanV2 } from "../strategy/strategy-v2";
import type {
  ContentChannel,
  ContentErrorCode,
  ContentValidationIssue,
  ContentValidationResult,
  IsoDateTime,
  UUID,
} from "./content-types";
import {
  CONTENT_ALT_TEXT_MAX_LENGTH,
  isSha256Checksum,
} from "./content-types";

export type ContentPolicyFixture = {
  readonly strategy_status: "approved" | "draft" | "rejected";
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision: {
    readonly id: UUID;
    readonly strategy_id: UUID;
    readonly strategy_version: number;
    readonly decision: "approved" | "rejected" | "revision_requested";
  };
  readonly cycle_status?: ContentCycleStatus;
  readonly profile_version_id: UUID;
  readonly current_profile_version_id: UUID;
  readonly selected_channels: readonly ContentChannel[];
  readonly existing_weekly_claims: readonly {
    readonly content_cycle_id: UUID;
    readonly week_number: number;
    readonly weekly_claim_id: UUID;
  }[];
  readonly week_context: ContentWeekContext;
  readonly pack: ContentPack;
  readonly item_version: ContentItemVersion;
  readonly assets: readonly ContentAsset[];
  readonly decision?: ContentDecision;
  readonly protected_text_mutated?: boolean;
};

const blockedClaimCodes: Record<string, ContentErrorCode> = {
  price: "CONTENT_UNSUPPORTED_CLAIM",
  availability: "CONTENT_UNSUPPORTED_CLAIM",
  superiority: "CONTENT_UNSUPPORTED_CLAIM",
  testimonial: "CONTENT_UNSUPPORTED_CLAIM",
  guarantee: "CONTENT_POLICY_VIOLATION",
  regulated: "CONTENT_POLICY_VIOLATION",
  branded_sponsored: "CONTENT_POLICY_VIOLATION",
  competitor_comparison: "CONTENT_UNSUPPORTED_CLAIM",
  health_claim: "CONTENT_POLICY_VIOLATION",
};

const addIssue = (
  issues: ContentValidationIssue[],
  code: ContentErrorCode,
  field: string,
  message: string,
  retryable = false,
): void => {
  issues.push({ code, field, message, retryable });
};

function isWeekInRange(weekNumber: number): boolean {
  return Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= 12;
}

function promotionExpired(fixture: ContentPolicyFixture): boolean {
  const promotion = fixture.week_context.promotion;
  return (
    promotion !== null &&
    Date.parse(promotion.valid_until) <
      Date.parse(fixture.item_version.recommended_publish_window.starts_at)
  );
}

function hasReadyPublishableAsset(fixture: ContentPolicyFixture): boolean {
  const assetsById = new Map(fixture.assets.map((asset) => [asset.id, asset]));
  return fixture.item_version.asset_ids.some((assetId) => {
    const asset = assetsById.get(assetId);
    return (
      asset?.status === "ready" &&
      (asset.kind === "owner_supplied" || asset.kind === "generated_static") &&
      isSha256Checksum(asset.checksum) &&
      asset.storage_key !== null
    );
  });
}

export function validateContentPolicyFixture(
  fixture: ContentPolicyFixture,
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];

  if (fixture.cycle_status === "paused") {
    addIssue(
      issues,
      "CONTENT_CYCLE_PAUSED",
      "cycle_status",
      "Generation is blocked while the content cycle is paused.",
    );
  }

  if (fixture.cycle_status === "completed") {
    addIssue(
      issues,
      "CONTENT_CYCLE_COMPLETED",
      "cycle_status",
      "Generation is blocked after the content cycle completes.",
    );
  }

  if (
    (fixture.week_context.context_source === "owner_confirmed" &&
      (!fixture.week_context.confirmed_by_user_id ||
        !fixture.week_context.confirmed_at ||
        fixture.week_context.system_defaulted_at !== null)) ||
    (fixture.week_context.context_source === "system_defaulted" &&
      (fixture.week_context.confirmed_by_user_id !== null ||
        fixture.week_context.confirmed_at !== null ||
        !fixture.week_context.system_defaulted_at ||
        fixture.week_context.promotion_mode !== "none" ||
        fixture.week_context.promotion !== null))
  ) {
    addIssue(
      issues,
      "CONTENT_POLICY_VIOLATION",
      "week_context.context_source",
      "Weekly context provenance must distinguish owner confirmation from a safe system default.",
    );
  }

  if (fixture.strategy_status !== "approved") {
    addIssue(
      issues,
      "CONTENT_STRATEGY_NOT_APPROVED",
      "strategy_status",
      "Content requires an exact owner-approved Strategy version.",
    );
  }

  if (
    fixture.strategy_decision.decision !== "approved" ||
    fixture.strategy_decision.strategy_id !== fixture.strategy_id ||
    fixture.strategy_decision.strategy_version !== fixture.strategy_version ||
    fixture.pack.strategy_decision_id !== fixture.strategy_decision.id
  ) {
    addIssue(
      issues,
      "CONTENT_STRATEGY_NOT_APPROVED",
      "strategy_decision",
      "Content requires the exact approval decision for the immutable Strategy version.",
    );
  }

  if (
    fixture.pack.strategy_id !== fixture.strategy_id ||
    fixture.pack.strategy_version !== fixture.strategy_version ||
    fixture.item_version.strategy_trace.strategy_id !== fixture.strategy_id ||
    fixture.item_version.strategy_trace.strategy_version !==
      fixture.strategy_version
  ) {
    addIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "pack.strategy_version",
      "Pack and item trace must reference the exact approved Strategy identity and version.",
    );
  }

  if (
    fixture.profile_version_id !== fixture.current_profile_version_id ||
    fixture.pack.profile_version_id !== fixture.profile_version_id
  ) {
    addIssue(
      issues,
      "CONTENT_PROFILE_STALE",
      "profile_version_id",
      "Content profile version must match the approved Strategy profile version.",
    );
  }

  if (!isWeekInRange(fixture.week_context.week_number)) {
    addIssue(
      issues,
      "CONTENT_WEEK_OUT_OF_RANGE",
      "week_context.week_number",
      "Content week must be an integer from 1 through 12.",
    );
  }

  if (
    fixture.pack.content_cycle_id !== fixture.week_context.content_cycle_id ||
    fixture.pack.week_context_id !== fixture.week_context.id ||
    fixture.pack.weekly_claim_id !== fixture.week_context.weekly_claim_id ||
    fixture.pack.week_number !== fixture.week_context.week_number ||
    fixture.item_version.strategy_trace.week_number !==
      fixture.week_context.week_number
  ) {
    addIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "pack.week_number",
      "Context, weekly claim, pack, and Strategy trace must reference the same cycle week.",
    );
  }

  if (
    fixture.item_version.content_pack_id !== fixture.pack.id ||
    !fixture.pack.item_ids.includes(fixture.item_version.content_item_id)
  ) {
    addIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "item_version.content_pack_id",
      "Content item version must belong to the validated pack and one of its stable item identities.",
    );
  }

  if (
    fixture.existing_weekly_claims.some(
      (claim) =>
        claim.content_cycle_id === fixture.week_context.content_cycle_id &&
        claim.week_number === fixture.week_context.week_number &&
        claim.weekly_claim_id !== fixture.pack.weekly_claim_id,
    )
  ) {
    addIssue(
      issues,
      "CONTENT_WEEK_ALREADY_CLAIMED",
      "week_context.weekly_claim_id",
      "A content cycle can claim a Strategy week only once.",
    );
  }

  if (!fixture.selected_channels.includes(fixture.item_version.channel)) {
    addIssue(
      issues,
      "CONTENT_CHANNEL_MISMATCH",
      "item_version.channel",
      "Content item channel must be selected by the approved Strategy.",
    );
  }

  if (
    fixture.item_version.strategy_trace.channel !== fixture.item_version.channel
  ) {
    addIssue(
      issues,
      "CONTENT_CHANNEL_MISMATCH",
      "item_version.strategy_trace.channel",
      "Content item channel must match its approved Strategy trace channel.",
    );
  }

  if (
    fixture.item_version.claim_sources.some(
      (claim) => claim.claim_type === "promotion" && !claim.approved,
    ) ||
    (fixture.week_context.promotion_mode !== "owner_approved" &&
      fixture.item_version.claim_sources.some(
        (claim) => claim.claim_type === "promotion",
      ))
  ) {
    addIssue(
      issues,
      "CONTENT_OFFER_UNAPPROVED",
      "item_version.claim_sources",
      "Promotions must come from explicit owner-approved weekly context.",
    );
  }

  if (promotionExpired(fixture)) {
    addIssue(
      issues,
      "CONTENT_OFFER_UNAPPROVED",
      "week_context.promotion.valid_until",
      "Expired promotions cannot be carried into generated content.",
    );
  }

  for (const claim of fixture.item_version.claim_sources) {
    const code = blockedClaimCodes[claim.claim_type];
    if (code && !claim.approved) {
      addIssue(
        issues,
        code,
        "item_version.claim_sources",
        "Unsupported, regulated, testimonial, guarantee, or competitor claims need approved evidence before Content approval.",
      );
    }
  }

  if (fixture.protected_text_mutated === true) {
    addIssue(
      issues,
      "CONTENT_POLICY_VIOLATION",
      "protected_text_mutated",
      "Protected owner/business text must not be silently rewritten.",
    );
  }

  if (
    fixture.item_version.asset_required &&
    !hasReadyPublishableAsset(fixture)
  ) {
    addIssue(
      issues,
      "CONTENT_ASSET_REQUIRED",
      "item_version.asset_ids",
      "Publication-ready content requires a ready owner-supplied or generated static asset.",
    );
  }

  if (
    fixture.item_version.asset_ids.some((assetId) => {
      const asset = fixture.assets.find(
        (candidate) => candidate.id === assetId,
      );
      return asset?.content_item_version_id !== fixture.item_version.id;
    })
  ) {
    addIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "item_version.asset_ids",
      "Every referenced asset must belong to the exact immutable Content item version.",
    );
  }

  if (fixture.pack.item_ids.length < 3 || fixture.pack.item_ids.length > 5) {
    addIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "pack.item_ids",
      "A content pack must reference between 3 and 5 content items.",
    );
  }

  if (
    fixture.item_version.asset_required &&
    fixture.assets.some(
      (asset) =>
        fixture.item_version.asset_ids.includes(asset.id) &&
        asset.status === "failed",
    )
  ) {
    addIssue(
      issues,
      "CONTENT_PROVIDER_FAILURE",
      "item_version.asset_ids",
      "Required asset generation failed and cannot be published.",
    );
  }

  if (
    fixture.decision?.decision === "approved" &&
    fixture.item_version.asset_required &&
    !hasReadyPublishableAsset(fixture)
  ) {
    addIssue(
      issues,
      "CONTENT_APPROVAL_BLOCKED",
      "item_version.asset_ids",
      "Content approval cannot produce a candidate until required assets are ready.",
    );
  }

  if (!fixture.item_version.alt_text.trim()) {
    addIssue(
      issues,
      "CONTENT_ASSET_REQUIRED",
      "item_version.alt_text",
      "Image-bearing Content requires non-empty alt text.",
    );
  } else if (
    fixture.item_version.alt_text.length > CONTENT_ALT_TEXT_MAX_LENGTH
  ) {
    addIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "item_version.alt_text",
      `Alt text must not exceed ${CONTENT_ALT_TEXT_MAX_LENGTH} characters (platform alt-text limit).`,
    );
  }

  if (
    fixture.decision?.decision === "approved" &&
    (fixture.decision.content_item_id !==
      fixture.item_version.content_item_id ||
      fixture.decision.content_item_version_id !== fixture.item_version.id ||
      fixture.decision.content_item_version !== fixture.item_version.version ||
      fixture.decision.content_item_version_checksum !==
        fixture.item_version.version_checksum)
  ) {
    addIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "decision.content_item_version_id",
      "Approval must reference the exact immutable Content item version and checksum.",
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validateRecommendedWindow(
  window: ContentItemVersion["recommended_publish_window"],
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];

  const start = Date.parse(window.starts_at);
  const end = Date.parse(window.ends_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    addIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "recommended_publish_window",
      "Recommended publish window must have a valid start before its end.",
    );
    return { valid: issues.length === 0, issues };
  }

  const startHour = new Date(start).getUTCHours();
  if (window.time_of_day_hint === "night" && startHour < 20 && startHour >= 6) {
    addIssue(
      issues,
      "CONTENT_PLATFORM_CONSTRAINT",
      "recommended_publish_window.time_of_day_hint",
      "Night-hint window starts in a busy daytime hour; check the business-audience rationale.",
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validateContentSchema(
  document: Record<string, unknown>,
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];
  const field = (name: string): unknown => document[name];

  const weekNumber = field("week_number");
  if (typeof weekNumber === "number" && !isWeekInRange(weekNumber)) {
    addIssue(
      issues,
      "CONTENT_WEEK_OUT_OF_RANGE",
      "week_number",
      "Content week must be an integer from 1 through 12.",
    );
  }

  const assetRequired = field("asset_required");
  const altText = field("alt_text");
  if (
    assetRequired === true &&
    typeof altText === "string" &&
    !altText.trim()
  ) {
    addIssue(
      issues,
      "CONTENT_ASSET_REQUIRED",
      "alt_text",
      "Image-bearing Content requires non-empty alt text.",
    );
  }
  if (
    typeof altText === "string" &&
    altText.length > CONTENT_ALT_TEXT_MAX_LENGTH
  ) {
    addIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "alt_text",
      `Alt text must not exceed ${CONTENT_ALT_TEXT_MAX_LENGTH} characters (platform alt-text limit).`,
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validateInternalContentGenerateRequest(
  request: InternalContentGenerateRequest,
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];
  const plan = request.strategy_plan;
  const profile = request.business_profile;

  if (
    plan.strategy_id !== request.strategy_id ||
    plan.version !== request.strategy_version
  ) {
    addIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "strategy_plan.version",
      "Generation requires the exact approved Strategy identity and version.",
    );
  }

  if (
    profile.business_id !== request.business_id ||
    plan.profile_version.business_profile_version_id !== profile.id ||
    plan.profile_version.version !== profile.version
  ) {
    addIssue(
      issues,
      "CONTENT_PROFILE_STALE",
      "business_profile.id",
      "Generation requires the confirmed Business Profile version referenced by Strategy.",
    );
  }

  if (plan.plan_language !== request.language_mode) {
    addIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "language_mode",
      "Generation language must match the approved Strategy language.",
    );
  }

  // Owner-first v2 plans read approved channels and the weekly mapping from
  // the deterministic content_handoff projection; v1 plans use the scorecard
  // and content_strategy roadmap.
  const planV2 = isStrategyPlanV2(plan) ? plan : null;
  const approvedChannels = new Set(
    planV2
      ? planV2.content_handoff.available === true
        ? planV2.content_handoff.channels
        : []
      : (plan as StrategyPlan).selected_channels.map(
          (scorecard) => scorecard.channel,
        ),
  );
  if (
    request.selected_channels.length === 0 ||
    request.selected_channels.some((channel) => !approvedChannels.has(channel))
  ) {
    addIssue(
      issues,
      "CONTENT_CHANNEL_MISMATCH",
      "selected_channels",
      "Generation channels must be selected by the approved Strategy.",
    );
  }

  const strategyWeek = planV2
    ? planV2.content_handoff.available === true
      ? planV2.content_handoff.weeks.find(
          (week) => week.week_number === request.week_context.week_number,
        )
      : undefined
    : (plan as StrategyPlan).content_strategy.weeks.find(
        (week) => week.week_number === request.week_context.week_number,
      );
  if (!strategyWeek) {
    addIssue(
      issues,
      "CONTENT_WEEK_OUT_OF_RANGE",
      "week_context.week_number",
      "Generation week must exist in the approved Strategy roadmap.",
    );
  }

  return { valid: issues.length === 0, issues };
}

import type {
  UUID,
  IsoDateTime,
  LanguageMode,
} from "../discovery/prepared-discovery-contracts";
import type {
  ContentChannel,
  ContentFormat,
} from "../content/content-types";
import type { BusinessProfileVersionRef } from "./strategy-ids";
import type {
  StrategyObjective,
  ExternalBudgetMode,
  ExternalBudgetEgp,
  StrategyClarification,
  StrategyBlocker,
} from "./strategy-brief";
import type {
  ChannelRole,
  SourcedClaim,
} from "./strategy-plan";
import type { KnowledgeGapItem, PlanCitation } from "./strategy-retrieval";

/**
 * Strategy v2 contract — owner-first.
 *
 * The owner must choose one primary channel and up to two supporting channels
 * before generation. Strategy never adds, replaces, or silently prioritizes
 * channels on the owner's behalf; the generated plan commits to exactly the
 * owner's choices.
 */

/**
 * The simple initial catalog. Facebook and Instagram map to `content-v1`
 * social channels; Google Business Profile (including Maps presence) maps to
 * `google_business_profile`. Delivery platforms and the website are
 * owner-managed presences with no `content-v1` representation.
 */
export const STRATEGY_V2_CHANNELS = [
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
  "delivery_platforms",
  "website",
] as const;

export type StrategyV2Channel = (typeof STRATEGY_V2_CHANNELS)[number];

export const CONTENT_SUPPORTED_V2_CHANNELS: ReadonlySet<string> = new Set([
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
]);

/**
 * Safe setup state for a chosen channel. `connected` may only be used when a
 * verified publishing target (owned by the business) backs the channel;
 * `existing_link` is an owner-managed public presence; `setup_later` keeps the
 * channel in the plan without pretending it is ready. No credentials, page
 * IDs, or provider secrets ever live in the brief.
 */
export const CHANNEL_SETUP_STATES = [
  "connected",
  "existing_link",
  "setup_later",
] as const;

export type ChannelSetupState = (typeof CHANNEL_SETUP_STATES)[number];

/**
 * Visible capability state on the plan's channel commitments. Real publishing
 * stays unavailable until #175 provides a verified target, so `publishing_ready`
 * is only produced for a channel with a verified target.
 */
export const CHANNEL_CAPABILITY_STATES = [
  "publishing_ready",
  "publishing_pending",
  "owner_managed",
] as const;

export type ChannelCapabilityState = (typeof CHANNEL_CAPABILITY_STATES)[number];

/**
 * Plain-language weekly-capacity presets replacing the free-text v1
 * `team_capacity` field. Locale-aware labels live in the UI dictionaries.
 */
export const STRATEGY_WEEKLY_CAPACITY_PRESETS = [
  "one_to_two_hours",
  "three_to_five_hours",
  "half_day",
  "full_day_plus",
] as const;

export type StrategyWeeklyCapacityPreset =
  (typeof STRATEGY_WEEKLY_CAPACITY_PRESETS)[number];

export interface StrategyChannelChoice {
  channel: StrategyV2Channel;
  role: ChannelRole;
  setup_state: ChannelSetupState;
  /** Owner-managed public presence URL; only allowed with `existing_link`. */
  public_url?: string;
  /**
   * Verified publishing target owned by the business (#175). Only allowed with
   * `connected`, and only the safe target projection is ever exposed.
   */
  publishing_target_id?: UUID;
  /** Owner note; never a credential or secret. */
  note?: string;
}

export interface StrategyBriefV2 {
  id: UUID;
  strategy_id: UUID;
  business_profile_version: BusinessProfileVersionRef;
  primary_objective: StrategyObjective;
  start_date: IsoDateTime;
  plan_language: LanguageMode;
  paid_media_allowed: boolean;
  external_budget_mode: ExternalBudgetMode;
  external_budget_egp: ExternalBudgetEgp;
  weekly_capacity: StrategyWeeklyCapacityPreset;
  weekly_capacity_note?: string;
  /** 1–3 unique catalog channels with exactly one primary choice. */
  channel_choices: StrategyChannelChoice[];
  constraints: string[];
  clarification_answers: StrategyClarification[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export function isStrategyV2Brief(
  brief: unknown,
): brief is StrategyBriefV2 {
  return (
    typeof brief === "object" &&
    brief !== null &&
    Array.isArray((brief as StrategyBriefV2).channel_choices)
  );
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface StrategyV2CalendarWeek {
  /** Exactly the weeks 1 through 12, each exactly once. */
  week_number: number;
  /** Owner-visible focus of the week. */
  focus: string;
  /** The expected outcome the owner can watch for. */
  expected_outcome: string;
  /** The concrete measurement check for the week. */
  measurement_check: string;
  /**
   * Strategy-vocabulary formats used this week. Deterministic adapter maps
   * them to exact `content-v1` formats; unknown-only weeks make the content
   * handoff unavailable instead of being silently dropped.
   */
  formats: string[];
}

export const OWNER_ADVICE_CATEGORIES = [
  "channel_setup",
  "audience",
  "content",
  "budget",
  "measurement",
  "capability",
] as const;

export type OwnerAdviceCategory = (typeof OWNER_ADVICE_CATEGORIES)[number];

export interface OwnerAdviceItem {
  id: UUID;
  /** 0 for the "Before week 1" bucket, 1–12 for the matching week. */
  week_number: number;
  category: OwnerAdviceCategory;
  /** What the owner does. Never pretends MarketMind performs the action. */
  action: string;
  why_it_matters: string;
  timing: string;
  /** Grounded source or explicit uncertainty for the advice. */
  source: SourcedClaim;
}

export interface OwnerAdviceWeek {
  week_number: number;
  items: OwnerAdviceItem[];
}

export interface OwnerAdvice {
  /** "Before week 1" collection (items with `week_number: 0`). */
  before_week_1: OwnerAdviceItem[];
  /** One collection for each week 1–12. */
  weeks: OwnerAdviceWeek[];
}

export interface ChannelCommitment {
  /** Must be exactly an owner-selected channel; no extra choices appear. */
  channel: StrategyV2Channel;
  role: ChannelRole;
  setup_state: ChannelSetupState;
  capability_state: ChannelCapabilityState;
  /** Short plain-language rationale grounded in evidence/owner input. */
  rationale: SourcedClaim;
}

export interface ContentHandoffWeek {
  week_number: number;
  /** Non-empty, exact `content-v1` formats. */
  formats: ContentFormat[];
}

/**
 * Complete, deterministic `content-v1` projection of the approved plan.
 * Only existing ContentChannel/ContentFormat values are allowed; all twelve
 * weeks are present; no free-text format parsing or fallback happens later.
 */
export interface ContentHandoffAvailable {
  available: true;
  channels: ContentChannel[];
  language: LanguageMode;
  weeks: ContentHandoffWeek[];
}

export const CONTENT_HANDOFF_UNAVAILABLE_REASONS = [
  "no_content_supported_channels",
  "incomplete_weekly_formats",
] as const;

export type ContentHandoffUnavailableReason =
  (typeof CONTENT_HANDOFF_UNAVAILABLE_REASONS)[number];

/**
 * Explicit unavailable state with a machine-readable reason. The Strategy
 * remains approvable as an owner-managed plan, but Content cycle creation
 * must fail closed with this reason.
 */
export interface ContentHandoffUnavailable {
  available: false;
  reason: ContentHandoffUnavailableReason;
  message: string;
}

export type ContentHandoff = ContentHandoffAvailable | ContentHandoffUnavailable;

export function isContentHandoffAvailable(
  handoff: ContentHandoff,
): handoff is ContentHandoffAvailable {
  return handoff.available === true;
}

export interface StrategyPlanV2 {
  id: UUID;
  strategy_id: UUID;
  version: number;
  contract_version: "strategy-v2";
  brief_id: UUID;
  profile_version: BusinessProfileVersionRef;
  retrieval_run_id: UUID;
  /** Owner-visible statement of what the plan sets out to do. */
  goal: SourcedClaim;
  primary_objective: StrategyObjective;
  funnel_stage: string;
  plan_language: LanguageMode;
  start_date: IsoDateTime;
  /** The primary visual object: exactly 12 ordered entries. */
  calendar_weeks: StrategyV2CalendarWeek[];
  owner_advice: OwnerAdvice;
  /** Exact owner-selected channels with rationale and capability state. */
  channel_commitments: ChannelCommitment[];
  evidence_summary: SourcedClaim;
  risks: SourcedClaim[];
  knowledge_gaps: KnowledgeGapItem[];
  blockers: StrategyBlocker[];
  citations: PlanCitation[];
  content_handoff: ContentHandoff;
  created_at: IsoDateTime;
}

export function isStrategyPlanV2(plan: unknown): plan is StrategyPlanV2 {
  return (
    typeof plan === "object" &&
    plan !== null &&
    (plan as StrategyPlanV2).contract_version === "strategy-v2"
  );
}

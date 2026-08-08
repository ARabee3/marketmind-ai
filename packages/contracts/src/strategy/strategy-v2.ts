/**
 * strategy-v2 — owner-first Strategy contract (#135).
 *
 * v2 replaces v1's universal-channel scorecard brief/review with an
 * owner-selected channel set, an owner-visible 12-week calendar, owner-led
 * advice, and a deterministic content-v1 handoff. It is a NEW versioned
 * contract: v1 plans remain readable/reviewable exactly as persisted and are
 * never mutated or reinterpreted.
 *
 * Core invariants (enforced by `validateStrategyPlanV2` and the FastAPI
 * mirror in packages/contracts/python/strategy_contracts.py):
 *  - brief.channel_choices: 1–3 UNIQUE catalog channels, exactly one primary,
 *    zero to two supporting, safe setup state, optional verified
 *    publishing_target_id, optional owner-managed public_url, and NO page id,
 *    access token, credential reference, or provider secret.
 *  - plan.calendar_weeks: exactly 12 ordered entries (week_number 1..12).
 *  - plan.channel_commitments: exactly the owner-selected channels — never an
 *    added, replaced, or silently re-prioritized channel.
 *  - plan.content_handoff: either a complete deterministic content-v1
 *    projection (only existing ContentChannel / ContentFormat values, all 12
 *    weeks, selected language) or an explicit unavailable state with a
 *    machine-readable reason. No free-text format parsing or fallback.
 */
import type { UUID, IsoDateTime, LanguageMode } from "../discovery/prepared-discovery-contracts";
import type { ContentChannel, ContentFormat } from "../content/content-types";
import type { BusinessProfileVersionRef } from "./strategy-ids";
import type { StrategyObjective } from "./strategy-brief";

// ---------------------------------------------------------------------------
// Owner channel selection
// ---------------------------------------------------------------------------

/** Simple initial catalog (#135). Meta channels may additionally carry a
 *  verified `publishing_target_id` once #175 lands; every card supports
 *  `existing_link` or `setup_later`. */
export const STRATEGY_CHANNEL_CATALOG = [
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
  "delivery_platforms",
  "website",
] as const;

export type StrategyChannel = (typeof STRATEGY_CHANNEL_CATALOG)[number];

export const STRATEGY_CHANNEL_SETUP_STATES = [
  "connected",
  "existing_link",
  "setup_later",
] as const;

/** Safe setup state for a selected channel. `connected` only for a verified
 *  publishing target owned by the business (#175). */
export type StrategyChannelSetupState = (typeof STRATEGY_CHANNEL_SETUP_STATES)[number];

export interface StrategyChannelChoice {
  channel: StrategyChannel;
  /** Exactly one channel must be the primary focus. */
  is_primary: boolean;
  setup_state: StrategyChannelSetupState;
  /** Only for a VERIFIED target owned by the business (#175 safe projection). */
  publishing_target_id?: UUID;
  /** Only for an owner-managed existing presence. */
  public_url?: string;
}

export const STRATEGY_WEEKLY_CAPACITY_PRESETS = [
  "minimal",
  "light",
  "moderate",
  "dedicated",
] as const;

/** Plain-language weekly-capacity preset replacing v1's free-text capacity. */
export type StrategyWeeklyCapacityPreset = (typeof STRATEGY_WEEKLY_CAPACITY_PRESETS)[number];

export interface StrategyBriefV2 {
  id: UUID;
  strategy_id: UUID;
  business_profile_version: BusinessProfileVersionRef;
  primary_objective: StrategyObjective;
  /** 1–3 unique catalog channels, exactly one primary. */
  channel_choices: StrategyChannelChoice[];
  weekly_capacity_preset: StrategyWeeklyCapacityPreset;
  capacity_note?: string;
  plan_language: LanguageMode;
  /** Defaults to the following Monday in Africa/Cairo; owner-adjustable. */
  start_date: IsoDateTime;
  paid_media_allowed: boolean;
  /** Optional constraint note. Plain language only. */
  constraints?: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Plan: calendar, advice, commitments, handoff
// ---------------------------------------------------------------------------

/** One of exactly 12 ordered owner-visible weeks. */
export interface CalendarWeekV2 {
  week_number: number;
  focus: string;
  expected_outcome: string;
  measurement_check: string;
}

export const OWNER_ADVICE_CATEGORIES = [
  "setup",
  "content",
  "engagement",
  "offer",
  "measurement",
  "operations",
] as const;

export type OwnerAdviceCategory = (typeof OWNER_ADVICE_CATEGORIES)[number];

export interface OwnerAdviceItem {
  /** The owner action. Never pretends MarketMind will perform the action. */
  action: string;
  why_it_matters: string;
  /** When the owner should do it relative to the plan. */
  timing: string;
  category: OwnerAdviceCategory;
  /** Grounded source; `uncertainty` states what is not yet known. */
  grounded_source: string | null;
  uncertainty: string | null;
}

export interface OwnerAdviceV2 {
  before_week_1: OwnerAdviceItem[];
  /** Buckets for weeks 1..12, in order. */
  weeks: OwnerAdviceWeekBucket[];
}

export interface OwnerAdviceWeekBucket {
  week_number: number;
  items: OwnerAdviceItem[];
}

export interface ChannelCommitmentV2 {
  channel: StrategyChannel;
  role: "primary" | "supporting";
  /** Short plain-language rationale for choosing this channel. */
  rationale: string;
  /** Visible capability state the owner sees next to the channel card. */
  capability_state: StrategyChannelSetupState;
}

export const CONTENT_HANDOFF_UNAVAILABLE_REASONS = [
  "content_v1_unsupported_channels_only",
  "content_v1_handoff_unavailable",
] as const;

export type ContentHandoffUnavailableReason = (typeof CONTENT_HANDOFF_UNAVAILABLE_REASONS)[number];

export interface ContentHandoffWeek {
  week_number: number;
  channel: ContentChannel;
  format: ContentFormat;
}

/** Deterministic content-v1 projection. Usable only when every week maps to
 *  existing ContentChannel/ContentFormat values and the selected language. */
export interface ContentHandoffV2Available {
  available: true;
  language: LanguageMode;
  weeks: ContentHandoffWeek[];
}

export interface ContentHandoffV2Unavailable {
  available: false;
  reason: ContentHandoffUnavailableReason;
}

export type ContentHandoffV2 = ContentHandoffV2Available | ContentHandoffV2Unavailable;

export interface StrategyPlanV2 {
  id: UUID;
  strategy_id: UUID;
  version: number;
  contract_version: "strategy-v2";
  brief_id: UUID;
  profile_version: BusinessProfileVersionRef;
  primary_objective: StrategyObjective;
  plan_language: LanguageMode;
  start_date: IsoDateTime;
  calendar_weeks: CalendarWeekV2[];
  owner_advice: OwnerAdviceV2;
  channel_commitments: ChannelCommitmentV2[];
  content_handoff: ContentHandoffV2;
  /** Egypt-first, then MENA, then clearly labelled global fallback. */
  evidence_regions: Array<"egypt" | "mena" | "global_fallback">;
  risks: string[];
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Deterministic validation
// ---------------------------------------------------------------------------

export interface StrategyV2ValidationIssue {
  code:
    | "STRATEGY_V2_CHANNEL_COUNT"
    | "STRATEGY_V2_CHANNEL_UNIQUE"
    | "STRATEGY_V2_PRIMARY_COUNT"
    | "STRATEGY_V2_CHANNEL_UNKNOWN"
    | "STRATEGY_V2_SETUP_STATE"
    | "STRATEGY_V2_SECRET_FIELD"
    | "STRATEGY_V2_WEEK_COUNT"
    | "STRATEGY_V2_WEEK_SEQUENCE"
    | "STRATEGY_V2_COMMITMENT_MISMATCH"
    | "STRATEGY_V2_HANDOFF_CHANNEL"
    | "STRATEGY_V2_HANDOFF_FORMAT"
    | "STRATEGY_V2_HANDOFF_WEEKS"
    | "STRATEGY_V2_HANDOFF_LANGUAGE";
  field: string;
  message: string;
}

const STRATEGY_CHANNEL_SET = new Set<string>(STRATEGY_CHANNEL_CATALOG);
const CONTENT_CHANNEL_SET = new Set<string>([
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
]);
const CONTENT_FORMAT_SET = new Set<string>([
  "static_image_post",
  "short_video_script",
  "carousel_brief",
  "text_post",
]);
const SECRET_KEYS = new Set([
  "page_id",
  "page_id_token",
  "access_token",
  "token",
  "credential_ref",
  "credential_reference",
  "provider_secret",
  "secret",
  "password",
]);

function issuesFor(issues: StrategyV2ValidationIssue[]): { valid: boolean; issues: StrategyV2ValidationIssue[] } {
  return { valid: issues.length === 0, issues };
}

function validateChannelChoices(choices: unknown, issues: StrategyV2ValidationIssue[]): void {
  if (!Array.isArray(choices) || choices.length < 1 || choices.length > 3) {
    issues.push({
      code: "STRATEGY_V2_CHANNEL_COUNT",
      field: "channel_choices",
      message: "channel_choices must contain 1-3 channels",
    });
    return;
  }
  const seen = new Set<string>();
  let primaryCount = 0;
  for (const raw of choices) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const choice = raw as Record<string, unknown>;
    const channel = choice["channel"];
    if (typeof channel !== "string" || !STRATEGY_CHANNEL_SET.has(channel)) {
      issues.push({
        code: "STRATEGY_V2_CHANNEL_UNKNOWN",
        field: `channel_choices[].channel`,
        message: `unknown channel '${String(channel)}'`,
      });
      continue;
    }
    if (seen.has(channel)) {
      issues.push({
        code: "STRATEGY_V2_CHANNEL_UNIQUE",
        field: `channel_choices[].channel`,
        message: `channel '${channel}' selected more than once`,
      });
    }
    seen.add(channel);
    if (choice["is_primary"] === true) primaryCount += 1;
    const setup = choice["setup_state"];
    if (typeof setup !== "string" || !STRATEGY_CHANNEL_SETUP_STATES.includes(setup as never)) {
      issues.push({
        code: "STRATEGY_V2_SETUP_STATE",
        field: `channel_choices[].setup_state`,
        message: `invalid setup_state '${String(setup)}'`,
      });
    }
    // No page id, access token, credential reference, or provider secret.
    for (const key of Object.keys(choice)) {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        issues.push({
          code: "STRATEGY_V2_SECRET_FIELD",
          field: `channel_choices[].${key}`,
          message: `forbidden secret-bearing field '${key}'`,
        });
      }
    }
  }
  if (primaryCount !== 1) {
    issues.push({
      code: "STRATEGY_V2_PRIMARY_COUNT",
      field: "channel_choices",
      message: `exactly one primary channel required, found ${primaryCount}`,
    });
  }
}

function validatePlanStructure(plan: Record<string, unknown>, issues: StrategyV2ValidationIssue[]): void {
  // Exactly 12 ordered calendar weeks.
  const weeks = plan["calendar_weeks"];
  if (!Array.isArray(weeks) || weeks.length !== 12) {
    issues.push({
      code: "STRATEGY_V2_WEEK_COUNT",
      field: "calendar_weeks",
      message: `calendar_weeks must contain exactly 12 entries, found ${Array.isArray(weeks) ? weeks.length : "none"}`,
    });
  } else {
    for (let i = 0; i < 12; i += 1) {
      const week = weeks[i];
      const number = week && typeof week === "object" ? (week as Record<string, unknown>)["week_number"] : undefined;
      if (number !== i + 1) {
        issues.push({
          code: "STRATEGY_V2_WEEK_SEQUENCE",
          field: `calendar_weeks[${i}].week_number`,
          message: `expected week_number ${i + 1}, found ${String(number)}`,
        });
        break;
      }
    }
  }
}

function validateCommitments(
  plan: Record<string, unknown>,
  briefChoices: string[],
  issues: StrategyV2ValidationIssue[],
): void {
  const commitments = plan["channel_commitments"];
  if (!Array.isArray(commitments)) {
    issues.push({
      code: "STRATEGY_V2_COMMITMENT_MISMATCH",
      field: "channel_commitments",
      message: "channel_commitments must be an array",
    });
    return;
  }
  const committed = commitments
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>)["channel"] : undefined))
    .filter((c): c is string => typeof c === "string");
  const committedSet = new Set(committed);
  const briefSet = new Set(briefChoices);
  for (const channel of briefSet) {
    if (!committedSet.has(channel)) {
      issues.push({
        code: "STRATEGY_V2_COMMITMENT_MISMATCH",
        field: "channel_commitments",
        message: `commitment missing for selected channel '${channel}'`,
      });
    }
  }
  for (const channel of committedSet) {
    if (!briefSet.has(channel)) {
      issues.push({
        code: "STRATEGY_V2_COMMITMENT_MISMATCH",
        field: "channel_commitments",
        message: `commitment for unselected channel '${channel}'`,
      });
    }
  }
}

function validateHandoff(plan: Record<string, unknown>, issues: StrategyV2ValidationIssue[]): void {
  const handoff = plan["content_handoff"];
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    issues.push({
      code: "STRATEGY_V2_HANDOFF_WEEKS",
      field: "content_handoff",
      message: "content_handoff must be an object",
    });
    return;
  }
  const h = handoff as Record<string, unknown>;
  if (h["available"] === false) {
    const reason = h["reason"];
    if (
      typeof reason !== "string" ||
      !CONTENT_HANDOFF_UNAVAILABLE_REASONS.includes(reason as never)
    ) {
      issues.push({
        code: "STRATEGY_V2_HANDOFF_WEEKS",
        field: "content_handoff.reason",
        message: `unavailable handoff needs a machine-readable reason, found '${String(reason)}'`,
      });
    }
    return;
  }
  if (h["available"] !== true) {
    issues.push({
      code: "STRATEGY_V2_HANDOFF_WEEKS",
      field: "content_handoff.available",
      message: "content_handoff.available must be boolean",
    });
    return;
  }
  const language = h["language"];
  if (language !== "ar-EG" && language !== "en" && language !== "mixed") {
    issues.push({
      code: "STRATEGY_V2_HANDOFF_LANGUAGE",
      field: "content_handoff.language",
      message: `invalid handoff language '${String(language)}'`,
    });
  }
  const weeks = h["weeks"];
  if (!Array.isArray(weeks) || weeks.length !== 12) {
    issues.push({
      code: "STRATEGY_V2_HANDOFF_WEEKS",
      field: "content_handoff.weeks",
      message: "available handoff must map all 12 weeks",
    });
    return;
  }
  const seenWeeks = new Set<number>();
  for (const week of weeks) {
    if (!week || typeof week !== "object" || Array.isArray(week)) continue;
    const w = week as Record<string, unknown>;
    const weekNumber = w["week_number"];
    if (typeof weekNumber !== "number" || weekNumber < 1 || weekNumber > 12 || seenWeeks.has(weekNumber)) {
      issues.push({
        code: "STRATEGY_V2_HANDOFF_WEEKS",
        field: "content_handoff.weeks[].week_number",
        message: `invalid or duplicate week_number '${String(weekNumber)}'`,
      });
      continue;
    }
    seenWeeks.add(weekNumber);
    const channel = w["channel"];
    if (typeof channel !== "string" || !CONTENT_CHANNEL_SET.has(channel)) {
      issues.push({
        code: "STRATEGY_V2_HANDOFF_CHANNEL",
        field: "content_handoff.weeks[].channel",
        message: `handoff channel '${String(channel)}' is not an existing ContentChannel`,
      });
    }
    const format = w["format"];
    if (typeof format !== "string" || !CONTENT_FORMAT_SET.has(format)) {
      issues.push({
        code: "STRATEGY_V2_HANDOFF_FORMAT",
        field: "content_handoff.weeks[].format",
        message: `handoff format '${String(format)}' is not an existing ContentFormat`,
      });
    }
  }
}

/**
 * Validates a generated strategy-v2 plan deterministically. Returns
 * `{ valid, issues }` with stable machine-readable issue codes. Fails closed
 * on malformed weekly handoff data; never applies free-text parsing or
 * fallback. Requires the plan's owner-selected `channel_choices` (from the
 * matching brief) so commitments can be checked for exactness.
 */
export function validateStrategyPlanV2(plan: unknown, briefChoices?: string[]): {
  valid: boolean;
  issues: StrategyV2ValidationIssue[];
} {
  const issues: StrategyV2ValidationIssue[] = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    issues.push({
      code: "STRATEGY_V2_WEEK_COUNT",
      field: "plan",
      message: "plan must be a JSON object",
    });
    return issuesFor(issues);
  }
  const planRecord = plan as Record<string, unknown>;
  validatePlanStructure(planRecord, issues);
  validateCommitments(planRecord, briefChoices ?? [], issues);
  validateHandoff(planRecord, issues);
  return issuesFor(issues);
}

/** Convenience gate for the API validator: true when the payload is a
 *  strategy-v2 plan (checked before shape validation). */
export function isStrategyPlanV2(plan: unknown): boolean {
  return (
    typeof plan === "object" &&
    plan !== null &&
    !Array.isArray(plan) &&
    (plan as Record<string, unknown>)["contract_version"] === "strategy-v2"
  );
}

export type { ContentChannel, ContentFormat };

import type {
  IsoDate,
  IsoDateTime,
  LanguageMode,
  UUID,
} from "../discovery/prepared-discovery-contracts";

export type { IsoDate, IsoDateTime, LanguageMode, UUID };

export const CONTENT_CHANNELS = [
  "facebook",
  "instagram",
  "tiktok",
  "google_business_profile",
] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export const CONTENT_FORMATS = [
  "static_image_post",
  "short_video_script",
  "carousel_brief",
  "text_post",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export type ContentLocale = "ar" | "en";
export type ContentContractVersion = "content-v1";
export type CairoTimezone = "Africa/Cairo";

export const CONTENT_DIALECTS = ["fusha", "masry", "khaliji", "neutral"] as const;
export type ContentDialect = (typeof CONTENT_DIALECTS)[number];

export const CONTENT_FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "conversion",
  "retention",
] as const;
export type ContentFunnelStage = (typeof CONTENT_FUNNEL_STAGES)[number];

export const CONTENT_DAY_PREFERENCES = ["weekday", "weekend", "any"] as const;
export type ContentDayPreference = (typeof CONTENT_DAY_PREFERENCES)[number];

export const CONTENT_TIME_OF_DAY_HINTS = [
  "morning",
  "afternoon",
  "evening",
  "night",
  "any",
] as const;
export type ContentTimeOfDayHint = (typeof CONTENT_TIME_OF_DAY_HINTS)[number];

export const CONTENT_ALT_TEXT_MAX_LENGTH = 100;
export const SHA256_CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

export function isSha256Checksum(value: unknown): value is string {
  return typeof value === "string" && SHA256_CHECKSUM_PATTERN.test(value);
}

export const CONTENT_ERROR_CODES = [
  "CONTENT_STRATEGY_NOT_APPROVED",
  "CONTENT_PROFILE_STALE",
  "CONTENT_CYCLE_PAUSED",
  "CONTENT_CYCLE_COMPLETED",
  "CONTENT_WEEK_OUT_OF_RANGE",
  "CONTENT_WEEK_ALREADY_CLAIMED",
  "CONTENT_CHANNEL_MISMATCH",
  "CONTENT_UNSUPPORTED_CLAIM",
  "CONTENT_OFFER_UNAPPROVED",
  "CONTENT_POLICY_VIOLATION",
  "CONTENT_ASSET_REQUIRED",
  "CONTENT_SCHEMA_FAILURE",
  "CONTENT_V2_REQUIRED",
  "CONTENT_VERSION_CONFLICT",
  "CONTENT_APPROVAL_BLOCKED",
  "CONTENT_PROVIDER_FAILURE",
  "CONTENT_CANDIDATE_TAMPERED",
  "CONTENT_CANDIDATE_REVOKED",
  "CONTENT_PLATFORM_CONSTRAINT",
] as const;
export type ContentErrorCode = (typeof CONTENT_ERROR_CODES)[number];

export type ContentValidationIssue = {
  readonly code: ContentErrorCode;
  readonly field: string;
  readonly message: string;
  readonly retryable: boolean;
};

export type ContentValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly ContentValidationIssue[];
};

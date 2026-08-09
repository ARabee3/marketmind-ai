import type {
  ContentChannel,
  ContentContractVersion,
  ContentFormat,
  IsoDateTime,
  LanguageMode,
  UUID,
} from "../content-types";

/**
 * Content v2 contract — owner-first weekly studio (issue #187).
 *
 * Content v2 is a new explicit contract version layered beside the frozen
 * `content-v1` contracts. The v1 models in this package are never mutated;
 * v2 cycles persist rows with `contract_version = "content-v2"` and a
 * different lifecycle (plan before draft, owner-scoped media library, CTA
 * library, immutable owner edits).
 */

export type ContentV2ContractVersion = "content-v2";

/**
 * The content-v2 cycle rows carry `content-v2`; v1 documents keep
 * `content-v1`. This literal deliberately stays disjoint from
 * {@link ContentContractVersion} so frozen v1 surfaces never widen.
 */
export type ContentVersionTag = ContentContractVersion | ContentV2ContractVersion;

export const CONTENT_V2_WEEK_PLAN_STATES = ["draft", "frozen"] as const;
/**
 * `draft` — the owner may still adjust plan cards; `frozen` — a frozen
 * plan/profile/CTA/media snapshot was taken when the generation worker
 * claimed the week, so plan edits can no longer change that run.
 */
export type ContentV2WeekPlanState = (typeof CONTENT_V2_WEEK_PLAN_STATES)[number];

export const CONTENT_V2_POST_PLAN_STATES = [
  "planned",
  "generating",
  "ready",
  "failed",
] as const;
export type ContentV2PostPlanState =
  (typeof CONTENT_V2_POST_PLAN_STATES)[number];

export const CONTENT_V2_PLAN_SOURCES = ["planner", "owner"] as const;
/** `planner` — produced by the AI planner stage; `owner` — owner-authored. */
export type ContentV2PlanSource = (typeof CONTENT_V2_PLAN_SOURCES)[number];

export const CONTENT_V2_EDIT_KINDS = [
  "generated",
  "owner_direct_edit",
  "ai_rewrite",
  "media_update",
] as const;
/**
 * `generated` — produced by the full-draft worker; `owner_direct_edit` —
 * an inline owner edit; `ai_rewrite` — an AI-assisted revision. Every edit
 * kind creates a new immutable validated version.
 */
export type ContentV2EditKind = (typeof CONTENT_V2_EDIT_KINDS)[number];

export const CONTENT_V2_MEDIA_KINDS = [
  "owner_uploaded",
  "generated_static",
] as const;
export type ContentV2MediaKind = (typeof CONTENT_V2_MEDIA_KINDS)[number];

export const CONTENT_V2_MEDIA_STATUSES = [
  "queued",
  "uploading",
  "ready",
  "failed",
  "revoked",
] as const;
export type ContentV2MediaStatus = (typeof CONTENT_V2_MEDIA_STATUSES)[number];

export const CONTENT_V2_MEDIA_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export type ContentV2MediaMimeType =
  (typeof CONTENT_V2_MEDIA_ALLOWED_MIME_TYPES)[number];

/** Owner-upload limit: 10 MiB. */
export const CONTENT_V2_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** The planner produces exactly 3–5 post plans for an actionable week. */
export const CONTENT_V2_PLAN_MIN_POSTS = 3;
export const CONTENT_V2_PLAN_MAX_POSTS = 5;

/** Generated static visuals stay square at 1080x1080. */
export const CONTENT_V2_GENERATED_VISUAL_SIZE = 1080;

export type ContentV2MediaFailureCode =
  | "CONTENT_MEDIA_TOO_LARGE"
  | "CONTENT_MEDIA_TYPE_UNSUPPORTED"
  | "CONTENT_MEDIA_MAGIC_BYTE_MISMATCH"
  | "CONTENT_MEDIA_DIMENSIONS_INVALID"
  | "CONTENT_MEDIA_CHECKSUM_MISMATCH"
  | "CONTENT_MEDIA_STORAGE_FAILURE";

export type ContentV2PlanChannel = ContentChannel;
export type ContentV2PlanFormat = ContentFormat;
export type ContentV2PlanLanguage = LanguageMode;
export type ContentV2PlanUuid = UUID;
export type ContentV2PlanTimestamp = IsoDateTime;

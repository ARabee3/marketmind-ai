import { CONTENT_FORMATS } from "@marketmind/contracts";
import type { ContentChannel, ContentFormat, LanguageMode } from "@marketmind/contracts";
import { ProviderError } from "../../common/errors/provider-error";

/**
 * Deterministic Strategy -> Content adapter.
 *
 * The approved Strategy plan names per-week formats using the Strategy
 * vocabulary (e.g. `reels`, `photo`, `poll`). The content-v1 contract only
 * recognises four exact {@link CONTENT_FORMATS}. This adapter is the single
 * deterministic place that maps one to the other, so generation and revision
 * envelopes never silently fall back to "every supported format" when a
 * week is missing or uses unknown labels (issue #110 P1: fail closed).
 *
 * Normalization matches the contract: trim, lowercase, convert spaces and
 * hyphens to underscores. The four exact `content-v1` values pass through.
 * Unknown labels are dropped only when at least one known mapping remains;
 * an all-unknown (or missing) week raises a non-retryable
 * `CONTENT_SCHEMA_FAILURE` naming the exact Strategy field.
 */

const CONTENT_FORMAT_SET = new Set<string>(CONTENT_FORMATS);

/** Strategy label -> exact `content-v1` format. Reviewed MVP mapping. */
const STRATEGY_LABEL_TO_CONTENT_FORMAT: Readonly<Record<string, ContentFormat>> = {
  static_image_post: "static_image_post",
  static_image: "static_image_post",
  photo: "static_image_post",
  image: "static_image_post",
  story: "static_image_post",

  short_video_script: "short_video_script",
  short_video: "short_video_script",
  video: "short_video_script",
  reel: "short_video_script",
  reels: "short_video_script",

  carousel_brief: "carousel_brief",
  carousel: "carousel_brief",

  text_post: "text_post",
  text: "text_post",
  post: "text_post",
  caption: "text_post",
  poll: "text_post",
  quiz: "text_post",
  question: "text_post",
};

const SUPPORTED_CONTENT_CHANNELS: ReadonlySet<ContentChannel> = new Set(
  ["facebook", "instagram"] as readonly ContentChannel[],
);

function toPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function schemaFailure(field: string): ProviderError {
  return new ProviderError(
    "CONTENT_SCHEMA_FAILURE",
    `Strategy content_strategy is missing or unsupported at field '${field}'.`,
    false,
  );
}

/** Trim, lowercase, convert spaces and hyphens to underscores. */
export function normalizeStrategyLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Maps one raw Strategy format label to its exact `content-v1` format.
 * The four exact {@link CONTENT_FORMATS} values pass through (after
 * normalization). Returns `undefined` for unknown labels.
 */
export function mapStrategyLabelToContentFormat(
  raw: string,
): ContentFormat | undefined {
  const normalized = normalizeStrategyLabel(raw);
  if (CONTENT_FORMAT_SET.has(normalized)) {
    return normalized as ContentFormat;
  }
  return STRATEGY_LABEL_TO_CONTENT_FORMAT[normalized];
}

/**
 * Resolves the exact supported Content formats for one Strategy week.
 *
 * Labels are normalized, mapped, then de-duplicated while preserving the
 * Strategy's order (the contract preserves Strategy ordering for grounding).
 * Unknown labels are dropped only when at least one known mapping remains.
 *
 * Fails closed with a non-retryable `CONTENT_SCHEMA_FAILURE` naming the
 * exact Strategy field when:
 *  - `content_strategy` is missing or not an object;
 *  - `content_strategy.weeks` is missing, empty, or not an array;
 *  - the requested `weekNumber` has no week plan;
 *  - the week's `formats` is missing, not an array, or empty;
 *  - every label is unknown (no supported mapping remains).
 *
 * Never falls back to all {@link CONTENT_FORMATS}.
 */
export function adaptStrategyWeekFormats(
  planData: unknown,
  weekNumber: number,
): ContentFormat[] {
  const contentStrategy = toPayload(planData)["content_strategy"];
  if (
    !contentStrategy ||
    typeof contentStrategy !== "object" ||
    Array.isArray(contentStrategy)
  ) {
    throw schemaFailure("content_strategy");
  }

  const weeks = (contentStrategy as Record<string, unknown>)["weeks"];
  if (!Array.isArray(weeks) || weeks.length === 0) {
    throw schemaFailure("content_strategy.weeks");
  }

  const weekPlan = weeks.find(
    (week) =>
      typeof week === "object" &&
      week !== null &&
      String((week as Record<string, unknown>)["week_number"]) ===
        String(weekNumber),
  );
  if (!weekPlan || typeof weekPlan !== "object") {
    throw schemaFailure(`content_strategy.weeks[week_number=${weekNumber}]`);
  }

  const formats = (weekPlan as Record<string, unknown>)["formats"];
  if (!Array.isArray(formats) || formats.length === 0) {
    throw schemaFailure(
      `content_strategy.weeks[week_number=${weekNumber}].formats`,
    );
  }

  const mapped: ContentFormat[] = [];
  for (const raw of formats) {
    if (typeof raw !== "string") continue;
    const format = mapStrategyLabelToContentFormat(raw);
    if (!format) continue;
    if (!mapped.includes(format)) mapped.push(format);
  }

  if (mapped.length === 0) {
    throw schemaFailure(
      `content_strategy.weeks[week_number=${weekNumber}].formats`,
    );
  }

  return mapped;
}

/**
 * Resolves the approved Strategy's plan language for the generation request.
 * Falls back to `ar-EG` (the product's Arabic-first default) when the field
 * is absent or unknown — the Strategy plan validator already enforces the
 * allowed values, so this default is only reached for malformed plan data.
 */
export function adaptLanguageMode(planData: unknown): LanguageMode {
  const language = toPayload(planData)["plan_language"];
  if (language === "ar-EG" || language === "en" || language === "mixed") {
    return language;
  }
  return "ar-EG";
}

/**
 * Extracts the supported Content channels (facebook, instagram) declared by
 * the Strategy plan's `selected_channels` scorecard, preserving order and
 * de-duplicating. Returns `[]` when the scorecard is absent or contains no
 * supported channel. Use {@link adaptSelectedChannelsOrThrow} for the
 * generation/revision path, which must fail closed when nothing supported
 * remains.
 */
export function extractSupportedContentChannels(
  planData: unknown,
): ContentChannel[] {
  const selected = toPayload(planData)["selected_channels"];
  if (!Array.isArray(selected)) return [];

  const channels: ContentChannel[] = [];
  for (const entry of selected) {
    const channel =
      typeof entry === "object" && entry !== null
        ? (entry as { channel?: unknown }).channel
        : undefined;
    if (
      typeof channel === "string" &&
      SUPPORTED_CONTENT_CHANNELS.has(channel as ContentChannel)
    ) {
      const value = channel as ContentChannel;
      if (!channels.includes(value)) channels.push(value);
    }
  }
  return channels;
}

/**
 * Same as {@link extractSupportedContentChannels} but fails closed with a
 * non-retryable `CONTENT_SCHEMA_FAILURE` when no supported channel remains.
 * Generation and revision envelopes must never be sent with an empty
 * `selected_channels`.
 */
export function adaptSelectedChannelsOrThrow(
  planData: unknown,
): ContentChannel[] {
  const channels = extractSupportedContentChannels(planData);
  if (channels.length === 0) {
    throw schemaFailure("selected_channels");
  }
  return channels;
}
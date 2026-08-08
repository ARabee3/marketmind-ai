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
 * Since issue #135, strategy-v2 plans carry a precomputed `content_handoff`
 * projection with exact `content-v1` channels, language, and all twelve week
 * mappings. v2 reads go straight through that projection without free-text
 * format parsing or fallback; v1 plans keep the reviewed label mapping.
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
  [
    "facebook",
    "instagram",
    "tiktok",
    "google_business_profile",
  ] as readonly ContentChannel[],
);

function toPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function schemaFailure(field: string, detail?: string): ProviderError {
  return new ProviderError(
    "CONTENT_SCHEMA_FAILURE",
    `Strategy content handoff is missing or unsupported at field '${field}'.${detail ? ` ${detail}` : ""}`,
    false,
  );
}

function isStrategyPlanV2(planData: unknown): boolean {
  return toPayload(planData)["contract_version"] === "strategy-v2";
}

/**
 * Reads the v2 plan's `content_handoff` projection. Returns `null` when the
 * field is absent or malformed so callers can fail closed with a precise
 * message.
 */
export function readContentHandoff(planData: unknown): Record<string, unknown> | null {
  const handoff = toPayload(planData)["content_handoff"];
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return null;
  }
  return handoff as Record<string, unknown>;
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
 * For v2 plans the week formats come from the deterministic
 * `content_handoff.weeks` projection (exact content-v1 values — no parsing).
 * For v1 plans labels are normalized, mapped, then de-duplicated while
 * preserving the Strategy's order.
 *
 * Fails closed with a non-retryable `CONTENT_SCHEMA_FAILURE` naming the
 * exact Strategy field when:
 *  - the v2 handoff is missing or unavailable, or the week is missing from it;
 *  - `content_strategy` is missing or not an object (v1);
 *  - `content_strategy.weeks` is missing, empty, or not an array (v1);
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
  if (isStrategyPlanV2(planData)) {
    return adaptV2WeekFormats(planData, weekNumber);
  }
  return adaptV1WeekFormats(planData, weekNumber);
}

function adaptV2WeekFormats(
  planData: unknown,
  weekNumber: number,
): ContentFormat[] {
  const handoff = readContentHandoff(planData);
  if (!handoff) {
    throw schemaFailure("content_handoff");
  }
  if (handoff.available !== true) {
    throw schemaFailure(
      "content_handoff",
      `Content handoff is unavailable (${String(handoff.reason ?? "unknown")}).`,
    );
  }
  const weeks = handoff.weeks;
  if (!Array.isArray(weeks) || weeks.length === 0) {
    throw schemaFailure("content_handoff.weeks");
  }
  const weekPlan = weeks.find(
    (week) =>
      typeof week === "object" &&
      week !== null &&
      String((week as Record<string, unknown>)["week_number"]) ===
        String(weekNumber),
  );
  if (!weekPlan || typeof weekPlan !== "object") {
    throw schemaFailure(`content_handoff.weeks[week_number=${weekNumber}]`);
  }
  const formats = (weekPlan as Record<string, unknown>)["formats"];
  if (!Array.isArray(formats) || formats.length === 0) {
    throw schemaFailure(
      `content_handoff.weeks[week_number=${weekNumber}].formats`,
    );
  }
  const mapped: ContentFormat[] = [];
  for (const raw of formats) {
    if (typeof raw !== "string") continue;
    if (!CONTENT_FORMAT_SET.has(raw)) continue;
    const format = raw as ContentFormat;
    if (!mapped.includes(format)) mapped.push(format);
  }
  if (mapped.length === 0) {
    throw schemaFailure(
      `content_handoff.weeks[week_number=${weekNumber}].formats`,
    );
  }
  return mapped;
}

function adaptV1WeekFormats(
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
 * For v2 plans the language comes from the content handoff projection (when
 * usable), falling back to `plan_language`; v1 plans use `plan_language`.
 * Falls back to `ar-EG` (the product's Arabic-first default) when the field
 * is absent or unknown.
 */
export function adaptLanguageMode(planData: unknown): LanguageMode {
  const language = toPayload(planData)["plan_language"];
  if (isStrategyPlanV2(planData)) {
    const handoff = readContentHandoff(planData);
    const handoffLanguage =
      handoff && handoff.available === true
        ? handoff.language
        : undefined;
    if (handoffLanguage === "ar-EG" || handoffLanguage === "en" || handoffLanguage === "mixed") {
      return handoffLanguage;
    }
  }
  if (language === "ar-EG" || language === "en" || language === "mixed") {
    return language;
  }
  return "ar-EG";
}

/**
 * Extracts the supported Content channels declared by the Strategy plan,
 * preserving order and de-duplicating. For v2 plans this is the deterministic
 * `content_handoff.channels` projection; for v1 plans it is the
 * `selected_channels` scorecard. Returns `[]` when the plan declares no
 * supported channel. Use {@link adaptSelectedChannelsOrThrow} for the
 * generation/revision path, which must fail closed when nothing supported
 * remains.
 */
export function extractSupportedContentChannels(
  planData: unknown,
): ContentChannel[] {
  if (isStrategyPlanV2(planData)) {
    const handoff = readContentHandoff(planData);
    if (!handoff || handoff.available !== true) return [];
    const channels = handoff.channels;
    if (!Array.isArray(channels)) return [];
    const result: ContentChannel[] = [];
    for (const channel of channels) {
      if (
        typeof channel === "string" &&
        SUPPORTED_CONTENT_CHANNELS.has(channel as ContentChannel)
      ) {
        const value = channel as ContentChannel;
        if (!result.includes(value)) result.push(value);
      }
    }
    return result;
  }

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
 * `selected_channels`. For v2 plans an unavailable content handoff surfaces
 * its machine-readable reason so Content cycle creation reports a precise
 * compatibility error instead of a silent empty cycle.
 */
export function adaptSelectedChannelsOrThrow(
  planData: unknown,
): ContentChannel[] {
  const channels = extractSupportedContentChannels(planData);
  if (channels.length === 0) {
    if (isStrategyPlanV2(planData)) {
      const handoff = readContentHandoff(planData);
      if (handoff && handoff.available === false) {
        throw schemaFailure(
          "content_handoff",
          `Content handoff is unavailable (${String(handoff.reason ?? "unknown")}).`,
        );
      }
    }
    throw schemaFailure("content_handoff");
  }
  return channels;
}
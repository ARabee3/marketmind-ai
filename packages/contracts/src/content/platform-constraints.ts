import type { ContentItemVersion } from "./content-item";
import type { ContentChannel, ContentFormat } from "./content-types";

export type PlatformConstraint = {
  readonly channel: ContentChannel;
  readonly format: ContentFormat;
  readonly max_caption_length: number | null;
  readonly max_hashtags: number | null;
  readonly max_alt_text_length: number | null;
  readonly note: string;
};

export const PLATFORM_CONSTRAINTS: readonly PlatformConstraint[] = [
  {
    channel: "facebook",
    format: "static_image_post",
    max_caption_length: 63206,
    max_hashtags: 30,
    max_alt_text_length: 100,
    note: "Facebook feed post; alt text is plain descriptive text, no range slider.",
  },
  {
    channel: "instagram",
    format: "static_image_post",
    max_caption_length: 2200,
    max_hashtags: 30,
    max_alt_text_length: 100,
    note: "Instagram feed post; captions above ~125 chars are collapsed; link-in-bio only, no clickable URLs in caption.",
  },
  {
    channel: "facebook",
    format: "short_video_script",
    max_caption_length: 63206,
    max_hashtags: 30,
    max_alt_text_length: null,
    note: "Video post; caption limits mirror long-form post.",
  },
  {
    channel: "instagram",
    format: "short_video_script",
    max_caption_length: 2200,
    max_hashtags: 30,
    max_alt_text_length: null,
    note: "Reels/static story; link-in-bio applies.",
  },
  {
    channel: "facebook",
    format: "text_post",
    max_caption_length: 63206,
    max_hashtags: 30,
    max_alt_text_length: null,
    note: "Text-only post.",
  },
  {
    channel: "instagram",
    format: "carousel_brief",
    max_caption_length: 2200,
    max_hashtags: 30,
    max_alt_text_length: null,
    note: "Carousel; each card has its own cover alt text.",
  },
];

export type PlatformConstraintWarning = {
  readonly constraint: PlatformConstraint;
  readonly field: "caption" | "hashtags" | "alt_text";
  readonly actual: number | null;
  readonly allowed: number | null;
  readonly message: string;
};

export function resolvePlatformConstraint(
  channel: ContentChannel,
  format: ContentFormat,
): PlatformConstraint | null {
  return (
    PLATFORM_CONSTRAINTS.find(
      (c) => c.channel === channel && c.format === format,
    ) ?? null
  );
}

export function validatePlatformConstraints(
  item: Pick<ContentItemVersion, "channel" | "format" | "caption_variants" | "hashtags" | "alt_text">,
): PlatformConstraintWarning[] {
  const constraint = resolvePlatformConstraint(item.channel, item.format);
  if (!constraint) {
    return [];
  }

  const warnings: PlatformConstraintWarning[] = [];
  const check = (
    field: "caption" | "hashtags" | "alt_text",
    actual: number | null,
    allowed: number | null,
  ): void => {
    if (allowed === null || actual === null || actual <= allowed) {
      return;
    }
    warnings.push({
      constraint,
      field,
      actual,
      allowed,
      message: `${item.channel}/${item.format} ${field} is ${actual}, over the ${allowed} limit.`,
    });
  };

  const selectedCaption =
    item.caption_variants.find((variant) => variant.locale === "ar") ??
    item.caption_variants[0];
  check("caption", selectedCaption?.caption.length ?? null, constraint.max_caption_length);
  check("hashtags", item.hashtags?.length ?? null, constraint.max_hashtags);
  check("alt_text", item.alt_text?.length ?? null, constraint.max_alt_text_length);

  return warnings;
}
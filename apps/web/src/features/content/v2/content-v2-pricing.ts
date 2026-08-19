import type { ContentFormat } from "@marketmind/contracts";
import { POINT_PRICES } from "@marketmind/contracts";

export function contentFormatPointCost(format: ContentFormat): number {
  return format === "static_image_post"
    ? POINT_PRICES.static_image
    : POINT_PRICES.content_item;
}

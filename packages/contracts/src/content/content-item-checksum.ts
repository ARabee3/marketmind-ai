import { createHash } from "node:crypto";
import { canonicalPublishingJson } from "../publishing/publishing-canonical";

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Canonical timestamp form used by the item-version checksum and by Nest's
 * public response mapper (`Date#toISOString()`): UTC with exactly three
 * fractional digits and a trailing `Z`.
 *
 * JavaScript Date intentionally truncates precision below milliseconds. That
 * is also the precision PostgreSQL can round-trip through Prisma's Date type
 * and the precision Nest exposes, so sub-millisecond provider values are
 * normalized before the checksum is frozen.
 */
export function normalizeContentTimestamp(value: string): string {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) return value;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toISOString();
}

export function normalizeContentTimestamps(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return normalizeContentTimestamp(value);
  if (Array.isArray(value)) return value.map(normalizeContentTimestamps);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeContentTimestamps(child),
      ]),
    );
  }
  return value;
}

/**
 * Canonical JSON payload for a Content item version.
 *
 * The shared publishing canonical JSON implementation performs recursive key
 * ordering, array-order preservation, JSON serialization, and Unicode-safe
 * UTF-8 input. Content adds only timestamp normalization and excludes the
 * root `version_checksum` field before delegating to that serializer.
 */
export function canonicalContentItemVersionJson(
  item: Record<string, unknown>,
): string {
  const { version_checksum: _excluded, ...payload } = item;
  return canonicalPublishingJson(normalizeContentTimestamps(payload));
}

export function computeContentItemVersionChecksum(
  item: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(canonicalContentItemVersionJson(item), "utf8")
    .digest("hex");
}

export function isContentItemVersionChecksumValid(
  item: Record<string, unknown>,
): boolean {
  const checksum = item["version_checksum"];
  return (
    typeof checksum === "string" &&
    computeContentItemVersionChecksum(item) === checksum
  );
}

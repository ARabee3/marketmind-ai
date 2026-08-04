import { createHash } from "node:crypto";

const URL_NAMESPACE = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");

/**
 * Stable UUIDv5-compatible identity shared by NestJS and FastAPI.
 *
 * A generated-static asset belongs to one immutable item version and role;
 * retries and idempotency-key changes must therefore resolve to the same row.
 */
export function deterministicGeneratedAssetId(
  contentItemVersionId: string,
  role = "generated_static",
): string {
  const digest = createHash("sha1")
    .update(
      Buffer.concat([
        URL_NAMESPACE,
        Buffer.from(`content-asset:${contentItemVersionId}:${role}`, "utf8"),
      ]),
    )
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

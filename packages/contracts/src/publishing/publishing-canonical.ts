import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { PUBLISHING_SIGNATURE_ALGORITHM } from "./publishing-types";

export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

export function canonicalizePublishingValue(value: unknown): CanonicalJson {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizePublishingValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalizePublishingValue(child)]),
    );
  }
  throw new TypeError("Publishing canonical JSON supports JSON values only.");
}

export function canonicalPublishingJson(value: unknown): string {
  return JSON.stringify(canonicalizePublishingValue(value));
}

export function computePublishingSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalPublishingJson(value), "utf8")
    .digest("hex");
}

export type PublishingSignatureInput = {
  readonly contract_version: string;
  readonly sent_at: string;
  readonly nonce: string;
  readonly body_sha256: string;
};

export function canonicalPublishingSignatureInput(
  input: PublishingSignatureInput,
): string {
  return [
    PUBLISHING_SIGNATURE_ALGORITHM,
    input.contract_version,
    input.sent_at,
    input.nonce,
    input.body_sha256,
  ].join("\n");
}

export function computePublishingSignature(
  input: PublishingSignatureInput,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalPublishingSignatureInput(input), "utf8")
    .digest("hex");
}

export function isPublishingSignatureValid(
  input: PublishingSignatureInput,
  signature: string,
  secret: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = Buffer.from(
    computePublishingSignature(input, secret),
    "hex",
  );
  const received = Buffer.from(signature, "hex");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

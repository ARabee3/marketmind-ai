import { createHash } from "node:crypto";

import { isSha256Checksum } from "../content/content-types";
import type { PublicationDispatchBodyV1 } from "./publishing-envelope";
import type {
  PublishingValidationIssue,
  PublishingValidationResult,
  UUID,
} from "./publishing-types";

export type RetrievedPublicationAssetV1 = {
  readonly asset_id: UUID;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addIssue(
  issues: PublishingValidationIssue[],
  code: "PUBLISHING_ASSET_UNAVAILABLE" | "PUBLISHING_ASSET_TAMPERED",
  field: string,
  message: string,
): void {
  issues.push({ code, field, message, retryable: false });
}

export function computePublicationAssetChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isPublicationAssetChecksumValid(
  bytes: Uint8Array,
  expectedChecksum: string,
): boolean {
  return (
    isSha256Checksum(expectedChecksum) &&
    computePublicationAssetChecksum(bytes) === expectedChecksum
  );
}

export function validateRetrievedPublicationAssetsV1(input: {
  readonly dispatch: Pick<PublicationDispatchBodyV1, "assets"> | unknown;
  readonly retrieved_assets: readonly RetrievedPublicationAssetV1[] | unknown;
}): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(input.dispatch) || !Array.isArray(input.dispatch.assets)) {
    addIssue(
      issues,
      "PUBLISHING_ASSET_UNAVAILABLE",
      "dispatch.assets",
      "Execution requires validated dispatch asset metadata.",
    );
    return { valid: false, issues };
  }
  if (!Array.isArray(input.retrieved_assets)) {
    addIssue(
      issues,
      "PUBLISHING_ASSET_UNAVAILABLE",
      "retrieved_assets",
      "Execution requires retrieved bytes for every dispatch asset.",
    );
    return { valid: false, issues };
  }

  const expectedAssets = input.dispatch.assets;
  const retrievedById = new Map<string, RetrievedPublicationAssetV1>();
  for (const [index, rawRetrieved] of input.retrieved_assets.entries()) {
    if (
      !isRecord(rawRetrieved) ||
      typeof rawRetrieved.asset_id !== "string" ||
      typeof rawRetrieved.mime_type !== "string" ||
      !(rawRetrieved.bytes instanceof Uint8Array) ||
      rawRetrieved.bytes.byteLength === 0
    ) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_UNAVAILABLE",
        `retrieved_assets[${index}]`,
        "Retrieved asset requires identity, MIME type, and non-empty bytes.",
      );
      continue;
    }
    if (retrievedById.has(rawRetrieved.asset_id)) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_TAMPERED",
        `retrieved_assets[${index}].asset_id`,
        "Retrieved asset identity must be unique within one execution.",
      );
      continue;
    }
    retrievedById.set(
      rawRetrieved.asset_id,
      rawRetrieved as unknown as RetrievedPublicationAssetV1,
    );
  }

  if (retrievedById.size !== expectedAssets.length) {
    addIssue(
      issues,
      "PUBLISHING_ASSET_UNAVAILABLE",
      "retrieved_assets",
      "Retrieved asset count must match the signed dispatch exactly.",
    );
  }

  for (const [index, rawExpected] of expectedAssets.entries()) {
    if (
      !isRecord(rawExpected) ||
      typeof rawExpected.asset_id !== "string" ||
      typeof rawExpected.mime_type !== "string" ||
      !isSha256Checksum(rawExpected.checksum)
    ) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_TAMPERED",
        `dispatch.assets[${index}].checksum`,
        "Signed dispatch asset metadata must contain a valid SHA-256 digest.",
      );
      continue;
    }
    const retrieved = retrievedById.get(rawExpected.asset_id);
    if (!retrieved) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_UNAVAILABLE",
        `retrieved_assets.${rawExpected.asset_id}`,
        "Signed dispatch asset bytes were not retrieved.",
      );
      continue;
    }
    if (retrieved.mime_type !== rawExpected.mime_type) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_TAMPERED",
        `retrieved_assets.${rawExpected.asset_id}.mime_type`,
        "Retrieved asset MIME type differs from the signed dispatch.",
      );
    }
    if (
      !isPublicationAssetChecksumValid(retrieved.bytes, rawExpected.checksum)
    ) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_TAMPERED",
        `retrieved_assets.${rawExpected.asset_id}.bytes`,
        "Retrieved asset bytes do not match the approved SHA-256 digest.",
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

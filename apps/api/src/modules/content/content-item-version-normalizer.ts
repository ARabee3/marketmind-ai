import type { ContentItemVersion, ContentPack } from "@marketmind/contracts";
import {
  computeContentItemVersionChecksum,
  deterministicGeneratedAssetId,
  normalizeContentTimestamps,
  normalizeContentTimestamp,
} from "@marketmind/contracts";
import { ProviderError } from "../../common/errors/provider-error";

type VersionIdentity = {
  readonly contentPackId: string;
  readonly contentItemId?: string;
  readonly version?: number;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly weekNumber: number;
};

type GeneratedPackIdentity = {
  readonly contentPackId: string;
  readonly contentCycleId: string;
  readonly weekNumber: number;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly strategyDecisionId: string;
  readonly profileVersionId: string;
};

function schemaFailure(message: string): ProviderError {
  return new ProviderError("CONTENT_SCHEMA_FAILURE", message, false);
}

function assertVersionIdentity(
  item: ContentItemVersion,
  expected: VersionIdentity,
): void {
  if (item.content_pack_id !== expected.contentPackId) {
    throw schemaFailure(
      `Generated item ${item.id} references pack ${item.content_pack_id}, expected ${expected.contentPackId}.`,
    );
  }
  if (
    expected.contentItemId !== undefined &&
    item.content_item_id !== expected.contentItemId
  ) {
    throw schemaFailure(
      `Generated item ${item.id} references item ${item.content_item_id}, expected ${expected.contentItemId}.`,
    );
  }
  if (expected.version !== undefined && item.version !== expected.version) {
    throw schemaFailure(
      `Generated item ${item.id} has version ${item.version}, expected ${expected.version}.`,
    );
  }

  const trace = item.strategy_trace;
  if (
    trace.strategy_id !== expected.strategyId ||
    trace.strategy_version !== expected.strategyVersion ||
    trace.week_number !== expected.weekNumber ||
    trace.channel !== item.channel
  ) {
    throw schemaFailure(
      `Generated item ${item.id} has a strategy trace that does not match the exact Strategy, week, and channel.`,
    );
  }
}

/**
 * Verifies a provider checksum before changing any field, then freezes the
 * Nest-authoritative timestamp/checksum pair used for persistence.
 */
export function normalizeAiContentItemVersion(
  item: ContentItemVersion,
  expected: VersionIdentity,
): ContentItemVersion {
  assertVersionIdentity(item, expected);

  const responseChecksum = computeContentItemVersionChecksum(item);
  if (responseChecksum !== item.version_checksum) {
    throw schemaFailure(
      `Generated item ${item.id} failed version checksum validation.`,
    );
  }

  const createdAt = normalizeContentTimestamp(item.created_at);
  if (new Set(item.asset_ids).size !== item.asset_ids.length) {
    throw schemaFailure(
      `Generated item ${item.id} contains duplicate asset IDs.`,
    );
  }
  const allocatedAssetId =
    item.asset_required && item.asset_ids.length === 0
      ? deterministicGeneratedAssetId(item.id)
      : null;
  const assetIds = allocatedAssetId ? [allocatedAssetId] : [...item.asset_ids];
  const blockers = allocatedAssetId
    ? item.blockers.filter((blocker) => blocker !== "CONTENT_ASSET_REQUIRED")
    : item.blockers;
  const normalized = normalizeContentTimestamps({
    ...item,
    created_at: createdAt,
    asset_ids: assetIds,
    blockers,
  }) as ContentItemVersion;
  const versionChecksum = computeContentItemVersionChecksum(normalized);

  return {
    ...normalized,
    version_checksum: versionChecksum,
  };
}

export function assertGeneratedContentPackIdentity(
  pack: ContentPack,
  expected: GeneratedPackIdentity,
): void {
  if (
    pack.id !== expected.contentPackId ||
    pack.content_cycle_id !== expected.contentCycleId ||
    pack.week_number !== expected.weekNumber ||
    pack.strategy_id !== expected.strategyId ||
    pack.strategy_version !== expected.strategyVersion ||
    pack.strategy_decision_id !== expected.strategyDecisionId ||
    pack.profile_version_id !== expected.profileVersionId
  ) {
    throw schemaFailure(
      `Generated content pack ${pack.id} does not match the claimed cycle, week, Strategy, decision, or profile identity.`,
    );
  }

  if (
    new Set(pack.item_ids).size !== pack.item_ids.length ||
    pack.item_ids.length === 0
  ) {
    throw schemaFailure(
      `Generated content pack ${pack.id} has invalid item IDs.`,
    );
  }
}

export function normalizeGeneratedContentItemVersions(
  items: readonly ContentItemVersion[],
  expected: Omit<VersionIdentity, "contentItemId" | "version"> & {
    readonly itemIds: readonly string[];
  },
): ContentItemVersion[] {
  const seen = new Set<string>();
  const normalized = items.map((item) => {
    if (seen.has(item.content_item_id)) {
      throw schemaFailure(
        `Generated response contains duplicate content item ${item.content_item_id}.`,
      );
    }
    seen.add(item.content_item_id);
    return normalizeAiContentItemVersion(item, expected);
  });

  const expectedIds = [...expected.itemIds].sort();
  const actualIds = normalized.map((item) => item.content_item_id).sort();
  if (
    expectedIds.length !== actualIds.length ||
    expectedIds.some((id, index) => id !== actualIds[index])
  ) {
    throw schemaFailure(
      "Generated content pack item_ids do not match the returned item versions.",
    );
  }

  return normalized;
}

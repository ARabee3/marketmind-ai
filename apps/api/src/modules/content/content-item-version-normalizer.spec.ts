import { ProviderError } from "../../common/errors/provider-error";
import {
  computeContentItemVersionChecksum,
  type ContentItemVersion,
} from "@marketmind/contracts";
import {
  normalizeAiContentItemVersion,
  normalizeGeneratedContentItemVersions,
} from "./content-item-version-normalizer";

const EXPECTED = {
  contentPackId: "pack-1",
  contentItemId: "item-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  weekNumber: 2,
};

function makeItem(overrides: Record<string, unknown> = {}): ContentItemVersion {
  const item = {
    id: "version-1",
    contract_version: "content-v1",
    content_item_id: "item-1",
    content_pack_id: EXPECTED.contentPackId,
    version: 1,
    channel: "instagram",
    format: "text_post",
    language_mode: "ar-EG",
    strategy_trace: {
      strategy_id: EXPECTED.strategyId,
      strategy_version: EXPECTED.strategyVersion,
      week_number: EXPECTED.weekNumber,
      pillar_ids: [],
      objective: "awareness",
      channel: "instagram",
    },
    caption_variants: [],
    cta: null,
    hashtags: ["#متجر"],
    creative_brief: "brief",
    alt_text: "alt",
    short_video_script: null,
    recommended_publish_window: {
      starts_at: "2026-08-01T10:00:00Z",
      ends_at: "2026-08-01T12:00:00Z",
      timezone: "Africa/Cairo",
    },
    claim_sources: [],
    warnings: [],
    blockers: [],
    asset_required: false,
    asset_ids: [],
    generation_provenance: {
      generation_run_id: "run-1",
      provider_name: "provider",
      provider_model: "model",
      generated_at: "2026-08-01T07:05:06.123456+03:00",
    },
    created_at: "2026-08-01T07:05:06.123456+03:00",
    ...overrides,
  };
  return {
    ...item,
    version_checksum: computeContentItemVersionChecksum(item),
  } as unknown as ContentItemVersion;
}

describe("content-item-version-normalizer", () => {
  it("validates the provider checksum, normalizes timestamps, and re-freezes the checksum", () => {
    const item = makeItem();
    const normalized = normalizeAiContentItemVersion(item, EXPECTED);

    expect(normalized.created_at).toBe("2026-08-01T04:05:06.123Z");
    expect(normalized.generation_provenance.generated_at).toBe(
      "2026-08-01T04:05:06.123Z",
    );
    expect(normalized.version_checksum).toBe(
      computeContentItemVersionChecksum(normalized),
    );
  });

  it("allocates one deterministic generated-static asset and removes only its provisional blocker", () => {
    const item = makeItem({
      asset_required: true,
      blockers: ["CONTENT_ASSET_REQUIRED"],
    });
    const normalized = normalizeAiContentItemVersion(item, EXPECTED);

    expect(normalized.asset_ids).toHaveLength(1);
    expect(normalized.blockers).toEqual([]);
    expect(normalized.version_checksum).toBe(
      computeContentItemVersionChecksum(normalized),
    );
  });

  it("rejects a checksum-invalid provider response before persistence", () => {
    const item = {
      ...makeItem(),
      version_checksum: "not-a-checksum",
    } as ContentItemVersion;

    expect(() => normalizeAiContentItemVersion(item, EXPECTED)).toThrow(
      ProviderError,
    );
    try {
      normalizeAiContentItemVersion(item, EXPECTED);
    } catch (error) {
      expect((error as ProviderError).code).toBe("CONTENT_SCHEMA_FAILURE");
      expect((error as ProviderError).retryable).toBe(false);
    }
  });

  it.each([
    ["content_pack_id", { content_pack_id: "other-pack" }],
    ["content_item_id", { content_item_id: "other-item" }],
    [
      "strategy trace",
      { strategy_trace: { ...makeItem().strategy_trace, week_number: 3 } },
    ],
  ])("rejects an exact identity mismatch: %s", (_label, override) => {
    const item = makeItem(override);
    expect(() => normalizeAiContentItemVersion(item, EXPECTED)).toThrow(
      ProviderError,
    );
  });

  it("rejects duplicate generated content item IDs", () => {
    const first = makeItem();
    const duplicate = makeItem({ id: "version-2" });

    expect(() =>
      normalizeGeneratedContentItemVersions([first, duplicate], {
        ...EXPECTED,
        itemIds: ["item-1", "item-1"],
      }),
    ).toThrow("duplicate content item");
  });

  it("requires generated item IDs to match the returned pack item IDs", () => {
    const item = makeItem();

    expect(() =>
      normalizeGeneratedContentItemVersions([item], {
        ...EXPECTED,
        itemIds: ["other-item"],
      }),
    ).toThrow("item_ids do not match");
  });
});

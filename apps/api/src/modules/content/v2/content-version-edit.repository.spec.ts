import { BadRequestException, ConflictException } from "@nestjs/common";
import { computeContentItemVersionChecksum } from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { ContentVersionEditRepository } from "./content-version-edit.repository";

const ITEM = "item-1";
const PACK = "pack-1";
const BASE = "base-version-1";
const CHECKSUM = "a".repeat(64);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockTx(overrides: Record<string, unknown> = {}): any {
  return {
    contentItem: {
      findFirst: jest.fn().mockResolvedValue({ id: ITEM, status: "draft" }),
      findUnique: jest.fn().mockResolvedValue({ status: "draft" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    contentItemVersion: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: BASE, version: 1, versionChecksum: CHECKSUM }),
      create: jest
        .fn()
        .mockImplementation(async (args) => ({ id: "new-1", ...args.data })),
    },
    ...overrides,
  };
}

function buildRepo(prisma: unknown) {
  return new ContentVersionEditRepository(prisma as PrismaService);
}

function editInput(overrides: Record<string, unknown> = {}) {
  return {
    contentItemId: ITEM,
    contentPackId: PACK,
    baseVersionId: BASE,
    baseVersionChecksum: CHECKSUM,
    editedByUserId: "owner-1",
    newVersionNumber: 2,
    channel: "instagram",
    format: "static_image_post",
    languageMode: "ar-EG",
    strategyTrace: {} as never,
    captionVariants: [],
    cta: null,
    hashtags: [],
    creativeBrief: "brief",
    altText: "alt",
    shortVideoScript: null,
    recommendedPublishWindow: {} as never,
    claimSources: [],
    warnings: [],
    blockers: [],
    assetRequired: false,
    assetIds: [],
    versionChecksum: CHECKSUM,
    ...overrides,
  };
}

describe("ContentVersionEditRepository", () => {
  it("creates an immutable v2 version with edit metadata on a matching base", async () => {
    const tx = mockTx();
    const repo = buildRepo({ $transaction: jest.fn(async (cb) => cb(tx)) });

    const version = await repo.appendOwnerEditVersion(editInput());

    expect(tx.contentItem.findFirst).toHaveBeenCalledWith({
      where: {
        id: ITEM,
        contentPackId: PACK,
        currentVersionId: BASE,
      },
      select: { id: true, status: true },
    });
    expect(tx.contentItemVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersion: "content-v2",
        version: 2,
        editKind: "owner_direct_edit",
        baseVersionId: BASE,
        baseVersionChecksum: CHECKSUM,
        editedByUserId: "owner-1",
        validationState: "validated",
      }),
    });
    expect(tx.contentItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: ITEM,
        currentVersionId: BASE,
        status: { not: "approved" },
      },
      data: expect.objectContaining({ status: "draft" }),
    });
    expect(version).toEqual(
      expect.objectContaining({ editKind: "owner_direct_edit" }),
    );

    const persisted = tx.contentItemVersion.create.mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(persisted.versionChecksum).not.toBe(CHECKSUM);
    expect(persisted.versionChecksum).toBe(
      computeContentItemVersionChecksum({
        id: persisted.id,
        // v2 rows retain the v1 item checksum surface at the publication
        // boundary; edit metadata and the v2 tag are separate persistence
        // fields.
        contract_version: "content-v1",
        content_item_id: persisted.contentItemId,
        content_pack_id: persisted.contentPackId,
        version: persisted.version,
        channel: persisted.channel,
        format: persisted.format,
        language_mode: persisted.languageMode,
        strategy_trace: persisted.strategyTrace,
        caption_variants: persisted.captionVariants,
        cta: persisted.cta,
        hashtags: persisted.hashtags,
        creative_brief: persisted.creativeBrief,
        alt_text: persisted.altText,
        short_video_script: persisted.shortVideoScript,
        recommended_publish_window: persisted.recommendedPublishWindow,
        claim_sources: persisted.claimSources,
        warnings: persisted.warnings,
        blockers: persisted.blockers,
        asset_required: persisted.assetRequired,
        asset_ids: persisted.assetIds,
        generation_provenance: persisted.generationProvenance,
        created_at: persisted.createdAt,
      }),
    );
  });

  it("conflicts when the base is no longer the current version", async () => {
    const tx = mockTx({
      contentItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const repo = buildRepo({ $transaction: jest.fn(async (cb) => cb(tx)) });

    await expect(
      repo.appendOwnerEditVersion(editInput()),
    ).rejects.toMatchObject({
      response: { code: "CONTENT_VERSION_CONFLICT" },
    });
  });

  it("blocks edits when the item has already been approved", async () => {
    const tx = mockTx({
      contentItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: ITEM,
          status: "approved",
        }),
        findUnique: jest.fn().mockResolvedValue({ status: "approved" }),
        updateMany: jest.fn(),
      },
    });
    const repo = buildRepo({ $transaction: jest.fn(async (cb) => cb(tx)) });

    await expect(
      repo.appendOwnerEditVersion(editInput()),
    ).rejects.toMatchObject({ response: { code: "CONTENT_APPROVAL_BLOCKED" } });
    expect(tx.contentItemVersion.create).not.toHaveBeenCalled();
    expect(tx.contentItem.updateMany).not.toHaveBeenCalled();
  });

  it("conflicts on a stale checksum without overwriting anything", async () => {
    const tx = mockTx({
      contentItemVersion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: BASE,
          version: 1,
          versionChecksum: "b".repeat(64),
        }),
        create: jest.fn(),
      },
    });
    const repo = buildRepo({ $transaction: jest.fn(async (cb) => cb(tx)) });

    await expect(
      repo.appendOwnerEditVersion(editInput()),
    ).rejects.toMatchObject({ response: { code: "CONTENT_VERSION_CONFLICT" } });
    expect(tx.contentItemVersion.create).not.toHaveBeenCalled();
  });

  it("rejects a version number that is not base+1", async () => {
    const tx = mockTx();
    const repo = buildRepo({ $transaction: jest.fn(async (cb) => cb(tx)) });

    await expect(
      repo.appendOwnerEditVersion(editInput({ newVersionNumber: 5 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

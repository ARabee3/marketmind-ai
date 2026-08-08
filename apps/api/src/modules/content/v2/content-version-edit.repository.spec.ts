import { BadRequestException, ConflictException } from "@nestjs/common";
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
      findFirst: jest.fn().mockResolvedValue({ id: ITEM }),
      update: jest.fn().mockResolvedValue({ id: ITEM }),
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
      select: { id: true },
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
    expect(tx.contentItem.update).toHaveBeenCalledWith({
      where: { id: ITEM },
      data: expect.objectContaining({ status: "draft" }),
    });
    expect(version).toEqual(
      expect.objectContaining({ editKind: "owner_direct_edit" }),
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

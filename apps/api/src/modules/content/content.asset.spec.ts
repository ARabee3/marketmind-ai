import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { createHash } from "node:crypto";
import { ContentService } from "./content.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentDecisionRepository } from "./repositories/content-decision.repository";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { PrismaService } from "../../common/persistence/prisma.service";
import { AssetStorage, CONTENT_ASSET_STORAGE } from "./assets/asset-storage.port";

const OWNER_ID = "user-1";

const ASSET_BYTES = Buffer.from("generated-asset-bytes-123", "utf8");

const ASSET_ROW = {
  id: "asset-1",
  contentItemVersionId: "ver-2",
  kind: "generated_static",
  status: "ready",
  mimeType: "image/png",
  width: 1024,
  height: 1024,
  storageKey: "ver-2/asset-1.png",
  checksum: createHash("sha256").update(ASSET_BYTES).digest("hex"),
  altText: "alt",
  providerName: "provider",
  providerModel: "model",
  providerRequestId: "req-1",
  failureCode: null,
  createdAt: new Date("2026-08-01T01:00:00.000Z"),
};

type MockedPackRepo = jest.Mocked<Partial<ContentPackRepository>>;

function makePackRepo(
  overrides: Partial<MockedPackRepo> = {},
): MockedPackRepo {
  return {
    getAssetByIdAndOwner: jest.fn().mockResolvedValue(ASSET_ROW),
    ...overrides,
  };
}

function makeAssetStorage(
  overrides: Partial<jest.Mocked<AssetStorage>> = {},
): jest.Mocked<AssetStorage> {
  return {
    store: jest.fn(),
    retrieve: jest.fn().mockResolvedValue(ASSET_BYTES),
    exists: jest.fn(),
    delete: jest.fn(),
    ...overrides,
  };
}

function makePrismaService() {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({}),
    ),
  };
}

/** Extracts the `code` from a Nest HttpException response body. */
function errorCode(error: unknown): string | undefined {
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === "object" && response !== null) {
      return (response as { code?: string }).code;
    }
  }
  return undefined;
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(errorCode(caught)).toBe(code);
}

describe("ContentService.getAsset", () => {
  let service: ContentService;
  let packRepo: MockedPackRepo;
  let assetStorage: jest.Mocked<AssetStorage>;

  beforeEach(async () => {
    packRepo = makePackRepo();
    assetStorage = makeAssetStorage();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: { getStrategyByIdAndOwner: jest.fn() } },
        { provide: ContentCycleRepository, useValue: { getCycleByIdAndOwner: jest.fn() } },
        { provide: ContentWeekContextRepository, useValue: { listWeeks: jest.fn() } },
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: getQueueToken("content-generation"), useValue: { add: jest.fn() } },
        { provide: getQueueToken("content-outbox"), useValue: { add: jest.fn() } },
        { provide: ContentDecisionRepository, useValue: { recordDecision: jest.fn() } },
        { provide: PublicationCandidateRepository, useValue: { getCandidateByItemVersionId: jest.fn() } },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: assetStorage },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("returns 404 when the asset does not belong to the owner", async () => {
    (packRepo.getAssetByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(service.getAsset("asset-1", OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("returns 404 when the asset id does not exist at all", async () => {
    (packRepo.getAssetByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(service.getAsset("missing-asset", OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects an asset that is not ready with CONTENT_ASSET_REQUIRED", async () => {
    (packRepo.getAssetByIdAndOwner as jest.Mock).mockResolvedValue({
      ...ASSET_ROW,
      status: "generating",
    });

    await rejectsWithCode(service.getAsset("asset-1", OWNER_ID), "CONTENT_ASSET_REQUIRED");
  });

  it("rejects an asset without a storage key with CONTENT_ASSET_REQUIRED", async () => {
    (packRepo.getAssetByIdAndOwner as jest.Mock).mockResolvedValue({
      ...ASSET_ROW,
      storageKey: null,
    });

    await rejectsWithCode(service.getAsset("asset-1", OWNER_ID), "CONTENT_ASSET_REQUIRED");
  });

  it("streams a ready asset whose bytes match the stored SHA-256 checksum", async () => {
    const result = await service.getAsset("asset-1", OWNER_ID);

    expect(createHash("sha256").update(result.buffer).digest("hex")).toBe(
      ASSET_ROW.checksum,
    );
    expect(result.mimeType).toBe("image/png");
    expect(result.checksum).toBe(ASSET_ROW.checksum);
    expect(assetStorage.retrieve).toHaveBeenCalledWith("ver-2/asset-1.png");
  });

  it("rejects bytes that do not match the authoritative checksum", async () => {
    assetStorage.retrieve.mockResolvedValue(Buffer.from("tampered-bytes"));

    await rejectsWithCode(service.getAsset("asset-1", OWNER_ID), "CONTENT_SCHEMA_FAILURE");
  });
});

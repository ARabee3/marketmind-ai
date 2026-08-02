import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { canTransitionContentPack } from "@marketmind/contracts";
import {
  ContentPackRepository,
  AppendPackWithItemsInput,
  ContentItemVersionDraftInput,
} from "./content-pack.repository";

const DRAFT: ContentItemVersionDraftInput = {
  channel: "instagram",
  format: "post",
  languageMode: "ar",
  strategyTrace: { pillar: "promotions" },
  captionVariants: [{ locale: "ar", caption: "نص" }],
  cta: "call",
  hashtags: ["#cairo"],
  creativeBrief: "brief",
  altText: "alt",
  shortVideoScript: null,
  recommendedPublishWindow: { starts_at: "2026-01-01", ends_at: "2026-01-02" },
  claimSources: [{ claim_type: "price" }],
  warnings: [],
  blockers: [],
  assetRequired: false,
  assetIds: [],
  generationProvenance: { provider: "mock", model: "mock" },
  versionChecksum: "abc123",
};

const APPEND_INPUT: AppendPackWithItemsInput = {
  cycleId: "cycle-1",
  weekNumber: 1,
  weekContextId: "week-1",
  items: [DRAFT, DRAFT],
  generationRunId: "run-1",
};

const PACK_ROW = {
  id: "pack-1",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weeklyClaimId: "claim-1",
  weekNumber: 1,
  businessId: "business-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  strategyDecisionId: "decision-1",
  profileVersionId: "profile-1",
  weekContextId: "week-1",
  status: "queued",
  retryEligible: true,
  itemIds: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

describe("ContentPackRepository", () => {
  describe("canTransitionContentPack contract", () => {
    it("allows queued → generating", () => {
      expect(canTransitionContentPack("queued", "generating")).toBe(true);
    });

    it("rejects approved → queued", () => {
      expect(canTransitionContentPack("approved", "queued")).toBe(false);
    });
  });

  describe("appendPackWithItems", () => {
    function makeTx() {
      const itemCreate = jest
        .fn()
        .mockResolvedValueOnce({ id: "item-1" })
        .mockResolvedValueOnce({ id: "item-2" });
      const versionCreate = jest
        .fn()
        .mockResolvedValueOnce({ id: "ver-1" })
        .mockResolvedValueOnce({ id: "ver-2" });
      const packCreate = jest.fn().mockResolvedValue(PACK_ROW);
      const packUpdate = jest.fn().mockResolvedValue(PACK_ROW);
      const itemUpdate = jest.fn().mockResolvedValue({});
      const generationRunCreate = jest.fn().mockResolvedValue({ id: "run-1" });

      return {
        tx: {
          contentCycle: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              businessId: "business-1",
              strategyId: "strategy-1",
              strategyVersion: 3,
              strategyDecisionId: "decision-1",
              profileVersionId: "profile-1",
            }),
          },
          contentPack: { create: packCreate, update: packUpdate },
          contentItem: { create: itemCreate, update: itemUpdate },
          contentItemVersion: { create: versionCreate },
          contentGenerationRun: { create: generationRunCreate },
        },
        packCreate,
        itemCreate,
        versionCreate,
        itemUpdate,
        packUpdate,
        generationRunCreate,
      };
    }

    it("writes pack + items + versions + run atomically and links current versions", async () => {
      const mocks = makeTx();
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mocks.tx),
        ),
      } as unknown as PrismaService);

      const result = await repo.appendPackWithItems(APPEND_INPUT);

      expect(result.id).toBe("pack-1");
      expect(mocks.packCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentCycleId: "cycle-1",
          weekNumber: 1,
          status: "queued",
          retryEligible: true,
        }),
      });
      expect(mocks.itemCreate).toHaveBeenCalledTimes(2);
      expect(mocks.versionCreate).toHaveBeenCalledTimes(2);
      expect(mocks.versionCreate).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          contentItemId: "item-1",
          contentPackId: "pack-1",
          version: 1,
          channel: "instagram",
          versionChecksum: "abc123",
        }),
      });
      expect(mocks.itemUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: "item-1" },
        data: { currentVersionId: "ver-1" },
      });
      expect(mocks.packUpdate).toHaveBeenCalledWith({
        where: { id: "pack-1" },
        data: { itemIds: ["item-1", "item-2"] },
      });
      expect(mocks.generationRunCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "run-1",
          contentPackId: "pack-1",
          contentCycleId: "cycle-1",
          weekNumber: 1,
          runType: "generate",
          status: "queued",
        }),
      });
    });

    it("returns the existing pack on an idempotent replay (P2002)", async () => {
      const mocks = makeTx();
      const findUnique = jest.fn().mockResolvedValue(PACK_ROW);
      const repo = new ContentPackRepository({
        $transaction: jest.fn(() => {
          throw uniqueViolation();
        }),
        contentPack: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.appendPackWithItems(APPEND_INPUT);

      expect(result.id).toBe("pack-1");
      expect(findUnique).toHaveBeenCalledWith({
        where: {
          contentCycleId_weekNumber: { contentCycleId: "cycle-1", weekNumber: 1 },
        },
      });
    });
  });

  describe("claimQueuedPack", () => {
    function makeClaimTx() {
      const packCreate = jest.fn().mockResolvedValue(PACK_ROW);
      return {
        tx: {
          contentCycle: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              businessId: "business-1",
              strategyId: "strategy-1",
              strategyVersion: 3,
              strategyDecisionId: "decision-1",
              profileVersionId: "profile-1",
            }),
          },
          contentPack: { create: packCreate },
        },
        packCreate,
      };
    }

    it("creates a queued pack row with empty items and reports created=true", async () => {
      const mocks = makeClaimTx();
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mocks.tx),
        ),
      } as unknown as PrismaService);

      const result = await repo.claimQueuedPack("cycle-1", 3, "week-3");

      expect(result.created).toBe(true);
      expect(result.pack.id).toBe("pack-1");
      expect(mocks.packCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentCycleId: "cycle-1",
          weekNumber: 3,
          weekContextId: "week-3",
          businessId: "business-1",
          strategyId: "strategy-1",
          strategyVersion: 3,
          strategyDecisionId: "decision-1",
          profileVersionId: "profile-1",
          status: "queued",
          retryEligible: true,
          itemIds: [],
        }),
      });
    });

    it("returns the existing pack with created=false on an idempotent replay (P2002)", async () => {
      const findUnique = jest.fn().mockResolvedValue(PACK_ROW);
      const repo = new ContentPackRepository({
        $transaction: jest.fn(() => {
          throw uniqueViolation();
        }),
        contentPack: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.claimQueuedPack("cycle-1", 1, "week-1");

      expect(result.created).toBe(false);
      expect(result.pack.id).toBe("pack-1");
      expect(findUnique).toHaveBeenCalledWith({
        where: {
          contentCycleId_weekNumber: { contentCycleId: "cycle-1", weekNumber: 1 },
        },
      });
    });
  });

  describe("getPackByIdAndOwner", () => {
    it("scopes by owner through the cycle", async () => {
      const findFirst = jest.fn().mockResolvedValue(PACK_ROW);
      const repo = new ContentPackRepository({
        contentPack: { findFirst },
      } as unknown as PrismaService);

      await repo.getPackByIdAndOwner("pack-1", "owner-1");

      expect(findFirst).toHaveBeenCalledWith({
        where: {
          id: "pack-1",
          contentCycle: { ownerUserId: "owner-1" },
        },
      });
    });

    it("returns null on cross-owner access", async () => {
      const repo = new ContentPackRepository({
        contentPack: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService);

      const result = await repo.getPackByIdAndOwner("pack-1", "other-owner");

      expect(result).toBeNull();
    });
  });

  describe("listPacks", () => {
    it("orders packs by week number ascending", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const repo = new ContentPackRepository({
        contentPack: { findMany },
      } as unknown as PrismaService);

      await repo.listPacks("cycle-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { contentCycleId: "cycle-1" },
        orderBy: { weekNumber: "asc" },
      });
    });
  });

  describe("listItemVersions", () => {
    it("scopes to the pack + item and orders by version descending", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const repo = new ContentPackRepository({
        contentItemVersion: { findMany },
      } as unknown as PrismaService);

      await repo.listItemVersions("pack-1", "item-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { contentPackId: "pack-1", contentItemId: "item-1" },
        orderBy: { version: "desc" },
      });
    });
  });

  describe("appendProgressEvent", () => {
    it("writes a monotonic sequence starting at 1", async () => {
      const create = jest.fn().mockResolvedValue({
        id: 1n,
        contentPackId: "pack-1",
        seq: 1,
        stage: "queued",
        status: "started",
        messageKey: "content.queued",
        messageText: "Queued.",
        payload: {},
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentProgressEvent: {
              count: jest.fn().mockResolvedValue(0),
              create,
            },
          }),
      );
      const repo = new ContentPackRepository({
        $transaction,
      } as unknown as PrismaService);

      await repo.appendProgressEvent("pack-1", {
        stage: "queued",
        status: "started",
        messageKey: "content.queued",
        messageText: "Queued.",
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentPackId: "pack-1",
          seq: 1,
        }),
      });
    });

    it("keeps seq monotonic across events", async () => {
      const create = jest.fn().mockResolvedValue({ seq: 4 });
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentProgressEvent: {
              count: jest.fn().mockResolvedValue(3),
              create,
            },
          }),
      );
      const repo = new ContentPackRepository({
        $transaction,
      } as unknown as PrismaService);

      await repo.appendProgressEvent("pack-1", {
        stage: "generating",
        status: "started",
        messageKey: "content.generating",
        messageText: "Generating.",
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ seq: 4 }),
      });
    });

    it("propagates a duplicate-seq error instead of writing twice", async () => {
      const create = jest
        .fn()
        .mockRejectedValue(uniqueViolation());
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentProgressEvent: {
              count: jest.fn().mockResolvedValue(2),
              create,
            },
          }),
      );
      const repo = new ContentPackRepository({
        $transaction,
      } as unknown as PrismaService);

      await expect(
        repo.appendProgressEvent("pack-1", {
          stage: "draft",
          status: "complete",
          messageKey: "content.draft",
          messageText: "Draft ready.",
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe("markPackStatus", () => {
    it("throws on an illegal transition before issuing the update", async () => {
      const updateMany = jest.fn();
      const repo = new ContentPackRepository({
        contentPack: { updateMany },
      } as unknown as PrismaService);

      await expect(
        repo.markPackStatus("pack-1", "approved", "queued"),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("applies a legal transition via conditional UPDATE", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const repo = new ContentPackRepository({
        contentPack: { updateMany },
      } as unknown as PrismaService);

      const result = await repo.markPackStatus("pack-1", "queued", "generating");

      expect(result).toEqual({ changed: true });
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "pack-1", status: "queued" },
        data: { status: "generating" },
      });
    });

    it("reports unchanged when a concurrent caller already moved the status", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const repo = new ContentPackRepository({
        contentPack: { updateMany },
      } as unknown as PrismaService);

      const result = await repo.markPackStatus("pack-1", "queued", "generating");

      expect(result).toEqual({ changed: false });
    });
  });
});

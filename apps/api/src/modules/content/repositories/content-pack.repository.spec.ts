import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { canTransitionContentPack } from "@marketmind/contracts";
import {
  ContentPackRepository,
  AppendPackWithItemsInput,
  ContentItemVersionDraftInput,
  PersistGeneratedItemsInput,
} from "./content-pack.repository";

const DRAFT: ContentItemVersionDraftInput = {
  id: "version-1",
  contentItemId: "item-1",
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
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
          $queryRaw: jest.fn().mockResolvedValue([]),
          contentCycle: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              businessId: "business-1",
              strategyId: "strategy-1",
              strategyVersion: 3,
              strategyDecisionId: "decision-1",
              profileVersionId: "profile-1",
            }),
          },
          contentWeekContext: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              weeklyClaimId: "claim-1",
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
          contentCycleId_weekNumber: {
            contentCycleId: "cycle-1",
            weekNumber: 1,
          },
        },
      });
    });
  });

  describe("claimQueuedPack", () => {
    function makeClaimTx() {
      const packCreate = jest.fn().mockResolvedValue(PACK_ROW);
      const cycleUpdate = jest.fn().mockResolvedValue({ id: "cycle-1" });
      const packFindUnique = jest.fn().mockImplementation(({ where }: any) => {
        const weekNumber = where.contentCycleId_weekNumber.weekNumber;
        return Promise.resolve(weekNumber === 3 ? null : { status: "draft" });
      });
      return {
        tx: {
          $queryRaw: jest.fn().mockResolvedValue([]),
          contentCycle: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              businessId: "business-1",
              strategyId: "strategy-1",
              strategyVersion: 3,
              strategyDecisionId: "decision-1",
              profileVersionId: "profile-1",
              currentWeekNumber: 2,
              status: "active",
              week1StartDate: new Date("2025-12-18T00:00:00Z"),
            }),
            update: cycleUpdate,
          },
          contentWeekContext: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              weeklyClaimId: "claim-1",
              contentCycleId: "cycle-1",
              weekNumber: 3,
              frozenAt: null,
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          contentPack: {
            findUnique: packFindUnique,
            create: packCreate,
          },
        },
        packCreate,
        cycleUpdate,
        packFindUnique,
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
          weeklyClaimId: "claim-1",
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

    it("does not skip an incomplete previous week", async () => {
      const mocks = makeClaimTx();
      mocks.tx.contentPack.findUnique = jest
        .fn()
        .mockImplementation(({ where }: any) => {
          const weekNumber = where.contentCycleId_weekNumber.weekNumber;
          return Promise.resolve(
            weekNumber === 3 ? null : { status: "failed" },
          );
        });
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mocks.tx),
        ),
      } as unknown as PrismaService);

      await expect(
        repo.claimQueuedPack("cycle-1", 3, "week-3"),
      ).rejects.toThrow("Week 2 is not complete");
      expect(mocks.packCreate).not.toHaveBeenCalled();
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
          contentCycleId_weekNumber: {
            contentCycleId: "cycle-1",
            weekNumber: 1,
          },
        },
      });
    });
  });

  describe("claimQueuedPackV2", () => {
    it("returns a stable conflict code when the week context is already frozen", async () => {
      const transactionClient = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        contentPack: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        contentCycle: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            businessId: "business-1",
            strategyId: "strategy-1",
            strategyVersion: 1,
            strategyDecisionId: "decision-1",
            profileVersionId: "profile-1",
            currentWeekNumber: 1,
            status: "active",
            week1StartDate: new Date("2026-08-09T00:00:00.000Z"),
          }),
        },
        contentWeekContext: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            weeklyClaimId: "claim-1",
            contentCycleId: "cycle-1",
            weekNumber: 1,
            frozenAt: new Date("2026-08-09T01:00:00.000Z"),
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        contentWeekPlan: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(transactionClient),
        ),
      } as unknown as PrismaService);

      try {
        await repo.claimQueuedPackV2({
          cycleId: "cycle-1",
          weekNumber: 1,
          weekContextId: "context-1",
          weekPlanId: "plan-1",
          frozenInput: {},
          jobIntent: { idempotencyKey: "idem-1" },
        });
        throw new Error("Expected the frozen context claim to fail");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({
            code: "CONTENT_WEEK_ALREADY_CLAIMED",
          }),
        );
      }
    });

    it("returns an existing V2 pack without freezing or consuming anything", async () => {
      const transactionClient = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        contentPack: { findUnique: jest.fn().mockResolvedValue(PACK_ROW) },
        contentCycle: { findUniqueOrThrow: jest.fn() },
        contentWeekPlan: { updateMany: jest.fn() },
        approvedOptimizationInstruction: {
          findUnique: jest.fn(),
          updateMany: jest.fn(),
        },
      };
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(transactionClient),
        ),
      } as unknown as PrismaService);

      const result = await repo.claimQueuedPackV2({
        cycleId: "cycle-1",
        weekNumber: 1,
        weekContextId: "context-1",
        weekPlanId: "plan-1",
        frozenInput: { optimization_guidance: { instruction_id: "ignored" } },
        optimizationInstructionId: "ignored",
      });

      expect(result).toEqual({ pack: PACK_ROW, created: false });
      expect(
        transactionClient.contentCycle.findUniqueOrThrow,
      ).not.toHaveBeenCalled();
      expect(
        transactionClient.contentWeekPlan.updateMany,
      ).not.toHaveBeenCalled();
      expect(
        transactionClient.approvedOptimizationInstruction.updateMany,
      ).not.toHaveBeenCalled();
    });

    it("consumes an approved Optimization instruction in the same pack claim", async () => {
      const consumedUpdate = jest.fn().mockResolvedValue({ count: 1 });
      const instruction = {
        id: "instruction-1",
        status: "PENDING_CONSUMPTION",
        businessId: "business-1",
        strategyId: "strategy-1",
        strategyVersion: 1,
        contentCycleId: "cycle-1",
        formatCohort: "static_image_post",
        evidenceChecksum: "checksum-1",
        proposalId: "proposal-1",
        approvedDecisionId: "decision-1",
        changeKind: "hook_style",
        instruction: "Use a concrete opening.",
      };
      const transactionClient = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        contentPack: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(PACK_ROW),
        },
        contentCycle: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            businessId: "business-1",
            strategyId: "strategy-1",
            strategyVersion: 1,
            strategyDecisionId: "decision-1",
            profileVersionId: "profile-1",
            currentWeekNumber: 1,
            status: "active",
            week1StartDate: new Date("2026-08-09T00:00:00.000Z"),
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        contentWeekContext: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            weeklyClaimId: "claim-1",
            contentCycleId: "cycle-1",
            weekNumber: 1,
            frozenAt: null,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        contentWeekPlan: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        contentJobOutbox: { create: jest.fn().mockResolvedValue({}) },
        approvedOptimizationInstruction: {
          findUnique: jest.fn().mockResolvedValue(instruction),
          updateMany: consumedUpdate,
        },
      };
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(transactionClient),
        ),
      } as unknown as PrismaService);

      await repo.claimQueuedPackV2({
        cycleId: "cycle-1",
        weekNumber: 1,
        weekContextId: "context-1",
        weekPlanId: "plan-1",
        frozenInput: {
          optimization_guidance: {
            instruction_id: "instruction-1",
            proposal_id: "proposal-1",
            approved_decision_id: "decision-1",
            evidence_checksum: "checksum-1",
            format_cohort: "static_image_post",
            change_kind: "hook_style",
            instruction: "Use a concrete opening.",
          },
          post_plans: [
            { source: "owner", format: "static_image_post" },
            { source: "planner", format: "short_video_script" },
          ],
        },
        optimizationInstructionId: "instruction-1",
        jobIntent: { idempotencyKey: "idem-1" },
      });

      expect(consumedUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "instruction-1",
            status: "PENDING_CONSUMPTION",
          }),
          data: expect.objectContaining({
            status: "CONSUMED",
            consumedContentPackId: PACK_ROW.id,
            consumedWeekPlanId: "plan-1",
          }),
        }),
      );
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
      const create = jest.fn().mockRejectedValue(uniqueViolation());
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

      const result = await repo.markPackStatus(
        "pack-1",
        "queued",
        "generating",
      );

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

      const result = await repo.markPackStatus(
        "pack-1",
        "queued",
        "generating",
      );

      expect(result).toEqual({ changed: false });
    });
  });

  describe("getPackById", () => {
    it("reads a pack without ownership scoping", async () => {
      const findUnique = jest.fn().mockResolvedValue(PACK_ROW);
      const repo = new ContentPackRepository({
        contentPack: { findUnique },
      } as unknown as PrismaService);

      await repo.getPackById("pack-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "pack-1" } });
    });
  });

  describe("listReusableAssets", () => {
    it("scopes ready reusable assets to the business owner", async () => {
      const findMany = jest.fn().mockResolvedValue([{ id: "asset-1" }]);
      const repo = new ContentPackRepository({
        contentAsset: { findMany },
      } as unknown as PrismaService);

      await expect(
        repo.listReusableAssets(
          ["asset-1", "asset-1"],
          "business-1",
          "owner-1",
        ),
      ).resolves.toEqual([{ id: "asset-1" }]);

      expect(findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["asset-1"] },
          status: "ready",
          kind: { in: ["owner_supplied", "generated_static"] },
          OR: [
            {
              contentItemVersion: {
                contentPack: {
                  businessId: "business-1",
                  contentCycle: { ownerUserId: "owner-1" },
                },
              },
            },
            {
              versionLinks: {
                some: {
                  contentItemVersion: {
                    contentPack: {
                      businessId: "business-1",
                      contentCycle: { ownerUserId: "owner-1" },
                    },
                  },
                },
              },
            },
          ],
        },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("getAssetBillingContext", () => {
    const directContext = {
      businessId: "business-direct",
      contentCycle: { ownerUserId: "owner-direct" },
    };
    const linkedContext = {
      businessId: "business-linked",
      contentCycle: { ownerUserId: "owner-linked" },
    };

    it("resolves ownership from the asset's direct item version", async () => {
      const findUnique = jest.fn().mockResolvedValue({
        contentItemVersion: { contentPack: directContext },
        versionLinks: [],
      });
      const repo = new ContentPackRepository({
        contentAsset: { findUnique },
      } as unknown as PrismaService);

      await expect(repo.getAssetBillingContext("asset-1")).resolves.toEqual({
        ownerUserId: "owner-direct",
        businessId: "business-direct",
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "asset-1" } }),
      );
    });

    it("falls back to the reusable asset's version link", async () => {
      const repo = new ContentPackRepository({
        contentAsset: {
          findUnique: jest.fn().mockResolvedValue({
            contentItemVersion: null,
            versionLinks: [
              { contentItemVersion: { contentPack: linkedContext } },
            ],
          }),
        },
      } as unknown as PrismaService);

      await expect(repo.getAssetBillingContext("asset-2")).resolves.toEqual({
        ownerUserId: "owner-linked",
        businessId: "business-linked",
      });
    });

    it("returns null when the asset has no owning version", async () => {
      const repo = new ContentPackRepository({
        contentAsset: { findUnique: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService);

      await expect(repo.getAssetBillingContext("missing")).resolves.toBeNull();
    });
  });

  describe("persistGeneratedItems", () => {
    const PROGRESS: import("./content-pack.repository").ContentProgressInput = {
      stage: "ready",
      status: "complete",
      messageKey: "content.ready",
      messageText: "Pack draft ready.",
    };

    const PERSIST_INPUT: PersistGeneratedItemsInput = {
      packId: "pack-1",
      cycleId: "cycle-1",
      weekNumber: 1,
      generationRunId: "run-1",
      items: [DRAFT, DRAFT, DRAFT],
      progressEvent: PROGRESS,
      providerName: "mock",
      providerModel: "mock-v1",
      inputHash: "hash-1",
      latencyMs: 1200,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt: new Date("2026-01-01T00:00:01Z"),
    };

    function makePersistTx(status = "validating") {
      const itemCreate = jest
        .fn()
        .mockResolvedValueOnce({ id: "item-1" })
        .mockResolvedValueOnce({ id: "item-2" })
        .mockResolvedValueOnce({ id: "item-3" });
      const versionCreate = jest
        .fn()
        .mockResolvedValueOnce({ id: "ver-1" })
        .mockResolvedValueOnce({ id: "ver-2" })
        .mockResolvedValueOnce({ id: "ver-3" });
      const itemUpdate = jest.fn().mockResolvedValue({});
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const genRunCreate = jest.fn().mockResolvedValue({ id: "run-1" });
      const progCount = jest.fn().mockResolvedValue(2);
      const progCreate = jest.fn().mockResolvedValue({ id: 1n, seq: 3 });
      const findUniqueOrThrow = jest
        .fn()
        .mockResolvedValueOnce({ ...PACK_ROW, status })
        .mockResolvedValueOnce({
          ...PACK_ROW,
          status: "draft",
          itemIds: ["item-1", "item-2", "item-3"],
        });

      return {
        tx: {
          contentPack: { findUniqueOrThrow, updateMany },
          contentItem: { create: itemCreate, update: itemUpdate },
          contentItemVersion: { create: versionCreate },
          contentGenerationRun: { create: genRunCreate },
          contentProgressEvent: { count: progCount, create: progCreate },
        },
        itemCreate,
        versionCreate,
        itemUpdate,
        updateMany,
        genRunCreate,
        progCreate,
      };
    }

    it("persists items, versions, generation run, progress event, and transitions validating→draft in one tx", async () => {
      const mocks = makePersistTx();
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mocks.tx),
        ),
      } as unknown as PrismaService);

      await repo.persistGeneratedItems(PERSIST_INPUT);

      expect(mocks.itemCreate).toHaveBeenCalledTimes(3);
      expect(mocks.versionCreate).toHaveBeenCalledTimes(3);
      expect(mocks.versionCreate).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          contentItemId: "item-1",
          contentPackId: "pack-1",
          version: 1,
          channel: "instagram",
          assetRequired: false,
        }),
      });
      expect(mocks.itemUpdate).toHaveBeenNthCalledWith(1, {
        where: { id: "item-1" },
        data: { currentVersionId: "ver-1" },
      });
      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { id: "pack-1", status: "validating" },
        data: { itemIds: ["item-1", "item-2", "item-3"], status: "draft" },
      });
      expect(mocks.genRunCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "run-1",
          contentPackId: "pack-1",
          contentCycleId: "cycle-1",
          weekNumber: 1,
          runType: "generate",
          status: "completed",
          providerName: "mock",
          providerModel: "mock-v1",
          inputHash: "hash-1",
          latencyMs: 1200,
        }),
      });
      expect(mocks.progCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentPackId: "pack-1",
          seq: 3,
          stage: "ready",
          status: "complete",
        }),
      });
    });

    it("throws BadRequestException when pack is not in validating status", async () => {
      const mocks = makePersistTx("queued");
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mocks.tx),
        ),
      } as unknown as PrismaService);

      await expect(
        repo.persistGeneratedItems(PERSIST_INPUT),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.itemCreate).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when conditional UPDATE returns 0 (pack moved)", async () => {
      const mocks = makePersistTx();
      mocks.updateMany.mockResolvedValue({ count: 0 });
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(mocks.tx),
        ),
      } as unknown as PrismaService);

      await expect(
        repo.persistGeneratedItems(PERSIST_INPUT),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("safeFail", () => {
    it("sets status=failed, retryEligible=true, and appends a progress event in one tx", async () => {
      const update = jest.fn().mockResolvedValue({});
      const count = jest.fn().mockResolvedValue(3);
      const create = jest.fn().mockResolvedValue({ id: 1n, seq: 4 });
      const repo = new ContentPackRepository({
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback({
              contentPack: { update },
              contentProgressEvent: { count, create },
            }),
        ),
      } as unknown as PrismaService);

      await repo.safeFail(
        "pack-1",
        "content.generation_failed",
        "AI call failed",
        {
          errorCode: "CONTENT_PROVIDER_FAILURE",
          retryable: true,
        },
      );

      expect(update).toHaveBeenCalledWith({
        where: { id: "pack-1" },
        data: { status: "failed", retryEligible: true },
      });
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentPackId: "pack-1",
          seq: 4,
          stage: "failed",
          status: "failed",
          messageKey: "content.generation_failed",
          messageText: "AI call failed",
          payload: {
            errorCode: "CONTENT_PROVIDER_FAILURE",
            retryable: true,
          },
        }),
      });
    });
  });

  describe("claimPackForGeneration", () => {
    it("reclaims a retryable failed pack for the next provider attempt", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const repo = new ContentPackRepository({
        contentPack: { updateMany },
      } as unknown as PrismaService);

      await expect(repo.claimPackForGeneration("pack-1")).resolves.toEqual({
        changed: true,
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "pack-1",
          status: { in: ["queued", "failed"] },
          retryEligible: true,
        },
        data: { status: "generating" },
      });
    });
  });
});

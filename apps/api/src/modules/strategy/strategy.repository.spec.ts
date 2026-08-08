import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { canTransitionStrategy, StrategyStatus } from "@marketmind/contracts";
import { StrategyRepository } from "./strategy.repository";

/**
 * Lifecycle transition matrix tests.
 *
 * These exercise the FSM contract two ways:
 *  1. The shared `canTransitionStrategy` contract directly — the matrix.
 *  2. The repository's `updateStrategyStatus`, which must reject any
 *     transition the contract forbids (so callers never have to guard
 *     manually) and must allow the legal ones.
 *
 * The repository tests use a minimal Prisma mock that returns a fixed
 * `from` status and records the attempted `to` status; the contract test
 * covers the full matrix without any Prisma dependency.
 */
describe("Strategy lifecycle transition matrix", () => {
  describe("canTransitionStrategy contract", () => {
    const LEGAL: Array<[StrategyStatus, StrategyStatus]> = [
      ["needs_brief", "ready"],
      ["needs_brief", "failed"],
      ["ready", "retrieving"],
      ["ready", "failed"],
      ["retrieving", "queued"],
      ["retrieving", "failed"],
      ["queued", "generating"],
      ["queued", "failed"],
      ["generating", "validating"],
      ["generating", "failed"],
      ["validating", "draft"],
      ["validating", "failed"],
      ["draft", "approved"],
      ["draft", "rejected"],
      ["draft", "ready"],
      ["rejected", "ready"],
      ["failed", "ready"],
    ];

    const ALL: StrategyStatus[] = [
      "needs_brief",
      "ready",
      "retrieving",
      "queued",
      "generating",
      "validating",
      "draft",
      "approved",
      "rejected",
      "failed",
    ];

    it.each(LEGAL)("allows %s → %s", (from, to) => {
      expect(canTransitionStrategy(from, to)).toBe(true);
    });

    it("rejects every transition not in the legal set", () => {
      const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));
      for (const from of ALL) {
        for (const to of ALL) {
          if (from === to) continue;
          const key = `${from}->${to}`;
          if (legalSet.has(key)) continue;
          expect(canTransitionStrategy(from, to)).toBe(false);
        }
      }
    });

    it("treats approved as terminal (no outgoing transitions)", () => {
      for (const to of ALL) {
        expect(canTransitionStrategy("approved", to)).toBe(false);
      }
    });
  });

  describe("StrategyRepository.updateStrategyStatus", () => {
    function makePrisma(currentStatus: StrategyStatus) {
      const update = jest.fn().mockResolvedValue({ id: "strat-1", status: currentStatus });
      return {
        strategy: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ status: currentStatus }),
          update,
        },
        $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            strategy: {
              findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ status: currentStatus }),
              update,
            },
          }),
        ),
      };
    }

    it.each([
      ["ready", "retrieving"],
      ["retrieving", "queued"],
      ["queued", "generating"],
      ["generating", "validating"],
      ["validating", "draft"],
      ["failed", "ready"],
    ] as Array<[StrategyStatus, StrategyStatus]>)(
      "allows legal transition %s → %s",
      async (from, to) => {
        const prisma = makePrisma(from);
        const repo = new StrategyRepository(prisma as unknown as PrismaService);

        await expect(repo.updateStrategyStatus("strat-1", to)).resolves.not.toThrow();
      },
    );

    it.each([
      ["approved", "ready"],
      ["approved", "failed"],
      ["draft", "generating"],
      ["ready", "draft"],
      ["needs_brief", "generating"],
      ["generating", "ready"],
    ] as Array<[StrategyStatus, StrategyStatus]>)(
      "rejects illegal transition %s → %s",
      async (from, to) => {
        const prisma = makePrisma(from);
        const repo = new StrategyRepository(prisma as unknown as PrismaService);

        await expect(repo.updateStrategyStatus("strat-1", to)).rejects.toThrow(
          BadRequestException,
        );
      },
    );
  });

  describe("StrategyRepository.claimForGeneration", () => {
    function makePrisma(currentStatus: StrategyStatus | null) {
      const updateMany = jest.fn().mockImplementation((args: { where: { status: { in: string[] } } }) => {
        const allowed = args.where.status.in;
        if (currentStatus && allowed.includes(currentStatus)) {
          return { count: 1 };
        }
        return { count: 0 };
      });
      return { strategy: { updateMany } };
    }

    it("claims when the current status is in the idle set and the transition is legal", async () => {
      const prisma = makePrisma("ready");
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      // ready → retrieving is a legal FSM transition.
      const result = await repo.claimForGeneration("strat-1", ["ready"], "retrieving");

      expect(result.claimed).toBe(true);
      expect(prisma.strategy.updateMany).toHaveBeenCalledWith({
        where: { id: "strat-1", status: { in: ["ready"] } },
        data: { status: "retrieving" },
      });
    });

    it("refuses to claim when the current status is active (concurrent duplicate)", async () => {
      const prisma = makePrisma("queued");
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      const result = await repo.claimForGeneration("strat-1", ["ready"], "retrieving");

      expect(result.claimed).toBe(false);
    });

    it("refuses to claim when the transition itself is illegal even from an idle status", async () => {
      const prisma = makePrisma("ready");
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      // ready → draft is not a legal FSM transition — the JS guard catches
      // this before even issuing the UPDATE.
      const result = await repo.claimForGeneration("strat-1", ["ready"], "draft");

      expect(result.claimed).toBe(false);
      expect(prisma.strategy.updateMany).not.toHaveBeenCalled();
    });

    it("refuses to claim when any idle status cannot legally transition to next", async () => {
      const prisma = makePrisma("failed");
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      // failed → retrieving is NOT a legal FSM transition (only failed → ready
      // is legal). Even though "ready" is in the idle set and ready →
      // retrieving is legal, the JS guard rejects because "failed" is also in
      // the set and failed → retrieving is illegal.
      const result = await repo.claimForGeneration("strat-1", ["ready", "failed"], "retrieving");

      expect(result.claimed).toBe(false);
    });

    it("is truly atomic: two concurrent calls cannot both claim", async () => {
      // Simulate the second call seeing the already-updated status: the first
      // call transitions ready → retrieving, the second call's updateMany
      // matches zero rows because the status is now "retrieving".
      let status: StrategyStatus = "ready";
      const updateMany = jest.fn().mockImplementation((args: { where: { status: { in: string[] } }, data: { status: string } }) => {
        const allowed = args.where.status.in;
        if (status && allowed.includes(status)) {
          status = args.data.status as StrategyStatus;
          return { count: 1 };
        }
        return { count: 0 };
      });
      const prisma = { strategy: { updateMany } };
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      const first = await repo.claimForGeneration("strat-1", ["ready"], "retrieving");
      const second = await repo.claimForGeneration("strat-1", ["ready"], "retrieving");

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(false);
    });
  });

  describe("StrategyRepository.upsertBrief", () => {
    it("includes strategyId in the create branch (required FK)", async () => {
      const upsert = jest.fn().mockResolvedValue({ id: "brief-1" });
      const prisma = { strategyBrief: { upsert } };
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      await repo.upsertBrief("strat-1", {
        businessProfileVersionId: "bpv-1",
        primaryObjective: "growth",
        startDate: new Date("2026-01-01"),
        planLanguage: "ar",
        paidMediaAllowed: true,
        externalBudgetMode: "none",
        teamCapacity: "part_time",
        constraints: null,
        clarificationAnswers: [],
      });

      expect(upsert).toHaveBeenCalledWith({
        where: { strategyId: "strat-1" },
        create: expect.objectContaining({ strategyId: "strat-1" }),
        update: expect.not.objectContaining({ strategyId: "strat-1" }),
      });
    });

    it("does not leak strategyId into the update branch", async () => {
      const upsert = jest.fn().mockResolvedValue({ id: "brief-1" });
      const prisma = { strategyBrief: { upsert } };
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      await repo.upsertBrief("strat-1", {
        businessProfileVersionId: "bpv-1",
        primaryObjective: "growth",
        startDate: new Date("2026-01-01"),
        planLanguage: "ar",
        paidMediaAllowed: true,
        externalBudgetMode: "none",
        teamCapacity: "part_time",
        constraints: null,
        clarificationAnswers: [],
      });

      const call = upsert.mock.calls[0][0];
      expect(call.update.strategyId).toBeUndefined();
    });
  });

  describe("Strategy progress persistence", () => {
    it("persists retry eligibility alongside the correlation payload", async () => {
      const create = jest.fn().mockResolvedValue({
        id: 1n,
        strategyId: "strat-1",
      });
      const prisma = {
        $transaction: jest.fn(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback({
              strategyProgressEvent: {
                count: jest.fn().mockResolvedValue(0),
                create,
              },
            }),
        ),
      };
      const repository = new StrategyRepository(
        prisma as unknown as PrismaService,
      );

      await repository.appendProgressEvent("strat-1", {
        stage: "failed",
        status: "failed",
        messageKey: "strategy.failed",
        messageText: "Generation failed.",
        retryable: true,
        payload: { correlation_id: "corr-1" },
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payload: {
            correlation_id: "corr-1",
            retryable: true,
          },
        }),
      });
    });
  });

  describe("StrategyRepository.deleteStrategy", () => {
    function makePrisma(overrides: Record<string, unknown> = {}) {
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const findUnique = jest
        .fn()
        .mockResolvedValue({ id: "strat-1", status: "draft" });
      const findMany = jest.fn().mockResolvedValue([{ id: "ver-1" }]);
      const remove = jest.fn().mockResolvedValue({ id: "strat-1" });
      const tx = {
        strategy: {
          findUnique,
          deleteMany: deleteMany as unknown as ReturnType<typeof jest.fn>,
          delete: remove,
        },
        strategyVersion: { findMany, deleteMany },
        strategyDecision: { deleteMany },
        strategyRetrievalRun: { deleteMany },
        strategyBrief: { deleteMany },
        strategyProgressEvent: { deleteMany },
        ...overrides,
      };
      return {
        prisma: {
          $transaction: jest.fn(
            async (callback: (t: unknown) => Promise<unknown>) =>
              callback(tx),
          ),
        },
        deleteMany,
        findUnique,
        findMany,
        remove,
        tx,
      };
    }

    it("deletes every strategy-owned row in one transaction", async () => {
      const { prisma, deleteMany, findMany, remove } = makePrisma();
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      await repo.deleteStrategy("strat-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { strategyId: "strat-1" },
        select: { id: true },
      });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { strategyVersionId: { in: ["ver-1"] } },
      });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { strategyId: "strat-1" },
      });
      expect(remove).toHaveBeenCalledWith({ where: { id: "strat-1" } });
    });

    it("refuses to delete a strategy that is no longer in draft (concurrent decision)", async () => {
      const { prisma } = makePrisma({
        strategy: {
          findUnique: jest.fn().mockResolvedValue(null),
          deleteMany: jest.fn(),
          delete: jest.fn(),
        },
      });
      const repo = new StrategyRepository(prisma as unknown as PrismaService);

      await expect(repo.deleteStrategy("strat-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

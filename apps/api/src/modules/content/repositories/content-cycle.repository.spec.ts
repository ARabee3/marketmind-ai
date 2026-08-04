import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  ContentCycleRepository,
  CreateContentCycleInput,
} from "./content-cycle.repository";

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

const CREATE_INPUT: CreateContentCycleInput = {
  businessId: "business-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  strategyDecisionId: "decision-1",
  profileVersionId: "profile-1",
  week1StartDate: new Date("2026-01-01T00:00:00.000Z"),
  idempotencyKey: "idem-1",
  requestFingerprint: "fingerprint-1",
};

const CYCLE_ROW = {
  id: "cycle-1",
  contractVersion: "content-v1",
  businessId: "business-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  strategyDecisionId: "decision-1",
  profileVersionId: "profile-1",
  status: "active",
  currentWeekNumber: 1,
  week1StartDate: new Date("2026-01-01T00:00:00Z"),
  nextGenerationAt: null,
  timezone: "Africa/Cairo",
  pauseReason: null,
  completedAt: null,
  ownerUserId: "owner-1",
  idempotencyKey: "idem-1",
  idempotencyFingerprint: "fingerprint-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ContentCycleRepository", () => {
  describe("createCycle", () => {
    it("creates a cycle with defaults", async () => {
      const create = jest.fn().mockResolvedValue(CYCLE_ROW);
      const repo = new ContentCycleRepository({
        contentCycle: { create },
      } as unknown as PrismaService);

      const result = await repo.createCycle(CREATE_INPUT, "owner-1");

      expect(result.id).toBe("cycle-1");
      expect(create).toHaveBeenCalledWith({
        data: {
          businessId: "business-1",
          strategyId: "strategy-1",
          strategyVersion: 3,
          strategyDecisionId: "decision-1",
          profileVersionId: "profile-1",
          week1StartDate: new Date("2026-01-01T00:00:00.000Z"),
          ownerUserId: "owner-1",
          idempotencyKey: "idem-1",
          idempotencyFingerprint: "fingerprint-1",
        },
      });
    });

    it("replays idempotently: unique violation returns the original row", async () => {
      const create = jest.fn().mockRejectedValue(uniqueViolation());
      const findFirst = jest.fn().mockResolvedValue(CYCLE_ROW);
      const repo = new ContentCycleRepository({
        contentCycle: { create, findFirst },
      } as unknown as PrismaService);

      const result = await repo.createCycle(CREATE_INPUT, "owner-1");

      expect(result.id).toBe("cycle-1");
      expect(findFirst).toHaveBeenCalledWith({
        where: { ownerUserId: "owner-1", idempotencyKey: "idem-1" },
      });
    });

    it("re-throws when replay lookup finds nothing", async () => {
      const create = jest.fn().mockRejectedValue(uniqueViolation());
      const findFirst = jest.fn().mockResolvedValue(null);
      const repo = new ContentCycleRepository({
        contentCycle: { create, findFirst },
      } as unknown as PrismaService);

      await expect(repo.createCycle(CREATE_INPUT, "owner-1")).rejects.toThrow(
        Prisma.PrismaClientKnownRequestError,
      );
    });

    it("rejects an idempotency key replay with a different request fingerprint", async () => {
      const create = jest.fn().mockRejectedValue(uniqueViolation());
      const findFirst = jest.fn().mockResolvedValue(CYCLE_ROW);
      const repo = new ContentCycleRepository({
        contentCycle: { create, findFirst },
      } as unknown as PrismaService);

      await expect(
        repo.createCycle(
          { ...CREATE_INPUT, requestFingerprint: "different" },
          "owner-1",
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONTENT_VERSION_CONFLICT" }),
      });
    });
  });

  describe("getCycleByIdAndOwner", () => {
    it("returns the cycle for the owner", async () => {
      const findUnique = jest.fn().mockResolvedValue(CYCLE_ROW);
      const repo = new ContentCycleRepository({
        contentCycle: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.getCycleByIdAndOwner("cycle-1", "owner-1");

      expect(result?.id).toBe("cycle-1");
    });

    it("returns null on cross-owner access", async () => {
      const findUnique = jest.fn().mockResolvedValue(CYCLE_ROW);
      const repo = new ContentCycleRepository({
        contentCycle: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.getCycleByIdAndOwner("cycle-1", "other-owner");

      expect(result).toBeNull();
    });

    it("returns null when the cycle does not exist", async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const repo = new ContentCycleRepository({
        contentCycle: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.getCycleByIdAndOwner("missing", "owner-1");

      expect(result).toBeNull();
    });
  });

  describe("getCycleById", () => {
    it("returns the cycle regardless of owner (worker-only read)", async () => {
      const findUnique = jest.fn().mockResolvedValue(CYCLE_ROW);
      const repo = new ContentCycleRepository({
        contentCycle: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.getCycleById("cycle-1");

      expect(findUnique).toHaveBeenCalledWith({ where: { id: "cycle-1" } });
      expect(result?.id).toBe("cycle-1");
      expect(result?.ownerUserId).toBe("owner-1");
    });

    it("returns null when the cycle does not exist", async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const repo = new ContentCycleRepository({
        contentCycle: { findUnique },
      } as unknown as PrismaService);

      const result = await repo.getCycleById("missing");

      expect(result).toBeNull();
    });
  });

  describe("pauseCycle", () => {
    function makeTx(overrides: {
      cycle?: Record<string, unknown> | null;
      updateCount?: number;
    }) {
      return jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          contentCycle: {
            findFirst: jest
              .fn()
              .mockResolvedValue(
                overrides.cycle === undefined ? CYCLE_ROW : overrides.cycle,
              ),
            updateMany: jest
              .fn()
              .mockResolvedValue({ count: overrides.updateCount ?? 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
              ...CYCLE_ROW,
              status: "paused",
              pauseReason: "busy month",
            }),
          },
        }),
      );
    }

    it("pauses an active cycle", async () => {
      const repo = new ContentCycleRepository({
        $transaction: makeTx({}),
      } as unknown as PrismaService);

      const result = await repo.pauseCycle("cycle-1", "owner-1", "busy month");

      expect(result.status).toBe("paused");
      expect(result.pauseReason).toBe("busy month");
    });

    it("throws 404 for a cycle that does not exist or is cross-owner", async () => {
      const repo = new ContentCycleRepository({
        $transaction: makeTx({ cycle: null }),
      } as unknown as PrismaService);

      await expect(
        repo.pauseCycle("cycle-1", "other-owner", "reason"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws when the cycle is not active (illegal pause)", async () => {
      const repo = new ContentCycleRepository({
        $transaction: makeTx({ updateCount: 0 }),
      } as unknown as PrismaService);

      await expect(
        repo.pauseCycle("cycle-1", "owner-1", "reason"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("resumeCycle", () => {
    it("resumes a paused cycle", async () => {
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentCycle: {
              findFirst: jest
                .fn()
                .mockResolvedValue({ ...CYCLE_ROW, status: "paused" }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow: jest.fn().mockResolvedValue({
                ...CYCLE_ROW,
                status: "active",
                pauseReason: null,
              }),
            },
          }),
      );
      const repo = new ContentCycleRepository({
        $transaction,
      } as unknown as PrismaService);

      const result = await repo.resumeCycle("cycle-1", "owner-1");

      expect(result.status).toBe("active");
      expect(result.pauseReason).toBeNull();
    });

    it("throws when the cycle is not paused", async () => {
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentCycle: {
              findFirst: jest.fn().mockResolvedValue(CYCLE_ROW),
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              findUniqueOrThrow: jest.fn(),
            },
          }),
      );
      const repo = new ContentCycleRepository({
        $transaction,
      } as unknown as PrismaService);

      await expect(
        repo.resumeCycle("cycle-1", "owner-1"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("completeCycle", () => {
    function makeTx(weekNumber: number, updateCount = 1) {
      return jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          contentCycle: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue({ currentWeekNumber: weekNumber }),
            updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
          },
        }),
      );
    }

    it("completes a cycle at week 12", async () => {
      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentCycle: {
              findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ currentWeekNumber: 12 }),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findUniqueOrThrow2: undefined,
            },
          }),
      );
      const repo = new ContentCycleRepository({
        $transaction,
      } as unknown as PrismaService);

      await expect(repo.completeCycle("cycle-1")).resolves.not.toThrow();
    });

    it("throws when the cycle is below week 12", async () => {
      const repo = new ContentCycleRepository({
        $transaction: makeTx(11),
      } as unknown as PrismaService);

      await expect(repo.completeCycle("cycle-1")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe("listActiveReadyForNextWeek", () => {
    it("filters active cycles past their next-generation cutoff", async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          ...CYCLE_ROW,
          packs: [{ weekNumber: 1, status: "draft" }],
        },
      ]);
      const repo = new ContentCycleRepository({
        contentCycle: { findMany },
      } as unknown as PrismaService);

      const result = await repo.listActiveReadyForNextWeek();

      expect(findMany).toHaveBeenCalledWith({
        where: {
          status: "active",
          nextGenerationAt: { lte: expect.any(Date) },
          currentWeekNumber: { lt: 12 },
        },
        include: {
          packs: {
            select: { weekNumber: true, status: true },
          },
        },
      });
      expect(result[0].ownerUserId).toBe("owner-1");
    });

    it("excludes cycles whose current pack is still queued, generating, or failed", async () => {
      const findMany = jest.fn().mockResolvedValue([
        {
          ...CYCLE_ROW,
          id: "ready",
          packs: [{ weekNumber: 1, status: "draft" }],
        },
        {
          ...CYCLE_ROW,
          id: "incomplete",
          packs: [{ weekNumber: 1, status: "generating" }],
        },
      ]);
      const repo = new ContentCycleRepository({
        contentCycle: { findMany },
      } as unknown as PrismaService);

      const result = await repo.listActiveReadyForNextWeek();

      expect(result.map((cycle) => cycle.id)).toEqual(["ready"]);
    });
  });

  describe("markCycleCompleted", () => {
    it("marks an active cycle completed", async () => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const repo = new ContentCycleRepository({
        contentCycle: { updateMany },
      } as unknown as PrismaService);

      await repo.markCycleCompleted("cycle-1");

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "cycle-1", status: "active" },
        data: { status: "completed", completedAt: expect.any(Date) },
      });
    });
  });
});

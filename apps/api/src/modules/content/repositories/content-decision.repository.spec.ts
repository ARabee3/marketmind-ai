import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  ContentDecisionRepository,
  ContentDecisionRow,
  RecordContentDecisionInput,
} from "./content-decision.repository";

const DECISION_ROW: ContentDecisionRow = {
  id: "decision-1",
  contentItemId: "item-1",
  contentItemVersionId: "ver-1",
  contentItemVersion: 3,
  contentItemVersionChecksum: "abc123",
  decision: "approved",
  revisionNotes: null,
  decidedByUserId: "owner-1",
  decidedAt: new Date("2026-01-01T00:00:00Z"),
  ownerUserId: "owner-1",
  idempotencyKey: "key-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const INPUT: RecordContentDecisionInput = {
  itemId: "item-1",
  versionId: "ver-1",
  versionNumber: 3,
  versionChecksum: "abc123",
  decision: "approved",
  revisionNotes: null,
  ownerUserId: "owner-1",
  idempotencyKey: "key-1",
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

function versionConflictError() {
  const err = new ConflictException({
    code: "CONTENT_VERSION_CONFLICT",
    message: "The submitted version checksum no longer matches the current item version.",
  });
  return err;
}

describe("ContentDecisionRepository", () => {
  describe("recordDecision", () => {
    function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
      const decisionCreate = jest.fn().mockResolvedValue(DECISION_ROW);
      const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const decisionFindUnique = jest
        .fn()
        .mockResolvedValue(null)
        .mockImplementationOnce(() => Promise.resolve(null));
      const itemFindUnique = jest.fn().mockResolvedValue({
        id: "item-1",
        currentVersionId: "ver-1",
      });
      const versionFindUnique = jest.fn().mockResolvedValue({
        id: "ver-1",
        version: 3,
        versionChecksum: "abc123",
      });

      const tx = {
        contentDecision: { create: decisionCreate, findUnique: decisionFindUnique, findFirst: jest.fn().mockResolvedValue(null) },
              findFirst: jest.fn().mockResolvedValue(null),
        contentItem: { findUnique: itemFindUnique, updateMany: itemUpdateMany },
        contentItemVersion: { findUnique: versionFindUnique },
        ...overrides,
      };

      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      return {
        repo: new ContentDecisionRepository({
          $transaction,
        } as unknown as PrismaService),
        decisionCreate,
        decisionFindUnique,
        itemFindUnique,
        versionFindUnique,
        itemUpdateMany,
        tx,
      };
    }

    it("records an approved decision and applies the exact-version guard", async () => {
      const { repo, decisionCreate, itemUpdateMany } = makeTx();

      const result = await repo.recordDecision(INPUT);

      expect(result.id).toBe("decision-1");
      expect(decisionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentItemId: "item-1",
          contentItemVersionId: "ver-1",
          contentItemVersion: 3,
          contentItemVersionChecksum: "abc123",
          decision: "approved",
          decidedByUserId: "owner-1",
          ownerUserId: "owner-1",
          idempotencyKey: "key-1",
        }),
      });
      expect(itemUpdateMany).toHaveBeenCalledWith({
        where: { id: "item-1", currentVersionId: "ver-1" },
        data: { currentVersionId: "ver-1", status: "approved" },
      });
    });

    it("returns the original decision on an idempotent replay", async () => {
      const { repo, decisionCreate } = makeTx();
      // First call returns the existing row for the idempotency key.
      (repo as unknown as { prisma: { $transaction: jest.Mock } }).prisma.$transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            ...makeTx().tx,
            contentDecision: {
              create: decisionCreate,
              findFirst: jest.fn().mockResolvedValue(null),
              findUnique: jest.fn().mockResolvedValue(DECISION_ROW),
            },
          }),
      );

      const result = await repo.recordDecision(INPUT);

      expect(result.id).toBe("decision-1");
      expect(decisionCreate).not.toHaveBeenCalled();
    });

    it("throws CONTENT_VERSION_CONFLICT on a stale checksum without writing", async () => {
      const mocks = makeTx();
      mocks.versionFindUnique.mockResolvedValue({
        id: "ver-1",
        version: 3,
        versionChecksum: "DIFFERENT",
      });

      await expect(
        mocks.repo.recordDecision(INPUT),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        mocks.repo.recordDecision(INPUT),
      ).rejects.toMatchObject({ response: { code: "CONTENT_VERSION_CONFLICT" } });
      expect(mocks.decisionCreate).not.toHaveBeenCalled();
    });

    it("throws CONTENT_VERSION_CONFLICT on a version that is no longer current", async () => {
      const mocks = makeTx();
      mocks.itemFindUnique.mockResolvedValue({
        id: "item-1",
        currentVersionId: "ver-2",
      });

      await expect(mocks.repo.recordDecision(INPUT)).rejects.toMatchObject({
        response: { code: "CONTENT_VERSION_CONFLICT" },
      });
      expect(mocks.decisionCreate).not.toHaveBeenCalled();
    });

    it("rolls back when a concurrent move makes the guard match zero rows", async () => {
      const { repo, decisionCreate } = makeTx();
      const itemUpdateMany = jest.fn().mockResolvedValue({ count: 0 });

      (repo as unknown as { prisma: { $transaction: jest.Mock } }).prisma.$transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentDecision: {
              create: decisionCreate,
              findFirst: jest.fn().mockResolvedValue(null),
              findUnique: jest.fn().mockResolvedValue(null),
            },
            contentItem: {
              findUnique: jest.fn().mockResolvedValue({
                id: "item-1",
                currentVersionId: "ver-1",
              }),
              updateMany: itemUpdateMany,
            },
            contentItemVersion: {
              findUnique: jest.fn().mockResolvedValue({
                id: "ver-1",
                version: 3,
                versionChecksum: "abc123",
              }),
            },
          }),
      );

      await expect(repo.recordDecision(INPUT)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("returns 404 when the item or version does not exist", async () => {
      const { repo, itemFindUnique, versionFindUnique } = makeTx();
      itemFindUnique.mockResolvedValue(null);

      await expect(repo.recordDecision(INPUT)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      itemFindUnique.mockResolvedValue({ id: "item-1", currentVersionId: "ver-1" });
      versionFindUnique.mockResolvedValue(null);

      await expect(repo.recordDecision(INPUT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("records rejected and revision_requested statuses", async () => {
      const { repo, decisionCreate, itemUpdateMany } = makeTx();
      decisionCreate.mockResolvedValue({
        ...DECISION_ROW,
        decision: "rejected",
      });

      await repo.recordDecision({ ...INPUT, decision: "rejected" });
      expect(itemUpdateMany).toHaveBeenLastCalledWith({
        where: { id: "item-1", currentVersionId: "ver-1" },
        data: { currentVersionId: "ver-1", status: "rejected" },
      });

      decisionCreate.mockResolvedValue({
        ...DECISION_ROW,
        decision: "revision_requested",
      });
      await repo.recordDecision({ ...INPUT, decision: "revision_requested" });
      expect(itemUpdateMany).toHaveBeenLastCalledWith({
        where: { id: "item-1", currentVersionId: "ver-1" },
        data: { currentVersionId: "ver-1", status: "revision_requested" },
      });
    });
  });

  describe("bulkRecordDecisions", () => {
    function makeBulkTx(
      overrides: Partial<Record<string, unknown>> = {},
    ) {
      const decisionCreate = jest.fn().mockResolvedValue(DECISION_ROW);
      const itemUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const itemFindMany = jest.fn().mockResolvedValue([
        { id: "item-1", currentVersionId: "ver-1" },
        { id: "item-2", currentVersionId: "ver-2" },
      ]);
      const versionFindMany = jest.fn().mockResolvedValue([
        { id: "ver-1", version: 3, versionChecksum: "abc123" },
        { id: "ver-2", version: 1, versionChecksum: "xyz789" },
      ]);
      const decisionFindMany = jest.fn().mockResolvedValue([]);

      const tx = {
        contentDecision: {
          create: decisionCreate,
              findFirst: jest.fn().mockResolvedValue(null),
          findMany: decisionFindMany,
        },
        contentItem: { findMany: itemFindMany, updateMany: itemUpdateMany },
        contentItemVersion: { findMany: versionFindMany },
        ...overrides,
      };

      const $transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
      );

      return {
        repo: new ContentDecisionRepository({
          $transaction,
        } as unknown as PrismaService),
        decisionCreate,
        decisionFindMany,
        itemUpdateMany,
        tx,
      };
    }

    const REQUESTS = [
      {
        itemId: "item-1",
        versionId: "ver-1",
        versionChecksum: "abc123",
        decision: "approved" as const,
        revisionNotes: null,
        idempotencyKey: "key-1",
      },
      {
        itemId: "item-2",
        versionId: "ver-2",
        versionChecksum: "xyz789",
        decision: "rejected" as const,
        revisionNotes: "fix copy",
        idempotencyKey: "key-2",
      },
    ];

    it("commits every eligible decision in one transaction", async () => {
      const { repo, decisionCreate, itemUpdateMany } = makeBulkTx();

      const result = await repo.bulkRecordDecisions(REQUESTS, "owner-1");

      expect(result.decisions).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(decisionCreate).toHaveBeenCalledTimes(2);
      expect(decisionCreate).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          contentItemId: "item-1",
          contentItemVersionId: "ver-1",
          decision: "approved",
          idempotencyKey: "key-1",
        }),
      });
      expect(decisionCreate).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          contentItemId: "item-2",
          contentItemVersionId: "ver-2",
          decision: "rejected",
          revisionNotes: "fix copy",
          idempotencyKey: "key-2",
        }),
      });
      expect(itemUpdateMany).toHaveBeenCalledTimes(2);
    });

    it("returns the ineligible item's error but commits the eligible ones", async () => {
      const { repo, decisionCreate } = makeBulkTx();
      // item-2 is stale: its current version is ver-2 but the request targets ver-2
      // with a mismatched checksum. Make only item-1 eligible by dropping ver-2 from
      // the version rows so item-2 hits "version not found".
      (
        repo as unknown as { prisma: { $transaction: jest.Mock } }
      ).prisma.$transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentDecision: {
              create: decisionCreate,
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
            },
            contentItem: {
              findMany: jest.fn().mockResolvedValue([
                { id: "item-1", currentVersionId: "ver-1" },
                { id: "item-2", currentVersionId: "ver-2" },
              ]),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            contentItemVersion: {
              findMany: jest.fn().mockResolvedValue([
                { id: "ver-1", version: 3, versionChecksum: "abc123" },
              ]),
            },
          }),
      );

      const result = await repo.bulkRecordDecisions(REQUESTS, "owner-1");

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].contentItemId).toBe("item-1");
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].itemId).toBe("item-2");
      expect(result.errors[0].code).toBe("CONTENT_VERSION_CONFLICT");
      expect(decisionCreate).toHaveBeenCalledTimes(1);
    });

    it("reports an already-decided version without blocking eligible ones", async () => {
      const { repo, decisionCreate } = makeBulkTx();
      (
        repo as unknown as { prisma: { $transaction: jest.Mock } }
      ).prisma.$transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentDecision: {
              create: decisionCreate.mockImplementation(
                ({ data }: { data: { contentItemId: string } }) =>
                  Promise.resolve({ ...DECISION_ROW, ...data }),
              ),
              findMany: jest
                .fn()
                .mockResolvedValueOnce([{ contentItemVersionId: "ver-1" }])
                .mockResolvedValueOnce([]),
            },
            contentItem: {
              findMany: jest.fn().mockResolvedValue([
                { id: "item-1", currentVersionId: "ver-1" },
                { id: "item-2", currentVersionId: "ver-2" },
              ]),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            contentItemVersion: {
              findMany: jest.fn().mockResolvedValue([
                { id: "ver-1", version: 3, versionChecksum: "abc123" },
                { id: "ver-2", version: 1, versionChecksum: "xyz789" },
              ]),
            },
          }),
      );

      const result = await repo.bulkRecordDecisions(REQUESTS, "owner-1");

      // item-1 is already decided (CONTENT_APPROVAL_BLOCKED), item-2 commits.
      expect(result.errors.some((e) => e.itemId === "item-1")).toBe(true);
      expect(
        result.errors.find((e) => e.itemId === "item-1")?.code,
      ).toBe("CONTENT_APPROVAL_BLOCKED");
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].contentItemId).toBe("item-2");
      expect(decisionCreate).toHaveBeenCalledTimes(1);
    });

    it("replays existing decisions for previously used idempotency keys", async () => {
      const { repo, decisionCreate } = makeBulkTx();
      const existingRow = { ...DECISION_ROW, idempotencyKey: "key-1" };
      (
        repo as unknown as { prisma: { $transaction: jest.Mock } }
      ).prisma.$transaction = jest.fn(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            contentDecision: {
              create: decisionCreate,
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest
                .fn()
                .mockResolvedValueOnce([]) // decided-by-version: none
                .mockResolvedValueOnce([existingRow]) // replay-by-key: key-1 exists
                .mockResolvedValueOnce([existingRow]) // decided-by-version now includes it
                .mockResolvedValueOnce([existingRow]), // replay-by-key for second run
            },
            contentItem: {
              findMany: jest.fn().mockResolvedValue([
                { id: "item-1", currentVersionId: "ver-1" },
                { id: "item-2", currentVersionId: "ver-2" },
              ]),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            contentItemVersion: {
              findMany: jest.fn().mockResolvedValue([
                { id: "ver-1", version: 3, versionChecksum: "abc123" },
                { id: "ver-2", version: 1, versionChecksum: "xyz789" },
              ]),
            },
          }),
      );

      const result = await repo.bulkRecordDecisions(REQUESTS, "owner-1");

      // key-1 replays the original decision; only key-2 creates a new row.
      expect(result.decisions.some((d) => d.idempotencyKey === "key-1")).toBe(true);
      expect(decisionCreate).toHaveBeenCalledTimes(1);
      expect(decisionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ idempotencyKey: "key-2" }),
      });
    });
  });
});

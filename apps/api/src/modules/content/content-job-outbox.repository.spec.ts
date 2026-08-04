import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import { ContentJobOutboxRepository } from "./content-job-outbox.repository";

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

const INPUT = {
  jobId: "generate-content:pack-1",
  queueName: "content-generation",
  jobName: "generate-content",
  payload: { contentPackId: "pack-1", weekNumber: 1 },
} as const;

describe("ContentJobOutboxRepository", () => {
  it("creates one immutable durable job intent", async () => {
    const create = jest.fn().mockResolvedValue({ id: "row-1", ...INPUT });
    const repo = new ContentJobOutboxRepository({
      contentJobOutbox: { create },
    } as unknown as PrismaService);

    await repo.createIntent(INPUT);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: INPUT.jobId,
        queueName: INPUT.queueName,
        jobName: INPUT.jobName,
        payload: INPUT.payload,
      }),
    });
  });

  it("replays identical intent bytes and rejects a conflicting reuse", async () => {
    const existing = { id: "row-1", ...INPUT };
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    const findUnique = jest.fn().mockResolvedValue(existing);
    const repo = new ContentJobOutboxRepository({
      contentJobOutbox: { create, findUnique },
    } as unknown as PrismaService);

    await expect(repo.createIntent(INPUT)).resolves.toEqual(existing);
    await expect(
      repo.createIntent({ ...INPUT, payload: { contentPackId: "other" } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("claims due jobs with a lease and SKIP LOCKED query", async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: "row-1" }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findMany = jest.fn().mockResolvedValue([{ id: "row-1", ...INPUT }]);
    const repo = new ContentJobOutboxRepository({
      $transaction: jest.fn(async (callback) =>
        callback({
          $queryRaw: queryRaw,
          contentJobOutbox: { updateMany, findMany },
        } as never),
      ),
    } as unknown as PrismaService);

    const claimed = await repo.claimDueJobs("worker-1", 10, 30_000);

    expect(claimed).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        where: { id: "row-1", state: "pending" },
        data: expect.objectContaining({
          state: "processing",
          leaseOwner: "worker-1",
        }),
      }),
    );
  });

  it("marks a claimed job dispatched or returns it to pending with backoff", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({ attempts: 1 });
    const repo = new ContentJobOutboxRepository({
      contentJobOutbox: { findFirst, updateMany },
    } as unknown as PrismaService);

    await expect(repo.markDispatched("row-1", "worker-1")).resolves.toBe(true);
    await expect(
      repo.releaseForRetry("row-1", "worker-1", "Redis unavailable"),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "row-1", state: "processing", leaseOwner: "worker-1" },
      data: expect.objectContaining({
        state: "pending",
        attempts: 2,
        lastError: "Redis unavailable",
      }),
    });
  });
});

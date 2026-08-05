import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { ContentJobOutboxRepository } from "../src/modules/content/content-job-outbox.repository";

const prisma = new PrismaClient();
const run = `job-outbox-${randomUUID()}`;

describe("Content job outbox DB recovery", () => {
  let repository: ContentJobOutboxRepository;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new ContentJobOutboxRepository(
      prisma as unknown as PrismaService,
    );
  });

  afterAll(async () => {
    await prisma.contentJobOutbox.deleteMany({
      where: { jobId: { startsWith: run } },
    });
    await prisma.$disconnect();
  });

  it("claims one durable intent exactly once and repairs a failed queue add", async () => {
    const jobId = `${run}:generate-content:pack-1`;
    const payload = { contentPackId: "pack-1", weekNumber: 1 };
    const first = await repository.createIntent({
      jobId,
      queueName: "content-generation",
      jobName: "generate-content",
      payload,
    });
    const replay = await repository.createIntent({
      jobId,
      queueName: "content-generation",
      jobName: "generate-content",
      payload,
    });
    expect(replay.id).toBe(first.id);

    const [workerA, workerB] = await Promise.all([
      repository.claimDueJobs(`${run}:worker-a`),
      repository.claimDueJobs(`${run}:worker-b`),
    ]);
    expect(workerA.length + workerB.length).toBe(1);
    const owner = workerA.length === 1 ? `${run}:worker-a` : `${run}:worker-b`;
    const row = workerA[0] ?? workerB[0];
    expect(row?.state).toBe("processing");

    await expect(
      repository.releaseForRetry(row!.id, owner, "Redis unavailable"),
    ).resolves.toBe(true);
    const pending = await prisma.contentJobOutbox.findUniqueOrThrow({
      where: { id: row!.id },
    });
    expect(pending.state).toBe("pending");
    expect(pending.attempts).toBe(1);
    expect(pending.nextAttemptAt).not.toBeNull();

    await prisma.contentJobOutbox.update({
      where: { id: row!.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const recovered = await repository.claimDueJobs(`${run}:worker-recovery`);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.jobId).toBe(jobId);
    await expect(
      repository.markDispatched(recovered[0]!.id, `${run}:worker-recovery`),
    ).resolves.toBe(true);
  });
});

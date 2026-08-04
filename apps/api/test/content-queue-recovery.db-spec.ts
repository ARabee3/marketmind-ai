import { Queue } from "bullmq";

const run = `content-queue-${Date.now()}`;
const queueName = `content-generation-${run}`;
const jobId = `generate-content:${run}:pack-1`;

describe("Content BullMQ deterministic delivery", () => {
  let queue: Queue;

  beforeAll(() => {
    queue = new Queue(queueName, {
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      },
    });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("reuses one stable Bull job identity across enqueue replay", async () => {
    const payload = {
      contentCycleId: "cycle-1",
      contentPackId: "pack-1",
      weekNumber: 1,
    };
    const first = await queue.add("generate-content", payload, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
    });
    const replay = await queue.add("generate-content", payload, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
    });

    expect(first.id).toBe(jobId);
    expect(replay.id).toBe(jobId);
    expect(await queue.getJobCounts("waiting", "active", "failed")).toEqual(
      expect.objectContaining({ waiting: 1 }),
    );
    expect((await queue.getJob(jobId))?.data).toEqual(payload);
  });
});

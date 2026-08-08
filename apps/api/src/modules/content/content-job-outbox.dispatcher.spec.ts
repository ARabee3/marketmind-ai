import { ContentJobOutboxDispatcher } from "./content-job-outbox.dispatcher";

describe("ContentJobOutboxDispatcher", () => {
  it("reconciles a claimed job into BullMQ with its stable job ID", async () => {
    const jobs = {
      claimDueJobs: jest.fn().mockResolvedValue([
        {
          id: "row-1",
          jobId: "generate-content:pack-1",
          queueName: "content-generation",
          jobName: "generate-content",
          payload: { contentPackId: "pack-1" },
        },
      ]),
      markDispatched: jest.fn().mockResolvedValue(true),
      releaseForRetry: jest.fn(),
    };
    const generationQueue = {
      add: jest.fn().mockResolvedValue({ id: "bull-1" }),
    };
    const outboxQueue = { add: jest.fn() };
    const dispatcher = new ContentJobOutboxDispatcher(
      jobs as never,
      generationQueue as never,
      outboxQueue as never,
    );

    await dispatcher.reconcile();

    expect(generationQueue.add).toHaveBeenCalledWith(
      "generate-content",
      { contentPackId: "pack-1" },
      expect.objectContaining({ jobId: "generate-content-pack-1" }),
    );
    expect(jobs.markDispatched).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("content-job-reconciler:"),
    );
  });

  it("returns queue failures to the durable retry state", async () => {
    const jobs = {
      claimDueJobs: jest.fn().mockResolvedValue([
        {
          id: "row-1",
          jobId: "generate-static-asset:asset-1",
          queueName: "content-generation",
          jobName: "generate-static-asset",
          payload: {},
        },
      ]),
      markDispatched: jest.fn(),
      releaseForRetry: jest.fn().mockResolvedValue(true),
    };
    const generationQueue = {
      add: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    };
    const dispatcher = new ContentJobOutboxDispatcher(
      jobs as never,
      generationQueue as never,
      { add: jest.fn() } as never,
    );

    await dispatcher.reconcile();

    expect(jobs.releaseForRetry).toHaveBeenCalledWith(
      "row-1",
      expect.stringContaining("content-job-reconciler:"),
      "Redis unavailable",
    );
    expect(jobs.markDispatched).not.toHaveBeenCalled();
  });
});

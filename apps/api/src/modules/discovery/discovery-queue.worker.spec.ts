import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";
import { DiscoveryQueueWorker } from "./discovery-queue.worker";
import { DiscoveryResearchProcessor } from "./discovery-research.processor";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(function (_name, _processor, _opts) {
    this.on = jest.fn();
    this.close = jest.fn();
  }),
}));

describe("DiscoveryQueueWorker", () => {
  const mockProducer = {
    getQueue: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryQueueProducer>;

  const mockProcessor = {
    process: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryResearchProcessor>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a worker when DISCOVERY_WORKER_ENABLED is true", () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === "discovery.workerEnabled") return true;
        if (key === "discovery.workerConcurrency") return 2;
        if (key === "redis.url") return "redis://localhost:6379";
        return undefined;
      }),
    } as unknown as ConfigService;

    const worker = new DiscoveryQueueWorker(
      config,
      mockProducer,
      mockProcessor,
    );
    worker.onModuleInit();

    const { Worker } = require("bullmq");
    expect(Worker).toHaveBeenCalledWith(
      "discovery-research",
      expect.any(Function),
      expect.objectContaining({ concurrency: 2 }),
    );

    worker.onModuleDestroy();
  });

  it("does not create a worker when DISCOVERY_WORKER_ENABLED is false", () => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === "discovery.workerEnabled") return false;
        return undefined;
      }),
    } as unknown as ConfigService;

    const worker = new DiscoveryQueueWorker(
      config,
      mockProducer,
      mockProcessor,
    );
    worker.onModuleInit();

    const { Worker } = require("bullmq");
    expect(Worker).not.toHaveBeenCalled();

    worker.onModuleDestroy();
  });
});

import { ConfigService } from "@nestjs/config";
import { ProviderError } from "../../common/errors/provider-error";
import {
  DiscoveryQueueProducer,
  DiscoveryResearchJobData,
} from "./discovery-queue.producer";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => mockQueue),
}));

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();

const mockQueue = {
  add: mockQueueAdd,
  close: mockQueueClose,
};

describe("DiscoveryQueueProducer", () => {
  let producer: DiscoveryQueueProducer;

  beforeEach(() => {
    jest.clearAllMocks();
    producer = new DiscoveryQueueProducer({
      get: jest.fn().mockReturnValue("redis://localhost:6379"),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await producer.onModuleDestroy();
  });

  it("enqueues a research job with session_id as jobId", async () => {
    mockQueueAdd.mockResolvedValue({ id: SESSION_ID });

    await producer.enqueueResearch(SESSION_ID);

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "research",
      { session_id: SESSION_ID },
      { jobId: SESSION_ID },
    );
  });

  it("throws DISCOVERY_ENQUEUE_FAILED when queue add rejects", async () => {
    mockQueueAdd.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(producer.enqueueResearch(SESSION_ID)).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(producer.enqueueResearch(SESSION_ID)).rejects.toMatchObject({
      code: "DISCOVERY_ENQUEUE_FAILED",
      retryable: true,
    });
  });

  it("closes the queue on module destroy", async () => {
    await producer.onModuleDestroy();
    expect(mockQueueClose).toHaveBeenCalled();
  });
});

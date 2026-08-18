import type { Job } from "bullmq";
import { PerformanceProviderError } from "./facebook-performance.provider";
import { PerformanceProcessor } from "./performance.processor";

const window = {
  contract_version: "performance-v1" as const,
  sync_window_id: "a2000000-0000-4000-8000-000000000001",
  business_id: "a1000000-0000-4000-8000-000000000002",
  publishing_result_id: "a1000000-0000-4000-8000-000000000003",
  provider: "facebook" as const,
  window: "24h" as const,
  due_at: "2026-08-19T08:00:00.000Z",
  state: "leased" as const,
  attempt_count: 1,
  next_attempt_at: null,
  lease_owner: "lease-1",
  lease_expires_at: "2026-08-19T08:05:00.000Z",
  last_error_code: null,
  created_at: "2026-08-18T08:00:00.000Z",
  updated_at: "2026-08-18T08:00:00.000Z",
};

const context = {
  publishingResultId: window.publishing_result_id,
  businessId: window.business_id,
  ownerUserId: "a1000000-0000-4000-8000-000000000001",
  publishingAttemptId: "a1000000-0000-4000-8000-000000000004",
  publicationIntentId: "a1000000-0000-4000-8000-000000000005",
  candidateId: "a1000000-0000-4000-8000-000000000006",
  candidateChecksum: "checksum",
  providerObjectId: "page-1_post-1",
  publishedAt: new Date("2026-08-18T08:00:00Z"),
  target: null,
};

const observation = {
  postId: "page-1_post-1",
  graphVersion: "v21.0",
  fetchedAt: new Date("2026-08-19T08:01:00Z"),
  metrics: [],
};

function makeProcessor() {
  const repository = {
    getSyncWindowById: jest.fn().mockResolvedValue(window),
    getPublicationContext: jest.fn().mockResolvedValue(context),
    getSnapshotForWindow: jest.fn().mockResolvedValue(null),
    completeSyncWindowWithSnapshot: jest.fn().mockResolvedValue({}),
    markSyncWindowSucceeded: jest.fn().mockResolvedValue(true),
    markSyncWindowRetryable: jest.fn().mockResolvedValue(true),
    markSyncWindowTerminal: jest.fn().mockResolvedValue(true),
  };
  const provider = { fetch: jest.fn().mockResolvedValue(observation) };
  return {
    processor: new PerformanceProcessor(repository as never, provider as never),
    repository,
    provider,
  };
}

const job = (data: { syncWindowId: string; leaseOwner: string }) =>
  ({ data }) as Job<{ syncWindowId: string; leaseOwner: string }>;

describe("PerformanceProcessor", () => {
  it("persists the snapshot and closes the same claimed lease", async () => {
    const { processor, repository } = makeProcessor();

    await processor.process(
      job({ syncWindowId: window.sync_window_id, leaseOwner: "lease-1" }),
    );

    expect(repository.completeSyncWindowWithSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        syncWindowId: window.sync_window_id,
        owner: "lease-1",
      }),
    );
    expect(repository.markSyncWindowTerminal).not.toHaveBeenCalled();
  });

  it("retries a transient provider failure with bounded backoff", async () => {
    const { processor, repository, provider } = makeProcessor();
    provider.fetch.mockRejectedValue(
      new PerformanceProviderError("PERFORMANCE_PROVIDER_RATE_LIMITED", true),
    );

    await processor.process(
      job({ syncWindowId: window.sync_window_id, leaseOwner: "lease-1" }),
    );

    expect(repository.markSyncWindowRetryable).toHaveBeenCalledWith(
      expect.objectContaining({
        syncWindowId: window.sync_window_id,
        owner: "lease-1",
        errorCode: "PERFORMANCE_PROVIDER_RATE_LIMITED",
        nextAttemptAt: expect.any(Date),
      }),
    );
    expect(repository.markSyncWindowTerminal).not.toHaveBeenCalled();
  });

  it("does not retry a permission blocker after the bounded attempt budget", async () => {
    const { processor, repository, provider } = makeProcessor();
    repository.getSyncWindowById.mockResolvedValue({
      ...window,
      attempt_count: 5,
    });
    provider.fetch.mockRejectedValue(
      new PerformanceProviderError("PERFORMANCE_PERMISSION_REQUIRED", false),
    );

    await processor.process(
      job({ syncWindowId: window.sync_window_id, leaseOwner: "lease-1" }),
    );

    expect(repository.markSyncWindowTerminal).toHaveBeenCalledWith({
      syncWindowId: window.sync_window_id,
      owner: "lease-1",
      errorCode: "PERFORMANCE_PERMISSION_REQUIRED",
    });
  });

  it("ignores a stale job whose lease was reclaimed by another worker", async () => {
    const { processor, repository, provider } = makeProcessor();
    repository.getSyncWindowById.mockResolvedValue({
      ...window,
      lease_owner: "lease-2",
    });

    await processor.process(
      job({ syncWindowId: window.sync_window_id, leaseOwner: "lease-1" }),
    );

    expect(provider.fetch).not.toHaveBeenCalled();
    expect(repository.completeSyncWindowWithSnapshot).not.toHaveBeenCalled();
  });
});

import { PerformanceReconciler } from "./performance.reconciler";

const WINDOW_ID = "a2000000-0000-4000-8000-000000000001";

function claimedWindow() {
  return {
    contract_version: "performance-v1" as const,
    sync_window_id: WINDOW_ID,
    business_id: "a1000000-0000-4000-8000-000000000002",
    publishing_result_id: "a1000000-0000-4000-8000-000000000003",
    provider: "facebook" as const,
    window: "24h" as const,
    due_at: "2026-08-18T08:00:00.000Z",
    state: "leased" as const,
    attempt_count: 2,
    next_attempt_at: null,
    lease_owner: "owner",
    lease_expires_at: "2026-08-18T08:05:00.000Z",
    last_error_code: null,
    created_at: "2026-08-17T08:00:00.000Z",
    updated_at: "2026-08-18T08:00:00.000Z",
  };
}

function makeReconciler(queueAdd = jest.fn().mockResolvedValue({})) {
  const repository = {
    listEligiblePublicationIds: jest.fn().mockResolvedValue(["result-1"]),
    ensureSyncWindowsForResult: jest
      .fn()
      .mockResolvedValue([
        { sync_window_id: "window-1" },
        { sync_window_id: "window-2" },
        { sync_window_id: "window-3" },
      ]),
    recoverExpiredLeases: jest.fn().mockResolvedValue(1),
    listDueSyncWindowIds: jest.fn().mockResolvedValue([WINDOW_ID]),
    claimSyncWindow: jest.fn().mockResolvedValue(claimedWindow()),
    releaseSyncWindowAfterEnqueueFailure: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const reconciler = new PerformanceReconciler(
    repository as never,
    {
      add: queueAdd,
    } as never,
  );
  return { reconciler, repository, queueAdd };
}

describe("PerformanceReconciler", () => {
  it("rebuilds windows, recovers leases, and enqueues a deterministic job", async () => {
    const { reconciler, repository, queueAdd } = makeReconciler();
    const result = await reconciler.reconcileOnce(
      new Date("2026-08-18T08:00:00Z"),
    );

    expect(result).toMatchObject({
      discovered: 3,
      recovered: 1,
      claimed: 1,
      enqueued: 1,
    });
    expect(queueAdd).toHaveBeenCalledWith(
      "sync-window",
      expect.objectContaining({
        syncWindowId: WINDOW_ID,
        leaseOwner: expect.stringContaining("performance-reconciler:"),
      }),
      expect.objectContaining({
        jobId: `performance-sync:${WINDOW_ID}:2`,
        attempts: 1,
      }),
    );
    expect(
      repository.releaseSyncWindowAfterEnqueueFailure,
    ).not.toHaveBeenCalled();
  });

  it("keeps the claimed row recoverable when Redis enqueue fails", async () => {
    const queueAdd = jest
      .fn()
      .mockRejectedValue(new Error("redis unavailable"));
    const { reconciler, repository } = makeReconciler(queueAdd);
    const now = new Date("2026-08-18T08:00:00Z");

    await expect(reconciler.reconcileOnce(now)).resolves.toMatchObject({
      claimed: 1,
      enqueued: 0,
    });
    expect(
      repository.releaseSyncWindowAfterEnqueueFailure,
    ).toHaveBeenCalledWith(
      WINDOW_ID,
      expect.stringContaining("performance-reconciler:"),
      new Date("2026-08-18T08:01:00.000Z"),
    );
  });
});

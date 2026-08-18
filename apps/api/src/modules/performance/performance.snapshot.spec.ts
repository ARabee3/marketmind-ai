import { buildPerformanceSnapshot } from "./performance.snapshot";

const context = {
  publishingResultId: "a1000000-0000-4000-8000-000000000003",
  businessId: "a1000000-0000-4000-8000-000000000002",
  ownerUserId: "a1000000-0000-4000-8000-000000000001",
  publishingAttemptId: "a1000000-0000-4000-8000-000000000004",
  publicationIntentId: "a1000000-0000-4000-8000-000000000005",
  candidateId: "a1000000-0000-4000-8000-000000000006",
  candidateChecksum: "checksum",
  providerObjectId: "page-1_post-1",
  publishedAt: new Date("2026-08-18T08:00:00Z"),
  target: null,
};

describe("buildPerformanceSnapshot", () => {
  it("preserves numeric zero and distinguishes missing/invalid metrics", () => {
    const snapshot = buildPerformanceSnapshot({
      context,
      window: {
        sync_window_id: "a2000000-0000-4000-8000-000000000001",
        publishing_result_id: context.publishingResultId,
        business_id: context.businessId,
        window: "24h",
        due_at: "2026-08-19T08:00:00Z",
      },
      observation: {
        postId: context.providerObjectId,
        graphVersion: "v21.0",
        fetchedAt: new Date("2026-08-19T08:01:00Z"),
        metrics: [
          {
            name: "post_media_view",
            period: "lifetime",
            values: [{ value: 0, endTime: "2026-08-19T08:00:30Z" }],
          },
          {
            name: "post_clicks",
            period: "lifetime",
            values: [{ value: { like: 1 }, endTime: null }],
          },
        ],
      },
    });

    expect(snapshot.metrics.post_media_view).toEqual({
      status: "available",
      value: 0,
    });
    expect(snapshot.metrics.post_total_media_view_unique).toEqual({
      status: "unavailable",
      reason: "not_returned",
    });
    expect(snapshot.metrics.post_clicks).toEqual({
      status: "unavailable",
      reason: "invalid_value",
    });
    expect(snapshot.observed_at).toBe("2026-08-19T08:00:30.000Z");
  });
});

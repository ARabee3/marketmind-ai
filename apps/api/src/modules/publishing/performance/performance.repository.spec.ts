import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  PerformanceRepository,
  PerformanceRepositoryError,
} from "./performance.repository";
import type { MetricSnapshotV1 } from "@marketmind/contracts";

const BUSINESS_ID = "a1000000-0000-4000-8000-000000000002";
const OTHER_BUSINESS_ID = "b1000000-0000-4000-8000-000000000002";
const RESULT_ID = "a1000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "a1000000-0000-4000-8000-000000000004";
const INTENT_ID = "a1000000-0000-4000-8000-000000000005";
const CANDIDATE_ID = "a1000000-0000-4000-8000-000000000006";
const SNAPSHOT_ID = "a1000000-0000-4000-8000-000000000001";
const SYNC_WINDOW_ID = "a2000000-0000-4000-8000-000000000001";
const CHECKSUM =
  "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";
const PUBLISHED_AT = "2026-08-18T08:00:00Z";
const DUE_AT = "2026-08-19T08:00:00Z";

function chain(overrides: Record<string, unknown> = {}) {
  return {
    id: RESULT_ID,
    intentId: INTENT_ID,
    outcome: "PUBLISHED",
    provider: "meta",
    remotePublicationId: "page-123_post-456",
    occurredAt: new Date(PUBLISHED_AT),
    attempt: {
      id: ATTEMPT_ID,
      intentId: INTENT_ID,
      intent: {
        id: INTENT_ID,
        businessId: BUSINESS_ID,
        mode: "REAL",
        candidate: {
          id: CANDIDATE_ID,
          businessId: BUSINESS_ID,
          candidateChecksum: CHECKSUM,
          channel: "facebook",
          status: "ACTIVE",
        },
      },
    },
    ...overrides,
  };
}

function syncWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: SYNC_WINDOW_ID,
    businessId: BUSINESS_ID,
    publishingResultId: RESULT_ID,
    provider: "facebook",
    window: "24h",
    dueAt: new Date(DUE_AT),
    state: "queued",
    attemptCount: 0,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: new Date("2026-08-18T08:00:00Z"),
    updatedAt: new Date("2026-08-18T08:00:00Z"),
    ...overrides,
  };
}

function snapshot(overrides: Partial<MetricSnapshotV1> = {}): MetricSnapshotV1 {
  return {
    contract_version: "performance-v1",
    snapshot_id: SNAPSHOT_ID,
    business_id: BUSINESS_ID,
    publishing_result_id: RESULT_ID,
    publishing_attempt_id: ATTEMPT_ID,
    publication_intent_id: INTENT_ID,
    candidate_id: CANDIDATE_ID,
    candidate_checksum: CHECKSUM,
    provider: "facebook",
    provider_object_id: "page-123_post-456",
    window: "24h",
    published_at: PUBLISHED_AT,
    due_at: DUE_AT,
    observed_at: "2026-08-19T08:01:00Z",
    fetched_at: "2026-08-19T08:01:12Z",
    graph_version: "v21.0",
    metric_schema_version: "facebook-insights-v1",
    metrics: {
      post_media_view: { status: "available", value: 0 },
      post_total_media_view_unique: {
        status: "unavailable",
        reason: "not_returned",
      },
      post_clicks: { status: "available", value: 14 },
    },
    provider_metadata: {
      source: "meta_insights",
      response_metric_count: 2,
      response_periods: ["lifetime"],
    },
    created_at: "2026-08-19T08:01:12Z",
    ...overrides,
  };
}

function dbSnapshot(value = snapshot()) {
  return {
    id: value.snapshot_id,
    businessId: value.business_id,
    publishingResultId: value.publishing_result_id,
    publishingAttemptId: value.publishing_attempt_id,
    publishingIntentId: value.publication_intent_id,
    candidateId: value.candidate_id,
    candidateChecksum: value.candidate_checksum,
    provider: value.provider,
    providerObjectId: value.provider_object_id,
    window: value.window,
    publishedAt: new Date(value.published_at),
    dueAt: new Date(value.due_at),
    observedAt: value.observed_at ? new Date(value.observed_at) : null,
    fetchedAt: new Date(value.fetched_at),
    graphVersion: value.graph_version,
    metricSchemaVersion: value.metric_schema_version,
    metrics: value.metrics,
    providerMetadata: value.provider_metadata,
    createdAt: new Date(value.created_at),
  };
}

function makePrisma() {
  return {
    publishingResult: { findUnique: jest.fn() },
    performanceSyncWindow: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    metricSnapshot: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  } as any;
}

describe("PerformanceRepository", () => {
  it("creates one eligible Facebook sync window and preserves owner scope", async () => {
    const prisma = makePrisma();
    prisma.publishingResult.findUnique.mockResolvedValue(chain());
    prisma.performanceSyncWindow.create.mockResolvedValue(syncWindow());
    const repository = new PerformanceRepository(prisma as PrismaService);

    const result = await repository.createSyncWindow({
      businessId: BUSINESS_ID,
      publishingResultId: RESULT_ID,
      window: "24h",
      dueAt: new Date(DUE_AT),
    });

    expect(result.window).toBe("24h");
    expect(prisma.performanceSyncWindow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: BUSINESS_ID,
        publishingResultId: RESULT_ID,
        provider: "facebook",
        window: "24h",
      }),
    });
  });

  it.each([
    ["EXPORTED", "meta", true, "REAL", "facebook", "ACTIVE", "result outcome"],
    [
      "SIMULATED",
      null,
      false,
      "SIMULATION",
      "facebook",
      "ACTIVE",
      "simulation",
    ],
    ["FAILED", "meta", false, "REAL", "facebook", "ACTIVE", "failed"],
    ["CANCELLED", "meta", false, "REAL", "facebook", "ACTIVE", "cancelled"],
    ["UNKNOWN", "meta", false, "REAL", "facebook", "ACTIVE", "unknown"],
    ["PUBLISHED", "meta", false, "REAL", "facebook", "ACTIVE", "remote ID"],
    ["PUBLISHED", "meta", true, "REAL", "instagram", "ACTIVE", "channel"],
    ["PUBLISHED", "meta", true, "SIMULATION", "facebook", "ACTIVE", "mode"],
    ["PUBLISHED", "instagram", true, "REAL", "facebook", "ACTIVE", "provider"],
    ["PUBLISHED", "meta", true, "REAL", "facebook", "ACTIVE", "business"],
  ] as const)(
    "rejects %s provider=%s remote=%s mode=%s channel=%s candidate=%s (%s)",
    async (
      outcome,
      provider,
      hasRemoteId,
      mode,
      channel,
      candidateStatus,
      reason,
    ) => {
      const prisma = makePrisma();
      prisma.publishingResult.findUnique.mockResolvedValue(
        chain({
          outcome,
          provider,
          remotePublicationId: hasRemoteId ? "remote" : null,
          attempt: {
            ...chain().attempt,
            intent: {
              ...chain().attempt.intent,
              businessId:
                reason === "business" ? OTHER_BUSINESS_ID : BUSINESS_ID,
              mode,
              candidate: {
                ...chain().attempt.intent.candidate,
                channel,
                status: candidateStatus,
                businessId:
                  reason === "business" ? OTHER_BUSINESS_ID : BUSINESS_ID,
              },
            },
          },
        }),
      );
      const repository = new PerformanceRepository(prisma as PrismaService);

      await expect(
        repository.createSyncWindow({
          businessId: BUSINESS_ID,
          publishingResultId: RESULT_ID,
          window: "24h",
          dueAt: new Date(DUE_AT),
        }),
      ).rejects.toMatchObject<Partial<PerformanceRepositoryError>>({
        code: "PERFORMANCE_NOT_ELIGIBLE",
      });
      expect(prisma.performanceSyncWindow.create).not.toHaveBeenCalled();
    },
  );

  it("persists an immutable snapshot with provenance IDs only, not candidate payload", async () => {
    const prisma = makePrisma();
    prisma.publishingResult.findUnique.mockResolvedValue(chain());
    prisma.performanceSyncWindow.findUnique.mockResolvedValue(syncWindow());
    prisma.metricSnapshot.create.mockResolvedValue(dbSnapshot());
    const repository = new PerformanceRepository(prisma as PrismaService);

    const result = await repository.createMetricSnapshot({
      snapshot: snapshot(),
    });
    const createData = prisma.metricSnapshot.create.mock.calls[0][0].data;

    expect(result.metrics.post_media_view).toEqual({
      status: "available",
      value: 0,
    });
    expect(createData).toEqual(
      expect.objectContaining({
        candidateId: CANDIDATE_ID,
        candidateChecksum: CHECKSUM,
        providerObjectId: "page-123_post-456",
      }),
    );
    expect(createData).not.toHaveProperty("payload");
    expect(createData).not.toHaveProperty("caption");
  });

  it("rejects a provider object ID that does not match the server-side publishing result", async () => {
    const prisma = makePrisma();
    prisma.publishingResult.findUnique.mockResolvedValue(chain());
    const repository = new PerformanceRepository(prisma as PrismaService);

    await expect(
      repository.createMetricSnapshot({
        snapshot: snapshot({ provider_object_id: "client-supplied-post" }),
      }),
    ).rejects.toMatchObject({
      code: "PERFORMANCE_INVALID_PROVIDER_DATA",
    });
    expect(prisma.performanceSyncWindow.findUnique).not.toHaveBeenCalled();
    expect(prisma.metricSnapshot.create).not.toHaveBeenCalled();
  });

  it("keeps a real published result eligible after a later candidate revocation", async () => {
    const prisma = makePrisma();
    prisma.publishingResult.findUnique.mockResolvedValue(
      chain({
        attempt: {
          ...chain().attempt,
          intent: {
            ...chain().attempt.intent,
            candidate: {
              ...chain().attempt.intent.candidate,
              status: "REVOKED",
            },
          },
        },
      }),
    );
    prisma.performanceSyncWindow.create.mockResolvedValue(syncWindow());
    const repository = new PerformanceRepository(prisma as PrismaService);

    await expect(
      repository.createSyncWindow({
        businessId: BUSINESS_ID,
        publishingResultId: RESULT_ID,
        window: "24h",
        dueAt: new Date(DUE_AT),
      }),
    ).resolves.toMatchObject({ provider: "facebook" });
  });

  it("treats an identical replay as a read-only no-op and rejects a conflicting replay", async () => {
    const first = snapshot();
    const reordered = dbSnapshot(first);
    reordered.metrics = {
      post_clicks: first.metrics.post_clicks,
      post_total_media_view_unique: first.metrics.post_total_media_view_unique,
      post_media_view: first.metrics.post_media_view,
    };
    reordered.providerMetadata = {
      response_periods: first.provider_metadata.response_periods,
      response_metric_count: first.provider_metadata.response_metric_count,
      source: first.provider_metadata.source,
    };
    const prisma = makePrisma();
    prisma.publishingResult.findUnique.mockResolvedValue(chain());
    prisma.performanceSyncWindow.findUnique.mockResolvedValue(syncWindow());
    prisma.metricSnapshot.create.mockRejectedValue({
      message: "P2002 unique constraint",
    });
    prisma.metricSnapshot.findUnique.mockResolvedValue(reordered);
    const repository = new PerformanceRepository(prisma as PrismaService);

    await expect(
      repository.createMetricSnapshot({ snapshot: first }),
    ).resolves.toMatchObject({
      snapshot_id: SNAPSHOT_ID,
    });
    expect(prisma.metricSnapshot.create).toHaveBeenCalledTimes(1);

    prisma.metricSnapshot.findUnique.mockResolvedValue(
      dbSnapshot(snapshot({ provider_object_id: "different-post" })),
    );
    await expect(
      repository.createMetricSnapshot({ snapshot: first }),
    ).rejects.toMatchObject({
      code: "PERFORMANCE_SNAPSHOT_CONFLICT",
    });
  });

  it("keeps reads business-scoped, including a missing cross-business snapshot", async () => {
    const prisma = makePrisma();
    prisma.metricSnapshot.findMany.mockResolvedValue([]);
    prisma.metricSnapshot.findFirst.mockResolvedValue(null);
    const repository = new PerformanceRepository(prisma as PrismaService);

    await expect(repository.listSnapshots(OTHER_BUSINESS_ID)).resolves.toEqual(
      [],
    );
    await expect(
      repository.getSnapshot(OTHER_BUSINESS_ID, SNAPSHOT_ID),
    ).resolves.toBeNull();
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledWith({
      where: { businessId: OTHER_BUSINESS_ID },
      orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    });
    expect(prisma.metricSnapshot.findFirst).toHaveBeenCalledWith({
      where: { id: SNAPSHOT_ID, businessId: OTHER_BUSINESS_ID },
    });
  });
});

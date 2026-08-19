import { PrismaService } from "../../../common/persistence/prisma.service";
import { PerformanceRepository } from "./performance.repository";

const BUSINESS_ID = "a1000000-0000-4000-8000-000000000002";
const RESULT_ID = "a1000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "a1000000-0000-4000-8000-000000000004";
const INTENT_ID = "a1000000-0000-4000-8000-000000000005";
const CANDIDATE_ID = "a1000000-0000-4000-8000-000000000006";
const PUBLISHED_AT = new Date("2026-08-18T08:00:00.000Z");

function chain() {
  return {
    id: RESULT_ID,
    intentId: INTENT_ID,
    outcome: "PUBLISHED",
    provider: "meta",
    remotePublicationId: "page-123_post-456",
    occurredAt: PUBLISHED_AT,
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
          candidateChecksum: "checksum",
          channel: "facebook",
        },
        target: null,
      },
    },
  };
}

function dbWindow(window: string, overrides: Record<string, unknown> = {}) {
  const hours = window === "24h" ? 24 : window === "72h" ? 72 : 168;
  return {
    id: `a2000000-0000-4000-8000-00000000000${window === "24h" ? 1 : window === "72h" ? 2 : 3}`,
    businessId: BUSINESS_ID,
    publishingResultId: RESULT_ID,
    provider: "facebook",
    window,
    dueAt: new Date(PUBLISHED_AT.getTime() + hours * 60 * 60 * 1000),
    state: "queued",
    attemptCount: 0,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: PUBLISHED_AT,
    updatedAt: PUBLISHED_AT,
    ...overrides,
  };
}

function makePrisma() {
  const prisma = {
    publishingResult: {
      findUnique: jest.fn().mockResolvedValue(chain()),
      findMany: jest.fn(),
    },
    business: { findUnique: jest.fn() },
    performanceSyncWindow: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    metricSnapshot: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  prisma.$transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) => callback(prisma),
  );
  return prisma;
}

describe("PerformanceRepository recovery state machine", () => {
  it("creates exactly the 24h, 72h, and 7d publication-age windows", async () => {
    const prisma = makePrisma();
    prisma.performanceSyncWindow.create.mockImplementation(({ data }: any) =>
      dbWindow(data.window),
    );
    const repository = new PerformanceRepository(prisma as PrismaService);

    const windows = await repository.ensureSyncWindowsForResult(
      RESULT_ID,
      BUSINESS_ID,
    );

    expect(windows.map((window) => window.window)).toEqual([
      "24h",
      "72h",
      "7d",
    ]);
    expect(prisma.performanceSyncWindow.create).toHaveBeenCalledTimes(3);
    expect(
      prisma.performanceSyncWindow.create.mock.calls.map(
        ([call]: [{ data: { window: string; dueAt: Date } }]) => [
          call.data.window,
          call.data.dueAt.toISOString(),
        ],
      ),
    ).toEqual([
      ["24h", "2026-08-19T08:00:00.000Z"],
      ["72h", "2026-08-21T08:00:00.000Z"],
      ["7d", "2026-08-25T08:00:00.000Z"],
    ]);
  });

  it("rejects a due time that is not derived from the immutable publication time", async () => {
    const prisma = makePrisma();
    const repository = new PerformanceRepository(prisma as PrismaService);

    await expect(
      repository.createSyncWindow({
        businessId: BUSINESS_ID,
        publishingResultId: RESULT_ID,
        window: "24h",
        dueAt: new Date("2026-08-19T08:00:01.000Z"),
      }),
    ).rejects.toMatchObject({ code: "PERFORMANCE_INVALID_PROVIDER_DATA" });
    expect(prisma.performanceSyncWindow.create).not.toHaveBeenCalled();
  });

  it("lets only one concurrent scanner claim a due lease", async () => {
    const prisma = makePrisma();
    const leased = dbWindow("24h", {
      state: "leased",
      attemptCount: 1,
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date("2026-08-18T08:05:00.000Z"),
    });
    prisma.performanceSyncWindow.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.performanceSyncWindow.findUnique.mockResolvedValue(leased);
    const repository = new PerformanceRepository(prisma as PrismaService);
    const now = new Date("2026-08-18T08:00:00.000Z");

    await expect(
      repository.claimSyncWindow(leased.id, "worker-1", now, 300_000),
    ).resolves.toMatchObject({ lease_owner: "worker-1", state: "leased" });
    await expect(
      repository.claimSyncWindow(leased.id, "worker-2", now, 300_000),
    ).resolves.toBeNull();
    expect(prisma.performanceSyncWindow.updateMany).toHaveBeenNthCalledWith(1, {
      where: expect.objectContaining({
        id: leased.id,
        state: { in: ["queued", "retryable"] },
      }),
      data: expect.objectContaining({
        state: "leased",
        attemptCount: { increment: 1 },
        leaseOwner: "worker-1",
      }),
    });
  });

  it("turns an expired lease back into durable retryable work", async () => {
    const prisma = makePrisma();
    prisma.performanceSyncWindow.updateMany.mockResolvedValue({ count: 2 });
    const repository = new PerformanceRepository(prisma as PrismaService);
    const now = new Date("2026-08-18T09:00:00.000Z");

    await expect(repository.recoverExpiredLeases(now)).resolves.toBe(2);
    expect(prisma.performanceSyncWindow.updateMany).toHaveBeenCalledWith({
      where: { state: "leased", leaseExpiresAt: { lt: now } },
      data: expect.objectContaining({
        state: "retryable",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
      }),
    });
  });
});

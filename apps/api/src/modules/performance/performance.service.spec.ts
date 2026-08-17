import { HttpStatus, NotFoundException } from "@nestjs/common";
import { PerformanceService } from "./performance.service";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "a1000000-0000-4000-8000-000000000002";
const RESULT_ID = "a1000000-0000-4000-8000-000000000003";

const context = {
  publishingResultId: RESULT_ID,
  businessId: BUSINESS_ID,
  ownerUserId: USER_ID,
  publishingAttemptId: "a1000000-0000-4000-8000-000000000004",
  publicationIntentId: "a1000000-0000-4000-8000-000000000005",
  candidateId: "a1000000-0000-4000-8000-000000000006",
  candidateChecksum: "checksum",
  providerObjectId: "page-1_post-1",
  publishedAt: new Date("2026-08-18T08:00:00Z"),
  target: null,
};

function makeService() {
  const prisma = {
    business: { findFirst: jest.fn().mockResolvedValue({ id: BUSINESS_ID }) },
    publishingTarget: { findFirst: jest.fn().mockResolvedValue(null) },
    socialConnection: { findUnique: jest.fn().mockResolvedValue(null) },
    performanceSyncWindow: { findMany: jest.fn().mockResolvedValue([]) },
    metricSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const repository = {
    buildOverview: jest
      .fn()
      .mockResolvedValue({ contract_version: "performance-v1" }),
    listPostsPage: jest
      .fn()
      .mockResolvedValue({ posts: [], next_cursor: null }),
    getPublicationContext: jest.fn().mockResolvedValue(context),
    listSnapshotsForResult: jest.fn().mockResolvedValue([]),
    ensureSyncWindowsForResult: jest.fn().mockResolvedValue([]),
    requestDueRefresh: jest
      .fn()
      .mockResolvedValue({ updated: 1, rateLimited: false }),
    listSyncWindowsForResult: jest.fn().mockResolvedValue([]),
  };
  const reconciler = { reconcileOnce: jest.fn().mockResolvedValue({}) };
  return {
    service: new PerformanceService(
      prisma as never,
      repository as never,
      reconciler as never,
    ),
    prisma,
    repository,
    reconciler,
  };
}

describe("PerformanceService", () => {
  it("rejects an owner without a business instead of accepting client scope", async () => {
    const { service, prisma } = makeService();
    prisma.business.findFirst.mockResolvedValue(null);

    await expect(service.getOverview(USER_ID)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "PUBLISHING_FORBIDDEN_NO_BUSINESS",
      }),
    });
  });

  it("queues refresh through the reconciler without calling a provider inline", async () => {
    const { service, repository, reconciler } = makeService();

    await expect(service.refresh(USER_ID, RESULT_ID)).resolves.toMatchObject({
      status: "queued",
    });
    expect(repository.ensureSyncWindowsForResult).toHaveBeenCalledWith(
      RESULT_ID,
      BUSINESS_ID,
    );
    expect(reconciler.reconcileOnce).toHaveBeenCalledTimes(1);
  });

  it("returns not_due and skips queue work when no window is eligible", async () => {
    const { service, repository, reconciler } = makeService();
    repository.requestDueRefresh.mockResolvedValue({
      updated: 0,
      rateLimited: false,
    });

    await expect(service.refresh(USER_ID, RESULT_ID)).resolves.toMatchObject({
      status: "not_due",
    });
    expect(reconciler.reconcileOnce).not.toHaveBeenCalled();
  });

  it("maps repeated refreshes to an explicit 429 without exposing provider details", async () => {
    const { service, repository } = makeService();
    repository.requestDueRefresh.mockResolvedValue({
      updated: 0,
      rateLimited: true,
    });

    await expect(service.refresh(USER_ID, RESULT_ID)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: {
        code: "PERFORMANCE_PROVIDER_RATE_LIMITED",
        message: "Performance refresh was requested too recently",
      },
    });
  });

  it("rejects a result outside the owner business scope", async () => {
    const { service, repository } = makeService();
    repository.getPublicationContext.mockResolvedValue(null);

    await expect(
      service.listSnapshots(USER_ID, RESULT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.listSnapshotsForResult).not.toHaveBeenCalled();
  });

  it("rejects a format outside the supported Facebook post projections", async () => {
    const { service, repository } = makeService();

    await expect(
      service.listPosts(USER_ID, { format: "video" }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "PERFORMANCE_INVALID_PROVIDER_DATA",
      }),
    });
    expect(repository.listPostsPage).not.toHaveBeenCalled();
  });
});

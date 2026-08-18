import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type MetricSnapshot,
  type PerformanceSyncWindow,
} from "@prisma/client";
import {
  PERFORMANCE_PROVIDER,
  PERFORMANCE_WINDOWS,
  assertValidPerformanceSnapshot,
  assertValidPerformanceSyncWindow,
  type MetricSnapshotV1,
  type PerformanceCapabilityV1,
  type PerformanceErrorCode,
  type PerformanceOverviewV1,
  type PerformancePostProjectionV1,
  type PerformanceSnapshotProjectionV1,
  type PerformanceSyncWindowV1,
  type PerformanceWindow,
} from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";

export class PerformanceRepositoryError extends Error {
  constructor(
    readonly code: PerformanceErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "PerformanceRepositoryError";
  }
}

export type CreatePerformanceSyncWindowInput = {
  readonly businessId: string;
  readonly publishingResultId: string;
  readonly window: PerformanceWindow;
  readonly dueAt: Date;
};

export type PersistMetricSnapshotInput = {
  readonly snapshot: unknown;
};

export type PerformancePublicationContext = {
  readonly publishingResultId: string;
  readonly businessId: string;
  readonly ownerUserId: string;
  readonly publishingAttemptId: string;
  readonly publicationIntentId: string;
  readonly candidateId: string;
  readonly candidateChecksum: string;
  readonly providerObjectId: string;
  readonly publishedAt: Date;
  readonly target: {
    readonly externalAccountId: string;
    readonly credentialRef: string;
    readonly connectionState: string;
    readonly expiresAt: Date | null;
  } | null;
};

export type ClaimedPerformanceWindow = PerformanceSyncWindowV1 & {
  readonly lease_owner: string;
};

export type PerformancePostsPage = {
  readonly contract_version: "performance-v1";
  readonly business_id: string;
  readonly provider: "facebook";
  readonly generated_at: string;
  readonly posts: readonly PerformancePostProjectionV1[];
  readonly next_cursor: string | null;
};

type PrismaContext = PrismaService | Prisma.TransactionClient;

type PublishingResultChain = Prisma.PublishingResultGetPayload<{
  include: {
    attempt: {
      include: {
        intent: {
          include: { candidate: true; target: true };
        };
      };
    };
  };
}>;
type EligibleResultChain = PublishingResultChain & {
  readonly remotePublicationId: string;
};

const RESULT_CHAIN_INCLUDE = {
  attempt: {
    include: {
      intent: {
        include: { candidate: true, target: true },
      },
    },
  },
} satisfies Prisma.PublishingResultInclude;

const PERFORMANCE_WINDOW_HOURS: Record<PerformanceWindow, number> = {
  "24h": 24,
  "72h": 72,
  "7d": 24 * 7,
};

const PERFORMANCE_SYNC_STATES = ["queued", "retryable"] as const;

/**
 * Persistence boundary for Performance 1.
 *
 * This class owns no provider calls and exposes no browser-facing API. It
 * revalidates the immutable publishing chain on every write, keeps all reads
 * business-scoped, and only ever inserts metric snapshots.
 */
@Injectable()
export class PerformanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSyncWindow(
    input: CreatePerformanceSyncWindowInput,
  ): Promise<PerformanceSyncWindowV1> {
    const chain = await this.loadEligibleResult(
      input.publishingResultId,
      input.businessId,
    );
    this.assertWindow(input.window);
    const expectedDueAt = new Date(
      chain.occurredAt.getTime() +
        PERFORMANCE_WINDOW_HOURS[input.window] * 60 * 60 * 1000,
    );
    if (expectedDueAt.getTime() !== input.dueAt.getTime()) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_INVALID_PROVIDER_DATA",
        "performance sync window due_at must match the publication age",
      );
    }

    try {
      const row = await this.prisma.performanceSyncWindow.create({
        data: {
          businessId: input.businessId,
          publishingResultId: input.publishingResultId,
          provider: PERFORMANCE_PROVIDER,
          window: input.window,
          dueAt: input.dueAt,
        },
      });
      return toSyncWindowContract(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.performanceSyncWindow.findUnique({
        where: {
          publishingResultId_window: {
            publishingResultId: input.publishingResultId,
            window: input.window,
          },
        },
      });
      if (
        existing &&
        existing.businessId === input.businessId &&
        existing.provider === PERFORMANCE_PROVIDER &&
        existing.dueAt.getTime() === input.dueAt.getTime()
      ) {
        return toSyncWindowContract(existing);
      }
      throw new PerformanceRepositoryError(
        "PERFORMANCE_SYNC_WINDOW_CONFLICT",
        "performance sync window already exists with different provenance",
      );
    }
  }

  /**
   * Reconciles the three durable observation windows for an eligible result.
   * Each insert is idempotent and verifies the existing row's immutable
   * provenance when another reconciler won the unique race.
   */
  async ensureSyncWindowsForResult(
    publishingResultId: string,
    businessId?: string,
  ): Promise<PerformanceSyncWindowV1[]> {
    const chain = await this.loadEligibleResult(
      publishingResultId,
      businessId ??
        (
          await this.prisma.publishingResult.findUnique({
            where: { id: publishingResultId },
            select: {
              attempt: { select: { intent: { select: { businessId: true } } } },
            },
          })
        )?.attempt.intent.businessId ??
        "",
    );
    const windows: PerformanceSyncWindowV1[] = [];
    for (const window of PERFORMANCE_WINDOWS) {
      windows.push(
        await this.createSyncWindow({
          businessId: chain.attempt.intent.businessId,
          publishingResultId,
          window,
          dueAt: new Date(
            chain.occurredAt.getTime() +
              PERFORMANCE_WINDOW_HOURS[window] * 60 * 60 * 1000,
          ),
        }),
      );
    }
    return windows;
  }

  /** Finds recently published Facebook results so PostgreSQL can rebuild
   * missing windows after a queue or process outage. */
  async listEligiblePublicationIds(limit = 100): Promise<readonly string[]> {
    const rows = await this.prisma.publishingResult.findMany({
      where: {
        outcome: "PUBLISHED",
        provider: "meta",
        remotePublicationId: { not: null },
        // Completed rows must leave the bounded discovery set. Without this
        // missing-window filter the oldest `limit` publications are selected
        // forever and newer posts never receive their 24h/72h/7d windows.
        OR: PERFORMANCE_WINDOWS.map((window) => ({
          performanceSyncWindows: { none: { window } },
        })),
        attempt: {
          intent: {
            mode: "REAL",
            candidate: { channel: "facebook" },
          },
        },
      },
      orderBy: { occurredAt: "asc" },
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listEligiblePostSeeds(businessId: string): Promise<
    readonly {
      readonly publishingResultId: string;
      readonly candidateId: string;
      readonly publishedAt: Date;
      readonly providerObjectId: string;
    }[]
  > {
    const rows = await this.prisma.publishingResult.findMany({
      where: {
        outcome: "PUBLISHED",
        provider: "meta",
        remotePublicationId: { not: null },
        attempt: {
          intent: {
            businessId,
            mode: "REAL",
            candidate: { businessId, channel: "facebook" },
          },
        },
      },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        occurredAt: true,
        remotePublicationId: true,
        attempt: { select: { intent: { select: { candidateId: true } } } },
      },
    });
    return rows.flatMap((row) =>
      row.remotePublicationId
        ? [
            {
              publishingResultId: row.id,
              candidateId: row.attempt.intent.candidateId,
              publishedAt: row.occurredAt,
              providerObjectId: row.remotePublicationId,
            },
          ]
        : [],
    );
  }

  async getSyncWindowById(
    syncWindowId: string,
  ): Promise<PerformanceSyncWindowV1 | null> {
    const row = await this.prisma.performanceSyncWindow.findUnique({
      where: { id: syncWindowId },
    });
    return row ? toSyncWindowContract(row) : null;
  }

  async getSyncWindowForResult(
    businessId: string,
    publishingResultId: string,
    window: PerformanceWindow,
  ): Promise<PerformanceSyncWindowV1 | null> {
    const row = await this.prisma.performanceSyncWindow.findFirst({
      where: { businessId, publishingResultId, window },
    });
    return row ? toSyncWindowContract(row) : null;
  }

  async listSyncWindowsForResult(
    businessId: string,
    publishingResultId: string,
  ): Promise<PerformanceSyncWindowV1[]> {
    const rows = await this.prisma.performanceSyncWindow.findMany({
      where: { businessId, publishingResultId },
      orderBy: { dueAt: "asc" },
    });
    return rows.map(toSyncWindowContract);
  }

  async recoverExpiredLeases(now: Date): Promise<number> {
    const result = await this.prisma.performanceSyncWindow.updateMany({
      where: {
        state: "leased",
        leaseExpiresAt: { lt: now },
      },
      data: {
        state: "retryable",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: now,
        lastErrorCode: "PERFORMANCE_PROVIDER_UNAVAILABLE",
      },
    });
    return result.count;
  }

  async listDueSyncWindowIds(
    now: Date,
    limit = 25,
  ): Promise<readonly string[]> {
    const rows = await this.prisma.performanceSyncWindow.findMany({
      where: {
        dueAt: { lte: now },
        OR: [
          { state: "queued" },
          {
            state: "retryable",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        ],
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Atomically claims one due row. A concurrent scanner receives null. */
  async claimSyncWindow(
    syncWindowId: string,
    owner: string,
    now: Date,
    leaseDurationMs: number,
  ): Promise<ClaimedPerformanceWindow | null> {
    const updated = await this.prisma.performanceSyncWindow.updateMany({
      where: {
        id: syncWindowId,
        dueAt: { lte: now },
        state: { in: [...PERFORMANCE_SYNC_STATES] },
        OR: [
          { state: "queued" },
          {
            state: "retryable",
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
        ],
      },
      data: {
        state: "leased",
        attemptCount: { increment: 1 },
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        nextAttemptAt: null,
      },
    });
    if (updated.count !== 1) return null;
    const claimed = await this.getSyncWindowById(syncWindowId);
    return claimed &&
      claimed.state === "leased" &&
      claimed.lease_owner === owner
      ? claimed
      : null;
  }

  async releaseSyncWindowAfterEnqueueFailure(
    syncWindowId: string,
    owner: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.prisma.performanceSyncWindow.updateMany({
      where: { id: syncWindowId, state: "leased", leaseOwner: owner },
      data: {
        state: "retryable",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt,
        lastErrorCode: "PERFORMANCE_PROVIDER_UNAVAILABLE",
      },
    });
  }

  async markSyncWindowRetryable(input: {
    readonly syncWindowId: string;
    readonly owner: string;
    readonly errorCode: PerformanceErrorCode;
    readonly nextAttemptAt: Date;
  }): Promise<boolean> {
    const result = await this.prisma.performanceSyncWindow.updateMany({
      where: {
        id: input.syncWindowId,
        state: "leased",
        leaseOwner: input.owner,
      },
      data: {
        state: "retryable",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
      },
    });
    return result.count === 1;
  }

  async markSyncWindowTerminal(input: {
    readonly syncWindowId: string;
    readonly owner: string;
    readonly errorCode: PerformanceErrorCode;
  }): Promise<boolean> {
    const result = await this.prisma.performanceSyncWindow.updateMany({
      where: {
        id: input.syncWindowId,
        state: "leased",
        leaseOwner: input.owner,
      },
      data: {
        state: "terminal",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: input.errorCode,
      },
    });
    return result.count === 1;
  }

  async markSyncWindowSucceeded(
    syncWindowId: string,
    owner: string,
  ): Promise<boolean> {
    const result = await this.prisma.performanceSyncWindow.updateMany({
      where: { id: syncWindowId, state: "leased", leaseOwner: owner },
      data: {
        state: "succeeded",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
      },
    });
    return result.count === 1;
  }

  async requestDueRefresh(input: {
    readonly businessId: string;
    readonly publishingResultId: string;
    readonly now: Date;
    readonly cooldownMs: number;
  }): Promise<{ readonly updated: number; readonly rateLimited: boolean }> {
    const windows = await this.prisma.performanceSyncWindow.findMany({
      where: {
        businessId: input.businessId,
        publishingResultId: input.publishingResultId,
      },
    });
    const due = windows.filter(
      (window) =>
        (window.state === "queued" || window.state === "retryable") &&
        window.dueAt.getTime() <= input.now.getTime(),
    );
    if (due.length === 0) return { updated: 0, rateLimited: false };
    const cutoff = new Date(input.now.getTime() - input.cooldownMs);
    const updated = await this.prisma.performanceSyncWindow.updateMany({
      where: {
        id: { in: due.map((window) => window.id) },
        state: { in: ["queued", "retryable"] },
        OR: [{ attemptCount: 0 }, { updatedAt: { lte: cutoff } }],
      },
      data: { nextAttemptAt: input.now },
    });
    return { updated: updated.count, rateLimited: updated.count === 0 };
  }

  async getPublicationContext(
    publishingResultId: string,
    businessId?: string,
  ): Promise<PerformancePublicationContext | null> {
    const row = await this.prisma.publishingResult.findUnique({
      where: { id: publishingResultId },
      include: RESULT_CHAIN_INCLUDE,
    });
    if (!row || (businessId && row.attempt.intent.businessId !== businessId)) {
      return null;
    }
    if (
      row.outcome !== "PUBLISHED" ||
      row.provider !== "meta" ||
      !row.remotePublicationId ||
      row.attempt.intent.mode !== "REAL" ||
      row.attempt.intent.candidate.channel !== "facebook" ||
      row.attempt.intent.businessId !== row.attempt.intent.candidate.businessId
    ) {
      return null;
    }
    const target = row.attempt.intent.target;
    if (
      target &&
      (target.businessId !== row.attempt.intent.businessId ||
        target.provider !== "META" ||
        target.channel !== "facebook")
    ) {
      return null;
    }
    const business = await this.prisma.business.findUnique({
      where: { id: row.attempt.intent.businessId },
      select: { ownerUserId: true },
    });
    if (!business) return null;
    return {
      publishingResultId: row.id,
      businessId: row.attempt.intent.businessId,
      ownerUserId: business.ownerUserId,
      publishingAttemptId: row.attempt.id,
      publicationIntentId: row.attempt.intent.id,
      candidateId: row.attempt.intent.candidate.id,
      candidateChecksum: row.attempt.intent.candidate.candidateChecksum,
      providerObjectId: row.remotePublicationId,
      publishedAt: row.occurredAt,
      target: row.attempt.intent.target
        ? {
            externalAccountId: row.attempt.intent.target.externalAccountId,
            credentialRef: row.attempt.intent.target.credentialRef,
            connectionState: row.attempt.intent.target.connectionState,
            expiresAt: row.attempt.intent.target.expiresAt,
          }
        : null,
    };
  }

  async getSnapshotForWindow(
    businessId: string,
    publishingResultId: string,
    window: PerformanceWindow,
  ): Promise<MetricSnapshotV1 | null> {
    const row = await this.prisma.metricSnapshot.findUnique({
      where: { publishingResultId_window: { publishingResultId, window } },
    });
    if (!row || row.businessId !== businessId) return null;
    return toSnapshotContract(row);
  }

  async createMetricSnapshot(
    input: PersistMetricSnapshotInput,
  ): Promise<MetricSnapshotV1> {
    const snapshot = this.validatedSnapshot(input.snapshot);
    return this.insertMetricSnapshot(this.prisma, snapshot);
  }

  /** Inserts evidence and closes the claimed window in one authoritative
   * transaction. If the worker crashes after insert, a replay sees the
   * immutable row and only completes the same lease on recovery. */
  async completeSyncWindowWithSnapshot(input: {
    readonly syncWindowId: string;
    readonly owner: string;
    readonly snapshot: unknown;
  }): Promise<MetricSnapshotV1> {
    const snapshot = this.validatedSnapshot(input.snapshot);
    return this.prisma.$transaction(async (tx) => {
      const window = await tx.performanceSyncWindow.findUnique({
        where: { id: input.syncWindowId },
      });
      if (
        !window ||
        window.state !== "leased" ||
        window.leaseOwner !== input.owner
      ) {
        throw new PerformanceRepositoryError(
          "PERFORMANCE_SYNC_TERMINAL",
          "performance sync lease is no longer owned",
        );
      }
      if (
        window.publishingResultId !== snapshot.publishing_result_id ||
        window.window !== snapshot.window
      ) {
        throw new PerformanceRepositoryError(
          "PERFORMANCE_INVALID_PROVIDER_DATA",
          "metric snapshot does not belong to the claimed window",
        );
      }
      const persisted = await this.insertMetricSnapshot(tx, snapshot);
      const updated = await tx.performanceSyncWindow.updateMany({
        where: {
          id: input.syncWindowId,
          state: "leased",
          leaseOwner: input.owner,
        },
        data: {
          state: "succeeded",
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastErrorCode: null,
        },
      });
      if (updated.count !== 1) {
        throw new PerformanceRepositoryError(
          "PERFORMANCE_SYNC_TERMINAL",
          "performance sync lease was lost before completion",
        );
      }
      return persisted;
    });
  }

  async listSnapshots(
    businessId: string,
    window?: PerformanceWindow,
  ): Promise<MetricSnapshotV1[]> {
    const rows = await this.prisma.metricSnapshot.findMany({
      where: { businessId, ...(window ? { window } : {}) },
      orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
    });
    return rows.map(toSnapshotContract);
  }

  async getSnapshot(
    businessId: string,
    snapshotId: string,
  ): Promise<MetricSnapshotV1 | null> {
    const row = await this.prisma.metricSnapshot.findFirst({
      where: { id: snapshotId, businessId },
    });
    return row ? toSnapshotContract(row) : null;
  }

  async listSyncWindows(
    businessId: string,
    state?: string,
  ): Promise<PerformanceSyncWindowV1[]> {
    const rows = await this.prisma.performanceSyncWindow.findMany({
      where: { businessId, ...(state ? { state } : {}) },
      orderBy: { dueAt: "asc" },
    });
    return rows.map(toSyncWindowContract);
  }

  async listSnapshotsForResult(
    businessId: string,
    publishingResultId: string,
  ): Promise<MetricSnapshotV1[]> {
    const result = await this.prisma.publishingResult.findFirst({
      where: { id: publishingResultId, attempt: { intent: { businessId } } },
      select: { id: true },
    });
    if (!result) return [];
    const rows = await this.prisma.metricSnapshot.findMany({
      where: { businessId, publishingResultId },
      orderBy: { dueAt: "asc" },
    });
    return rows.map(toSnapshotContract);
  }

  async buildOverview(
    businessId: string,
    capability?: PerformanceCapabilityV1,
  ): Promise<PerformanceOverviewV1> {
    const [seeds, rows, windows, allWindows] = await Promise.all([
      this.listEligiblePostSeeds(businessId),
      this.prisma.metricSnapshot.findMany({
        where: { businessId },
        orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
      }),
      this.prisma.performanceSyncWindow.findMany({
        where: { businessId },
        select: { state: true, lastErrorCode: true },
      }),
      this.prisma.performanceSyncWindow.findMany({
        where: { businessId },
        orderBy: { dueAt: "asc" },
      }),
    ]);
    const grouped = new Map<string, PerformancePostProjectionV1>();
    for (const seed of seeds) {
      grouped.set(seed.publishingResultId, {
        contract_version: "performance-v1",
        business_id: businessId,
        candidate_id: seed.candidateId,
        publishing_result_id: seed.publishingResultId,
        provider: "facebook",
        provider_object_id: seed.providerObjectId,
        published_at: seed.publishedAt.toISOString(),
        snapshots: [],
      });
    }
    for (const row of rows) {
      const snapshot = toSnapshotProjection(toSnapshotContract(row));
      const existing = grouped.get(row.publishingResultId);
      if (existing) {
        grouped.set(row.publishingResultId, {
          ...existing,
          snapshots: [...existing.snapshots, snapshot],
        });
      } else {
        grouped.set(row.publishingResultId, {
          contract_version: "performance-v1",
          business_id: row.businessId,
          candidate_id: row.candidateId,
          publishing_result_id: row.publishingResultId,
          provider: "facebook",
          provider_object_id: row.providerObjectId,
          published_at: row.publishedAt.toISOString(),
          snapshots: [snapshot],
        });
      }
    }
    const windowsByResult = new Map<string, PerformanceSyncWindowV1[]>();
    for (const row of allWindows) {
      const entries = windowsByResult.get(row.publishingResultId) ?? [];
      entries.push(toSyncWindowContract(row));
      windowsByResult.set(row.publishingResultId, entries);
    }
    const posts = [...grouped.values()].map((post) => ({
      ...post,
      sync_windows: windowsByResult.get(post.publishing_result_id) ?? [],
    }));
    const observedSnapshotCount = rows.filter(
      (row) => row.window === "7d",
    ).length;
    const hasProviderFailure = windows.some(
      (window) =>
        window.state === "terminal" &&
        [
          "PERFORMANCE_PROVIDER_UNAVAILABLE",
          "PERFORMANCE_PROVIDER_RATE_LIMITED",
          "PERFORMANCE_PERMISSION_REQUIRED",
        ].includes(window.lastErrorCode ?? ""),
    );
    const baseline = {
      status:
        observedSnapshotCount >= 3
          ? ("ready" as const)
          : ("not_ready" as const),
      observed_snapshot_count: observedSnapshotCount,
      required_snapshot_count: 3,
      reason:
        observedSnapshotCount >= 3
          ? null
          : posts.length === 0
            ? ("no_published_posts" as const)
            : hasProviderFailure
              ? ("provider_unavailable" as const)
              : ("insufficient_snapshots" as const),
    };
    const overview: PerformanceOverviewV1 = {
      contract_version: "performance-v1",
      business_id: businessId,
      provider: "facebook",
      generated_at: new Date().toISOString(),
      posts,
      baseline,
      ...(capability ? { capability } : {}),
    };
    return overview;
  }

  async listPostsPage(input: {
    readonly businessId: string;
    readonly format?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<PerformancePostsPage> {
    const [seeds, rows, allWindows] = await Promise.all([
      this.listEligiblePostSeeds(input.businessId),
      this.prisma.metricSnapshot.findMany({
        where: { businessId: input.businessId },
        orderBy: [
          { publishedAt: "desc" },
          { publishingResultId: "desc" },
          { fetchedAt: "desc" },
        ],
      }),
      this.prisma.performanceSyncWindow.findMany({
        where: { businessId: input.businessId },
        orderBy: { dueAt: "asc" },
      }),
    ]);
    const grouped = new Map<string, PerformancePostProjectionV1>();
    for (const seed of seeds) {
      grouped.set(seed.publishingResultId, {
        contract_version: "performance-v1",
        business_id: input.businessId,
        candidate_id: seed.candidateId,
        publishing_result_id: seed.publishingResultId,
        provider: "facebook",
        provider_object_id: seed.providerObjectId,
        published_at: seed.publishedAt.toISOString(),
        snapshots: [],
      });
    }
    for (const row of rows) {
      const snapshot = toSnapshotProjection(toSnapshotContract(row));
      const existing = grouped.get(row.publishingResultId);
      if (existing) {
        grouped.set(row.publishingResultId, {
          ...existing,
          snapshots: [...existing.snapshots, snapshot],
        });
      } else {
        grouped.set(row.publishingResultId, {
          contract_version: "performance-v1",
          business_id: row.businessId,
          candidate_id: row.candidateId,
          publishing_result_id: row.publishingResultId,
          provider: "facebook",
          provider_object_id: row.providerObjectId,
          published_at: row.publishedAt.toISOString(),
          snapshots: [snapshot],
        });
      }
    }
    const windowsByResult = new Map<string, PerformanceSyncWindowV1[]>();
    for (const row of allWindows) {
      const entries = windowsByResult.get(row.publishingResultId) ?? [];
      entries.push(toSyncWindowContract(row));
      windowsByResult.set(row.publishingResultId, entries);
    }
    let posts = [...grouped.values()].map((post) => ({
      ...post,
      sync_windows: windowsByResult.get(post.publishing_result_id) ?? [],
    }));
    if (input.format) {
      const candidateRows = await this.prisma.publishingCandidate.findMany({
        where: { businessId: input.businessId, format: input.format },
        select: { id: true },
      });
      const candidateIds = new Set(
        candidateRows.map((candidate) => candidate.id),
      );
      posts = posts.filter((post) => candidateIds.has(post.candidate_id));
    }
    const start = input.cursor ? decodeCursor(input.cursor) : 0;
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const page = posts.slice(start, start + limit);
    const nextCursor =
      start + limit < posts.length ? encodeCursor(start + limit) : null;
    return {
      contract_version: "performance-v1",
      business_id: input.businessId,
      provider: "facebook",
      generated_at: new Date().toISOString(),
      posts: page,
      next_cursor: nextCursor,
    };
  }

  private validatedSnapshot(value: unknown): MetricSnapshotV1 {
    const validation = validateSnapshot(value);
    if (!validation.valid) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_INVALID_PROVIDER_DATA",
        "message" in validation
          ? validation.message
          : "invalid performance snapshot",
      );
    }
    return validation.value;
  }

  private async insertMetricSnapshot(
    client: PrismaContext,
    snapshot: MetricSnapshotV1,
  ): Promise<MetricSnapshotV1> {
    const chain = await this.loadEligibleResult(
      snapshot.publishing_result_id,
      snapshot.business_id,
      client,
    );
    this.assertSnapshotProvenance(snapshot, chain);
    const window = await client.performanceSyncWindow.findUnique({
      where: {
        publishingResultId_window: {
          publishingResultId: snapshot.publishing_result_id,
          window: snapshot.window,
        },
      },
    });
    if (!window || window.businessId !== snapshot.business_id) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_NOT_ELIGIBLE",
        "metric snapshot requires an owned sync window",
      );
    }
    if (window.dueAt.getTime() !== new Date(snapshot.due_at).getTime()) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_INVALID_PROVIDER_DATA",
        "metric snapshot due_at must match its sync window",
      );
    }
    // `createMany(skipDuplicates)` is deliberate here. Catching P2002 and then
    // reading again is unsafe inside an interactive PostgreSQL transaction:
    // the unique violation aborts that transaction, so the replay read fails
    // with 25P02. A skipped duplicate keeps the transaction usable and lets us
    // compare the immutable evidence before completing the claimed window.
    await client.metricSnapshot.createMany({
      data: [
        {
          id: snapshot.snapshot_id,
          businessId: snapshot.business_id,
          publishingResultId: snapshot.publishing_result_id,
          publishingAttemptId: snapshot.publishing_attempt_id,
          publishingIntentId: snapshot.publication_intent_id,
          candidateId: snapshot.candidate_id,
          candidateChecksum: snapshot.candidate_checksum,
          provider: snapshot.provider,
          providerObjectId: chain.remotePublicationId,
          window: snapshot.window,
          publishedAt: new Date(snapshot.published_at),
          dueAt: new Date(snapshot.due_at),
          observedAt: snapshot.observed_at
            ? new Date(snapshot.observed_at)
            : null,
          fetchedAt: new Date(snapshot.fetched_at),
          graphVersion: snapshot.graph_version,
          metricSchemaVersion: snapshot.metric_schema_version,
          metrics: snapshot.metrics as Prisma.InputJsonValue,
          providerMetadata: snapshot.provider_metadata as Prisma.InputJsonValue,
          createdAt: new Date(snapshot.created_at),
        },
      ],
      skipDuplicates: true,
    });
    const existing = await client.metricSnapshot.findUnique({
      where: {
        publishingResultId_window: {
          publishingResultId: snapshot.publishing_result_id,
          window: snapshot.window,
        },
      },
    });
    if (existing && snapshotsEqual(toSnapshotContract(existing), snapshot)) {
      return toSnapshotContract(existing);
    }
    throw new PerformanceRepositoryError(
      "PERFORMANCE_SNAPSHOT_CONFLICT",
      "metric snapshot replay conflicts with immutable evidence",
    );
  }

  private async loadEligibleResult(
    publishingResultId: string,
    businessId: string,
    client: PrismaContext = this.prisma,
  ): Promise<EligibleResultChain> {
    const chain = await client.publishingResult.findUnique({
      where: { id: publishingResultId },
      include: RESULT_CHAIN_INCLUDE,
    });
    if (!chain) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_NOT_ELIGIBLE",
        "publishing result was not found",
      );
    }
    if (
      chain.outcome !== "PUBLISHED" ||
      chain.provider !== "meta" ||
      !chain.remotePublicationId ||
      chain.attempt.intent.mode !== "REAL" ||
      chain.attempt.intent.businessId !== businessId ||
      chain.attempt.intent.candidate.businessId !== businessId ||
      chain.attempt.intent.candidate.channel !== "facebook" ||
      chain.intentId !== chain.attempt.intentId ||
      (chain.attempt.intent.target &&
        (chain.attempt.intent.target.businessId !== businessId ||
          chain.attempt.intent.target.provider !== "META" ||
          chain.attempt.intent.target.channel !== "facebook"))
    ) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_NOT_ELIGIBLE",
        "only a real, published Facebook result is performance-eligible",
      );
    }
    return chain as EligibleResultChain;
  }

  private assertSnapshotProvenance(
    snapshot: MetricSnapshotV1,
    chain: EligibleResultChain,
  ): void {
    const { attempt } = chain;
    const { intent } = attempt;
    const { candidate } = intent;
    const identityMatches =
      chain.id === snapshot.publishing_result_id &&
      attempt.id === snapshot.publishing_attempt_id &&
      intent.id === snapshot.publication_intent_id &&
      candidate.id === snapshot.candidate_id &&
      candidate.candidateChecksum === snapshot.candidate_checksum &&
      chain.remotePublicationId === snapshot.provider_object_id &&
      chain.occurredAt.getTime() === new Date(snapshot.published_at).getTime();
    if (!identityMatches) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_INVALID_PROVIDER_DATA",
        "snapshot provenance does not match the frozen publishing chain",
      );
    }
  }

  private assertWindow(window: PerformanceWindow): void {
    if (window !== "24h" && window !== "72h" && window !== "7d") {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_INVALID_PROVIDER_DATA",
        "unsupported performance window",
      );
    }
  }
}

function toSnapshotProjection(
  snapshot: MetricSnapshotV1,
): PerformanceSnapshotProjectionV1 {
  return {
    contract_version: "performance-v1",
    snapshot_id: snapshot.snapshot_id,
    business_id: snapshot.business_id,
    publishing_result_id: snapshot.publishing_result_id,
    provider: snapshot.provider,
    provider_object_id: snapshot.provider_object_id,
    window: snapshot.window,
    published_at: snapshot.published_at,
    observed_at: snapshot.observed_at,
    fetched_at: snapshot.fetched_at,
    metrics: snapshot.metrics,
  };
}

function encodeCursor(index: number): string {
  return Buffer.from(JSON.stringify({ index }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      index?: unknown;
    };
    if (
      typeof parsed.index !== "number" ||
      !Number.isInteger(parsed.index) ||
      parsed.index < 0
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.index;
  } catch {
    throw new PerformanceRepositoryError(
      "PERFORMANCE_INVALID_PROVIDER_DATA",
      "performance cursor is invalid",
    );
  }
}

function validateSnapshot(
  snapshot: unknown,
):
  | { valid: true; value: MetricSnapshotV1 }
  | { valid: false; message: string } {
  try {
    assertValidPerformanceSnapshot(snapshot);
    return { valid: true, value: snapshot };
  } catch (error) {
    return {
      valid: false,
      message:
        error instanceof Error ? error.message : "invalid performance snapshot",
    };
  }
}

function toSyncWindowContract(
  row: PerformanceSyncWindow,
): PerformanceSyncWindowV1 {
  const value: PerformanceSyncWindowV1 = {
    contract_version: "performance-v1",
    sync_window_id: row.id,
    business_id: row.businessId,
    publishing_result_id: row.publishingResultId,
    provider: "facebook",
    window: row.window as PerformanceWindow,
    due_at: row.dueAt.toISOString(),
    state: row.state as PerformanceSyncWindowV1["state"],
    attempt_count: row.attemptCount,
    next_attempt_at: row.nextAttemptAt?.toISOString() ?? null,
    lease_owner: row.leaseOwner,
    lease_expires_at: row.leaseExpiresAt?.toISOString() ?? null,
    last_error_code:
      row.lastErrorCode as PerformanceSyncWindowV1["last_error_code"],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
  assertValidPerformanceSyncWindow(value);
  return value;
}

function toSnapshotContract(row: MetricSnapshot): MetricSnapshotV1 {
  const value: MetricSnapshotV1 = {
    contract_version: "performance-v1",
    snapshot_id: row.id,
    business_id: row.businessId,
    publishing_result_id: row.publishingResultId,
    publishing_attempt_id: row.publishingAttemptId,
    publication_intent_id: row.publishingIntentId,
    candidate_id: row.candidateId,
    candidate_checksum: row.candidateChecksum,
    provider: "facebook",
    provider_object_id: row.providerObjectId,
    window: row.window as PerformanceWindow,
    published_at: row.publishedAt.toISOString(),
    due_at: row.dueAt.toISOString(),
    observed_at: row.observedAt?.toISOString() ?? null,
    fetched_at: row.fetchedAt.toISOString(),
    graph_version: row.graphVersion,
    metric_schema_version: "facebook-insights-v1",
    metrics: row.metrics as MetricSnapshotV1["metrics"],
    provider_metadata:
      row.providerMetadata as unknown as MetricSnapshotV1["provider_metadata"],
    created_at: row.createdAt.toISOString(),
  };
  assertValidPerformanceSnapshot(value);
  return value;
}

function snapshotsEqual(a: MetricSnapshotV1, b: MetricSnapshotV1): boolean {
  const normalize = (value: MetricSnapshotV1) => ({
    ...value,
    published_at: new Date(value.published_at).toISOString(),
    due_at: new Date(value.due_at).toISOString(),
    observed_at: value.observed_at
      ? new Date(value.observed_at).toISOString()
      : null,
    fetched_at: new Date(value.fetched_at).toISOString(),
    created_at: new Date(value.created_at).toISOString(),
  });
  return (
    JSON.stringify(canonicalizeJson(normalize(a))) ===
    JSON.stringify(canonicalizeJson(normalize(b)))
  );
}

/** PostgreSQL jsonb does not preserve caller object-key insertion order. */
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeJson(child)]),
    );
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002";
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);
  return /23505|unique constraint|already exists/i.test(message);
}

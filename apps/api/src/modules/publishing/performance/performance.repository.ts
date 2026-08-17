import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type MetricSnapshot,
  type PerformanceSyncWindow,
} from "@prisma/client";
import {
  PERFORMANCE_PROVIDER,
  assertValidPerformanceSnapshot,
  assertValidPerformanceSyncWindow,
  type MetricSnapshotV1,
  type PerformanceErrorCode,
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

type PublishingResultChain = Prisma.PublishingResultGetPayload<{
  include: {
    attempt: {
      include: {
        intent: {
          include: { candidate: true };
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
        include: { candidate: true },
      },
    },
  },
} satisfies Prisma.PublishingResultInclude;

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
    await this.loadEligibleResult(input.publishingResultId, input.businessId);
    this.assertWindow(input.window);

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

  async createMetricSnapshot(
    input: PersistMetricSnapshotInput,
  ): Promise<MetricSnapshotV1> {
    const validation = validateSnapshot(input.snapshot);
    if (!validation.valid) {
      throw new PerformanceRepositoryError(
        "PERFORMANCE_INVALID_PROVIDER_DATA",
        "message" in validation
          ? validation.message
          : "invalid performance snapshot",
      );
    }
    const snapshot = validation.value;

    const chain = await this.loadEligibleResult(
      snapshot.publishing_result_id,
      snapshot.business_id,
    );
    this.assertSnapshotProvenance(snapshot, chain);

    const window = await this.prisma.performanceSyncWindow.findUnique({
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

    try {
      const row = await this.prisma.metricSnapshot.create({
        data: {
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
      });
      return toSnapshotContract(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.metricSnapshot.findUnique({
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

  private async loadEligibleResult(
    publishingResultId: string,
    businessId: string,
  ): Promise<EligibleResultChain> {
    const chain = await this.prisma.publishingResult.findUnique({
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
      chain.intentId !== chain.attempt.intentId
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

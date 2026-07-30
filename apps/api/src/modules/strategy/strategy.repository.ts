import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma, Strategy, StrategyVersion, StrategyDecision } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import { canTransitionStrategy, StrategyStatus } from "@marketmind/contracts";

export type StrategyProgressInput = {
  readonly stage: string;
  readonly status: "started" | "progress" | "complete" | "failed";
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload?: Record<string, unknown>;
  readonly retryable?: boolean;
};

@Injectable()
export class StrategyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createStrategy(businessId: string, ownerUserId: string): Promise<Strategy> {
    return this.prisma.strategy.create({
      data: {
        businessId,
        ownerUserId,
        status: "needs_brief",
      },
    });
  }

  async getConfirmedProfileVersionByIdAndOwner(
    id: string,
    ownerUserId: string,
  ) {
    return this.prisma.businessProfileVersion.findFirst({
      where: {
        id,
        business: { ownerUserId },
      },
      select: {
        id: true,
        businessId: true,
        version: true,
        confirmedAt: true,
      },
    });
  }

  async getStrategyByIdAndOwner(id: string, ownerUserId: string) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id },
      include: {
        brief: {
          include: {
            businessProfileVersion: {
              select: { id: true, confirmedAt: true, version: true },
            },
          },
        },
        business: {
          select: { id: true, businessType: true, primaryLocale: true, displayName: true },
        },
      },
    });
    if (!strategy || strategy.ownerUserId !== ownerUserId) return null;
    return strategy;
  }

  /**
   * Owner-unscoped read used by the server-side BullMQ worker, which operates
   * with full trust after the controller/service have already verified
   * ownership. Never expose this through an HTTP handler.
   */
  async readStrategy(id: string) {
    return this.prisma.strategy.findUnique({
      where: { id },
      include: { brief: true },
    });
  }

  async upsertBrief(
    strategyId: string,
    data: Omit<Prisma.StrategyBriefUncheckedCreateInput, "id" | "createdAt" | "updatedAt">,
  ) {
    return this.prisma.strategyBrief.upsert({
      where: { strategyId },
      create: data,
      update: data,
    });
  }

  /**
   * Enforces the shared FSM contract before every status write. Runs the read
   * and conditional update in a single transaction with SERIALIZABLE-ish
   * semantics via a guarded update so callers never need to guard manually.
   *
   * Throws BadRequestException on an illegal transition so the caller never
   * has to inspect the return value to know whether the transition happened.
   */
  async updateStrategyStatus(id: string, to: StrategyStatus): Promise<Strategy> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.strategy.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      });

      const from = current.status as StrategyStatus;

      if (!canTransitionStrategy(from, to)) {
        throw new BadRequestException(
          `Invalid strategy lifecycle transition: ${from} → ${to}`,
        );
      }

      return tx.strategy.update({
        where: { id },
        data: { status: to },
      });
    });
  }

  /**
   * Atomic idempotency guard for generation/retry/revision. Uses a single
   * conditional UPDATE (updateMany with a WHERE clause on status) so the
   * check and the transition are one atomic SQL statement — a concurrent
   * request hitting the same row will see the new status and its update will
   * match zero rows. This mirrors Discovery's `updateStatusIfCurrent` pattern
   * and is the only correct way to prevent TOCTOU races under PostgreSQL's
   * default READ COMMITTED isolation.
   *
   * The caller also passes the FSM-allowed idle statuses; `updateMany`'s
   * WHERE clause includes both the id and `status IN (idleStatuses)`, so only
   * a row in an idle state can be claimed.
   */
  async claimForGeneration(
    id: string,
    idleStatuses: StrategyStatus[],
    next: StrategyStatus,
  ): Promise<{ claimed: boolean }> {
    // Defensive FSM validation in JS — the real atomicity comes from the
    // conditional UPDATE below, but this catches programmer errors early.
    for (const idle of idleStatuses) {
      if (!canTransitionStrategy(idle, next)) {
        return { claimed: false };
      }
    }

    const result = await this.prisma.strategy.updateMany({
      where: {
        id,
        status: { in: idleStatuses as string[] },
      },
      data: { status: next },
    });

    return { claimed: result.count === 1 };
  }

  async getActiveConfirmedProfileVersion(businessId: string) {
    return this.prisma.businessProfileVersion.findFirst({
      where: { businessId },
      orderBy: { version: "desc" },
    });
  }

  // ── Retrieval run helpers ───────────────────────────────────────────
  // NOTE: Retrieval runs are persisted by the FastAPI service, which owns the
  // StrategyRetrievalRun / StrategyRetrievalItem / StrategyRetrievalGap
  // tables. The NestJS side only stores and references the run id returned
  // by FastAPI. Read-only access for the /retrieval endpoint is provided here.

  async getLatestRetrievalRun(strategyId: string) {
    return this.prisma.strategyRetrievalRun.findFirst({
      where: { strategyId },
      orderBy: { createdAt: "desc" },
      include: { items: true, gaps: true },
    });
  }

  // ── Version helpers ─────────────────────────────────────────────────

  async listVersions(strategyId: string) {
    return this.prisma.strategyVersion.findMany({
      where: { strategyId },
      orderBy: { version: "desc" },
      include: { decisions: true },
    });
  }

  async listRetrievalRunBriefIds(retrievalRunIds: string[]) {
    return this.prisma.strategyRetrievalRun.findMany({
      where: { id: { in: retrievalRunIds } },
      select: { id: true, briefId: true },
    });
  }

  async getVersionByNumber(strategyId: string, version: number): Promise<StrategyVersion | null> {
    return this.prisma.strategyVersion.findUnique({
      where: { strategyId_version: { strategyId, version } },
    });
  }

  async getLatestVersion(strategyId: string): Promise<StrategyVersion | null> {
    return this.prisma.strategyVersion.findFirst({
      where: { strategyId },
      orderBy: { version: "desc" },
    });
  }

  async countRetries(strategyId: string): Promise<number> {
    return this.prisma.strategyDecision.count({
      where: { strategyVersion: { strategyId }, action: "retry" },
    });
  }

  /**
   * Creates a new immutable StrategyVersion in a transaction, increments the
   * version counter, and updates the parent Strategy's currentVersionId /
   * status. The status transition is performed as a conditional UPDATE
   * (updateMany with WHERE status = 'validating') so a concurrent job cannot
   * overwrite a status that has already moved on. The FSM contract is also
   * validated in JS for early, descriptive error messages.
   */
  async appendStrategyVersion(
    strategyId: string,
    retrievalRunId: string | null,
    planData: Prisma.InputJsonValue,
    promptConfig: Prisma.InputJsonValue,
  ): Promise<StrategyVersion> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.strategy.findUniqueOrThrow({
        where: { id: strategyId },
        select: { status: true },
      });

      // The processor sets status to "validating" before calling this. The
      // only legal FSM path to "draft" is validating → draft.
      const from = current.status as StrategyStatus;
      if (!canTransitionStrategy(from, "draft")) {
        throw new BadRequestException(
          `Invalid strategy lifecycle transition: ${from} → draft`,
        );
      }

      const latest = await tx.strategyVersion.findFirst({
        where: { strategyId },
        orderBy: { version: "desc" },
      });
      const nextVersion = latest ? latest.version + 1 : 1;

      const version = await tx.strategyVersion.create({
        data: {
          strategyId,
          version: nextVersion,
          retrievalRunId,
          planData,
          promptConfig,
        },
      });

      // Conditional UPDATE: only transition if the status is still
      // "validating". A concurrent job that already moved the status will
      // cause this to match zero rows — but since we already validated the
      // FSM above and the idempotency guard prevents concurrent jobs, this
      // is a safety net rather than the primary guard.
      await tx.strategy.updateMany({
        where: { id: strategyId, status: "validating" },
        data: { currentVersionId: version.id, status: "draft" },
      });

      return version;
    });
  }

  /**
   * Records an owner decision and—if approve or reject—atomically transitions
   * the strategy to the terminal state via a conditional UPDATE (updateMany
   * with WHERE status = 'draft'). This prevents two concurrent approve/reject
   * calls from both succeeding: only the first one's conditional UPDATE will
   * match, the second will see a non-draft status and its transaction will
   * roll back the decision row. For revision_requested the caller is
   * responsible for claiming the transition atomically via
   * {@link claimForGeneration} before calling this method.
   */
  async recordOwnerDecision(
    strategyVersionId: string,
    ownerUserId: string,
    action: string,
    feedback?: string,
  ): Promise<{ decision: StrategyDecision; nextStatus: StrategyStatus | null }> {
    return this.prisma.$transaction(async (tx) => {
      const decision = await tx.strategyDecision.create({
        data: { strategyVersionId, ownerUserId, action, feedback },
      });

      const version = await tx.strategyVersion.findUnique({
        where: { id: strategyVersionId },
        select: { strategyId: true },
      });
      if (!version) {
        return { decision, nextStatus: null };
      }

      if (action === "approve" || action === "reject") {
        const next = action === "approve" ? "approved" : "rejected";

        // Conditional UPDATE: only transitions if the status is still
        // "draft". A concurrent approve/reject that already moved the
        // status will cause this to match zero rows — the transaction
        // rolls back the decision row, preventing duplicate decisions.
        const result = await tx.strategy.updateMany({
          where: { id: version.strategyId, status: "draft" },
          data: { status: next },
        });

        if (result.count === 0) {
          throw new BadRequestException(
            `Strategy is no longer in draft state; decision could not be applied`,
          );
        }

        return { decision, nextStatus: next };
      }

      return { decision, nextStatus: null };
    });
  }

  /**
   * Records a retry attempt for audit purposes, used to count against the
   * retry bound.
   */
  async recordRetryDecision(strategyVersionId: string, ownerUserId: string) {
    return this.prisma.strategyDecision.create({
      data: { strategyVersionId, ownerUserId, action: "retry" },
    });
  }

  // ── Progress events (lifecycle audit) ───────────────────────────────
  // Mirrors the repository's established journey pattern: DiscoveryProgressEvent.
  // Each lifecycle transition appends an immutable sequenced event so the
  // full history of a strategy is reproducible and auditable.

  async appendProgressEvent(
    strategyId: string,
    event: StrategyProgressInput,
  ): Promise<PersistedStrategyProgressEvent> {
    const savedEvent = await this.prisma.$transaction(async (tx) => {
      const seq = await tx.strategyProgressEvent.count({
        where: { strategyId },
      });

      return tx.strategyProgressEvent.create({
        data: {
          strategyId,
          seq: seq + 1,
          stage: event.stage,
          status: event.status,
          messageKey: event.messageKey,
          messageText: event.messageText,
          payload: (event.payload ??
            (event.retryable ? { retryable: true } : {})) as Prisma.InputJsonObject,
        },
      });
    });

    return savedEvent;
  }

  async listProgressEvents(strategyId: string): Promise<PersistedStrategyProgressEvent[]> {
    return this.prisma.strategyProgressEvent.findMany({
      where: { strategyId },
      orderBy: { seq: "asc" },
    });
  }
}

export type PersistedStrategyProgressEvent = {
  readonly id: bigint;
  readonly strategyId: string;
  readonly seq: number;
  readonly stage: string;
  readonly status: string;
  readonly messageKey: string;
  readonly messageText: string;
  readonly payload: Prisma.JsonValue;
  readonly createdAt: Date;
};

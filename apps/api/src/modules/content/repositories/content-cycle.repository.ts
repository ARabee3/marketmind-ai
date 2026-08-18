import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ContentCycle } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ContentWeekContextOwnerInput } from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { weekCutoffDate, weekStartDate } from "../content-schedule";

export type CreateContentCycleInput = {
  readonly businessId: string;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly strategyDecisionId: string;
  readonly profileVersionId: string;
  readonly week1StartDate: Date;
  readonly idempotencyKey?: string;
  readonly requestFingerprint?: string;
  /** Week-1 generation cutoff, computed by the service from the Strategy start. */
  readonly nextGenerationAt?: Date;
};

export type CreateCycleWithWeekOneInput = CreateContentCycleInput & {
  readonly initialWeekContext: ContentWeekContextOwnerInput;
  readonly generationJob?: { readonly idempotencyKey: string };
  /**
   * New cycles are content-v2 only. Historical content-v1 cycles remain
   * readable through compatibility paths but cannot be created here.
   */
  readonly contractVersion?: "content-v2";
  readonly skipWeekOneClaim?: boolean;
};

/**
 * Repository for content cycles.
 *
 * Mirrors the Strategy repository design: grouped methods on one class, with
 * the atomic conditional-UPDATE pattern (`updateMany` with a WHERE on status)
 * for pause/resume so concurrent calls cannot double-apply a transition.
 */
@Injectable()
export class ContentCycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent create keyed on `@@unique([owner_user_id, idempotency_key])`.
   * A concurrent or repeated request with the same key returns the original
   * row instead of throwing.
   */
  async createCycle(
    input: CreateContentCycleInput,
    ownerUserId: string,
  ): Promise<ContentCycle> {
    try {
      return await this.prisma.contentCycle.create({
        data: {
          businessId: input.businessId,
          strategyId: input.strategyId,
          strategyVersion: input.strategyVersion,
          strategyDecisionId: input.strategyDecisionId,
          profileVersionId: input.profileVersionId,
          week1StartDate: input.week1StartDate,
          ownerUserId,
          idempotencyKey: input.idempotencyKey ?? null,
          idempotencyFingerprint: input.requestFingerprint ?? null,
          ...(input.nextGenerationAt !== undefined
            ? { nextGenerationAt: input.nextGenerationAt }
            : {}),
          contractVersion: "content-v2",
        },
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const existing = await this.prisma.contentCycle.findFirst({
          where: { ownerUserId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          if (existing.idempotencyFingerprint !== input.requestFingerprint) {
            throw new ConflictException({
              code: "CONTENT_VERSION_CONFLICT",
              message:
                "The idempotency key was already used with a different Content cycle request.",
            });
          }
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Atomically creates a cycle, its immutable Week-1 context, the Week-1 pack
   * claim, and the initial cycle cursor. Queue delivery happens after this
   * method commits; PostgreSQL therefore always contains the authoritative
   * intent even when Redis is unavailable.
   */
  async createCycleWithWeekOne(
    input: CreateCycleWithWeekOneInput,
    ownerUserId: string,
  ): Promise<{
    cycle: ContentCycle;
    weekContext: Prisma.ContentWeekContextGetPayload<Record<string, never>>;
    pack: Prisma.ContentPackGetPayload<Record<string, never>> | null;
    created: boolean;
  }> {
    if (!input.nextGenerationAt) {
      throw new BadRequestException(
        "Content cycle creation requires a Week-1 generation cutoff.",
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cycle = await tx.contentCycle.create({
          data: {
            businessId: input.businessId,
            strategyId: input.strategyId,
            strategyVersion: input.strategyVersion,
            strategyDecisionId: input.strategyDecisionId,
            profileVersionId: input.profileVersionId,
            week1StartDate: input.week1StartDate,
            ownerUserId,
            idempotencyKey: input.idempotencyKey ?? null,
            idempotencyFingerprint: input.requestFingerprint ?? null,
            nextGenerationAt: input.nextGenerationAt,
            contractVersion: "content-v2",
          },
        });
        const weekContext = await tx.contentWeekContext.create({
          data: {
            contentCycleId: cycle.id,
            weekNumber: 1,
            weekStartDate: input.week1StartDate,
            promotionMode: input.initialWeekContext.promotion_mode,
            promotion:
              input.initialWeekContext.promotion === null
                ? Prisma.JsonNull
                : (input.initialWeekContext.promotion as Prisma.InputJsonValue),
            mustInclude: input.initialWeekContext
              .must_include as Prisma.InputJsonValue,
            mustAvoid: input.initialWeekContext
              .must_avoid as Prisma.InputJsonValue,
            approvedAssetIds: input.initialWeekContext
              .approved_asset_ids as Prisma.InputJsonValue,
            ctaDestination: input.initialWeekContext
              .cta_destination as Prisma.InputJsonValue,
            generationCutoffAt: input.nextGenerationAt,
            weeklyClaimId: randomUUID(),
            contextSource: "owner_confirmed",
            confirmedByUserId: ownerUserId,
            confirmedAt: new Date(),
          },
        });
        const frozenAt = new Date();
        // v2 cycles leave the context unfrozen: the v2 generation claim
        // freezes it together with the week-plan snapshot.
        if (!input.skipWeekOneClaim) {
          await tx.contentWeekContext.updateMany({
            where: { id: weekContext.id, frozenAt: null },
            data: { frozenAt },
          });
        }
        const pack = input.skipWeekOneClaim
          ? null
          : await tx.contentPack.create({
              data: {
                contentCycleId: cycle.id,
                weeklyClaimId: weekContext.weeklyClaimId,
                weekNumber: 1,
                businessId: input.businessId,
                strategyId: input.strategyId,
                strategyVersion: input.strategyVersion,
                strategyDecisionId: input.strategyDecisionId,
                profileVersionId: input.profileVersionId,
                weekContextId: weekContext.id,
                status: "queued",
                retryEligible: true,
                itemIds: [],
                contractVersion: "content-v2",
              },
            });
        if (input.generationJob && pack) {
          await tx.contentJobOutbox.create({
            data: {
              jobId: `generate-content-${pack.id}`,
              queueName: "content-generation",
              jobName: "generate-content",
              payload: {
                contentCycleId: cycle.id,
                weekNumber: 1,
                contentPackId: pack.id,
                idempotencyKey: `pack:${pack.id}`,
                correlationId: `pack:${pack.id}`,
              },
            },
          });
        }
        return {
          cycle,
          weekContext: { ...weekContext, frozenAt },
          pack,
          created: true,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const existing = await this.prisma.contentCycle.findFirst({
          where: { ownerUserId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          if (existing.idempotencyFingerprint !== input.requestFingerprint) {
            throw new ConflictException({
              code: "CONTENT_VERSION_CONFLICT",
              message:
                "The idempotency key was already used with a different Content cycle request.",
            });
          }
          const weekContext =
            await this.prisma.contentWeekContext.findUniqueOrThrow({
              where: {
                contentCycleId_weekNumber: {
                  contentCycleId: existing.id,
                  weekNumber: 1,
                },
              },
            });
          const pack =
            existing.contractVersion === "content-v2"
              ? null
              : await this.prisma.contentPack.findUniqueOrThrow({
                  where: {
                    contentCycleId_weekNumber: {
                      contentCycleId: existing.id,
                      weekNumber: 1,
                    },
                  },
                });
          return { cycle: existing, weekContext, pack, created: false };
        }
      }
      throw error;
    }
  }

  async getCycleByIdAndOwner(
    id: string,
    ownerUserId: string,
  ): Promise<ContentCycle | null> {
    const cycle = await this.prisma.contentCycle.findUnique({
      where: { id },
    });
    if (!cycle || cycle.ownerUserId !== ownerUserId) {
      return null;
    }
    return cycle;
  }

  /**
   * Owner-unscoped read used by the server-side scheduler/worker for the
   * safe-default week-context path (matches `readStrategy`). Never expose
   * through an HTTP handler; HTTP handlers must use `getCycleByIdAndOwner`.
   */
  async getCycleById(id: string): Promise<ContentCycle | null> {
    return this.prisma.contentCycle.findUnique({ where: { id } });
  }

  async pauseCycle(
    id: string,
    ownerUserId: string,
    reason: string,
  ): Promise<ContentCycle> {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.contentCycle.findFirst({
        where: { id, ownerUserId },
      });
      if (!cycle) {
        throw new NotFoundException("Content cycle not found");
      }
      const result = await tx.contentCycle.updateMany({
        where: { id, ownerUserId, status: "active" },
        data: { status: "paused", pauseReason: reason },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          "Content cycle is not active; cannot pause",
        );
      }
      return tx.contentCycle.findUniqueOrThrow({ where: { id } });
    });
  }

  async resumeCycle(id: string, ownerUserId: string): Promise<ContentCycle> {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.contentCycle.findFirst({
        where: { id, ownerUserId },
      });
      if (!cycle) {
        throw new NotFoundException("Content cycle not found");
      }
      const result = await tx.contentCycle.updateMany({
        where: { id, ownerUserId, status: "paused" },
        data: { status: "active", pauseReason: null },
      });
      if (result.count === 0) {
        throw new BadRequestException(
          "Content cycle is not paused; cannot resume",
        );
      }
      return tx.contentCycle.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * Server-side completion used by the content worker after the final week.
   * Owner-unscoped on purpose (matches `readStrategy`): never expose through
   * an HTTP handler. Only completes when the cycle has reached week 12.
   */
  async completeCycle(id: string): Promise<ContentCycle> {
    return this.prisma.$transaction(async (tx) => {
      const cycle = await tx.contentCycle.findUniqueOrThrow({
        where: { id },
        select: { currentWeekNumber: true },
      });
      if (cycle.currentWeekNumber < 12) {
        throw new BadRequestException(
          `Content cycle cannot complete before week 12 (currently week ${cycle.currentWeekNumber})`,
        );
      }
      const result = await tx.contentCycle.updateMany({
        where: { id, status: { in: ["active", "paused"] } },
        data: { status: "completed", completedAt: new Date() },
      });
      if (result.count === 0) {
        throw new BadRequestException("Content cycle is already completed");
      }
      return tx.contentCycle.findUniqueOrThrow({ where: { id } });
    });
  }

  async listActiveReadyForNextWeek(): Promise<ContentCycle[]> {
    const cycles = await this.prisma.contentCycle.findMany({
      where: {
        status: "active",
        contractVersion: "content-v2",
        nextGenerationAt: { lte: new Date() },
        currentWeekNumber: { lt: 12 },
      },
      include: {
        packs: {
          select: { weekNumber: true, status: true },
        },
      },
    });

    return cycles
      .filter((cycle) => cycle.contractVersion === "content-v2")
      .filter((cycle) =>
        cycle.packs.some(
          (pack) =>
            pack.weekNumber === cycle.currentWeekNumber &&
            isCompletedPackStatus(pack.status),
        ),
      )
      .map((cycle) => {
        const { packs: _packs, ...withoutPacks } = cycle;
        return withoutPacks;
      });
  }

  async markCycleCompleted(id: string): Promise<void> {
    await this.prisma.contentCycle.updateMany({
      where: { id, status: "active" },
      data: { status: "completed", completedAt: new Date() },
    });
  }

  /**
   * Content V2 owner-first weekly rollover (issue #240).
   *
   * Crossing a weekly cutoff may advance the cycle cursor and prepare the
   * next actionable planning context, but it must NOT auto-generate
   * unplanned content. This method atomically:
   *
   *   1. Serializes on the cycle row (`SELECT ... FOR UPDATE`).
   *   2. Conditionally advances `currentWeekNumber` from the caller's
   *      observed N to N+1 only when the locked row still has that cursor and
   *      status — concurrent scheduler ticks resolve to a no-op
   *      (`advanced: false`) instead of rolling over another week.
   *   3. Sets `nextGenerationAt` to the cutoff for week N+1 so the cycle is
   *      not reselected every five minutes while the owner plans.
   *   4. Creates the structural week-context row for week N+1 if it does not
   *      already exist. This row carries only `weekStartDate` +
   *      `weeklyClaimId`; owner-authored inputs flow through the V2 week
   *      plan, editorial profile, CTA, and media libraries — no content is
   *      generated here.
   *
   * A cycle that has reached week 12 is completed instead of advanced.
   * Returns `advanced: false` for cycles that are not active content-v2 or
   * when a concurrent tick already handled the rollover.
   */
  async advanceToNextWeek(
    cycleId: string,
    expectedCurrentWeekNumber: number,
  ): Promise<{
    advanced: boolean;
    completed: boolean;
    nextWeekNumber: number | null;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "content_cycles"
        WHERE "id" = ${cycleId}::uuid
        FOR UPDATE
      `;

      const cycle = await tx.contentCycle.findUniqueOrThrow({
        where: { id: cycleId },
        select: {
          currentWeekNumber: true,
          status: true,
          contractVersion: true,
          week1StartDate: true,
        },
      });

      if (cycle.status !== "active" || cycle.contractVersion !== "content-v2") {
        return { advanced: false, completed: false, nextWeekNumber: null };
      }

      // The scheduler selected this cycle using a snapshot of the cursor. A
      // different process/tick may have advanced it while this transaction
      // waited for the row lock. Treat that stale snapshot as a no-op; never
      // roll a cycle forward a second time just because the lock serialized
      // the two callers.
      if (cycle.currentWeekNumber !== expectedCurrentWeekNumber) {
        return { advanced: false, completed: false, nextWeekNumber: null };
      }

      if (cycle.currentWeekNumber >= 12) {
        await tx.contentCycle.updateMany({
          where: { id: cycleId, status: "active" },
          data: { status: "completed", completedAt: new Date() },
        });
        return { advanced: false, completed: true, nextWeekNumber: null };
      }

      const nextWeek = cycle.currentWeekNumber + 1;
      const advanced = await tx.contentCycle.updateMany({
        where: {
          id: cycleId,
          currentWeekNumber: cycle.currentWeekNumber,
          status: "active",
        },
        data: {
          currentWeekNumber: nextWeek,
          nextGenerationAt: weekCutoffDate(cycle.week1StartDate, nextWeek),
        },
      });
      if (advanced.count === 0) {
        return { advanced: false, completed: false, nextWeekNumber: null };
      }

      const existingContext = await tx.contentWeekContext.findUnique({
        where: {
          contentCycleId_weekNumber: {
            contentCycleId: cycleId,
            weekNumber: nextWeek,
          },
        },
      });
      if (!existingContext) {
        await tx.contentWeekContext.create({
          data: {
            contentCycleId: cycleId,
            weekNumber: nextWeek,
            weekStartDate: new Date(
              `${weekStartDate(cycle.week1StartDate, nextWeek)}T00:00:00.000Z`,
            ),
            promotionMode: "none",
            promotion: Prisma.JsonNull,
            mustInclude: [] as Prisma.InputJsonValue,
            mustAvoid: [] as Prisma.InputJsonValue,
            approvedAssetIds: [] as Prisma.InputJsonValue,
            ctaDestination: {
              type: "none",
              value: null,
            } as Prisma.InputJsonValue,
            generationCutoffAt: weekCutoffDate(cycle.week1StartDate, nextWeek),
            weeklyClaimId: randomUUID(),
            contextSource: "system_defaulted",
            systemDefaultedAt: new Date(),
          },
        });
      }

      return { advanced: true, completed: false, nextWeekNumber: nextWeek };
    });
  }
}

function isCompletedPackStatus(status: string): boolean {
  return ["draft", "partially_approved", "approved"].includes(status);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

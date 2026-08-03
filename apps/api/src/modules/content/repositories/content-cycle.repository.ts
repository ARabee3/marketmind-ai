import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, ContentCycle } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";

export type CreateContentCycleInput = {
  readonly businessId: string;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly strategyDecisionId: string;
  readonly profileVersionId: string;
  readonly idempotencyKey?: string;
  /** Week-1 generation cutoff, computed by the service from the Strategy start. */
  readonly nextGenerationAt?: Date;
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
          ownerUserId,
          idempotencyKey: input.idempotencyKey ?? null,
          ...(input.nextGenerationAt !== undefined
            ? { nextGenerationAt: input.nextGenerationAt }
            : {}),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const existing = await this.prisma.contentCycle.findFirst({
          where: { ownerUserId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return existing;
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
    return this.prisma.contentCycle.findMany({
      where: {
        status: "active",
        nextGenerationAt: { lte: new Date() },
        currentWeekNumber: { lt: 12 },
      },
    });
  }

  async markCycleCompleted(id: string): Promise<void> {
    await this.prisma.contentCycle.updateMany({
      where: { id, status: "active" },
      data: { status: "completed", completedAt: new Date() },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

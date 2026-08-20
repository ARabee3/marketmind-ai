import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { canonicalPublishingJson } from "@marketmind/contracts";
import { PrismaService } from "../../common/persistence/prisma.service";

export type ContentJobIntentInput = {
  readonly jobId: string;
  readonly queueName: string;
  readonly jobName: string;
  readonly payload: Prisma.InputJsonValue;
};

@Injectable()
export class ContentJobOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(
    input: ContentJobIntentInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.ContentJobOutboxGetPayload<Record<string, never>>> {
    const db = tx ?? this.prisma;
    try {
      return await db.contentJobOutbox.create({
        data: {
          jobId: input.jobId,
          queueName: input.queueName,
          jobName: input.jobName,
          payload: input.payload,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await db.contentJobOutbox.findUnique({
        where: { jobId: input.jobId },
      });
      if (!existing) throw error;
      if (
        existing.queueName !== input.queueName ||
        existing.jobName !== input.jobName ||
        canonicalPublishingJson(existing.payload) !==
          canonicalPublishingJson(input.payload)
      ) {
        throw new ConflictException({
          code: "CONTENT_VERSION_CONFLICT",
          message: `Content job ${input.jobId} was reused with different immutable payload bytes.`,
        });
      }
      return existing;
    }
  }

  async claimDueJobs(
    leaseOwner: string,
    limit = 50,
    leaseMs = 60_000,
  ): Promise<Prisma.ContentJobOutboxGetPayload<Record<string, never>>[]> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.contentJobOutbox.updateMany({
          where: {
            state: "processing",
            leaseExpiresAt: { lt: now },
          },
          data: {
            state: "pending",
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: now,
          },
        });

        const ids = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "content_job_outbox"
          WHERE "state" = 'pending'
            AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        `;
        if (ids.length === 0) return [];

        const claimedIds: string[] = [];
        for (const row of ids) {
          const claimed = await tx.contentJobOutbox.updateMany({
            where: { id: row.id, state: "pending" },
            data: { state: "processing", leaseOwner, leaseExpiresAt },
          });
          if (claimed.count === 1) claimedIds.push(row.id);
        }
        return tx.contentJobOutbox.findMany({
          where: { id: { in: claimedIds } },
          orderBy: { createdAt: "asc" },
        });
      },
      { timeout: 30_000 },
    );
  }

  async markDispatched(jobId: string, leaseOwner: string): Promise<boolean> {
    const result = await this.prisma.contentJobOutbox.updateMany({
      where: { id: jobId, state: "processing", leaseOwner },
      data: {
        state: "dispatched",
        dispatchedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  async markDirectDispatched(jobId: string): Promise<boolean> {
    const result = await this.prisma.contentJobOutbox.updateMany({
      where: { jobId, state: "pending" },
      data: { state: "dispatched", dispatchedAt: new Date() },
    });
    return result.count === 1;
  }

  async releaseForRetry(
    jobId: string,
    leaseOwner: string,
    errorMessage: string,
  ): Promise<boolean> {
    const current = await this.prisma.contentJobOutbox.findFirst({
      where: { id: jobId, state: "processing", leaseOwner },
      select: { attempts: true },
    });
    if (!current) return false;
    const attempts = current.attempts + 1;
    const terminal = attempts >= 5;
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
    const result = await this.prisma.contentJobOutbox.updateMany({
      where: { id: jobId, state: "processing", leaseOwner },
      data: {
        state: terminal ? "failed" : "pending",
        attempts,
        lastError: errorMessage.slice(0, 1_000),
        nextAttemptAt: terminal ? null : new Date(Date.now() + delayMs),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  async getByJobId(
    jobId: string,
  ): Promise<Prisma.ContentJobOutboxGetPayload<Record<string, never>> | null> {
    return this.prisma.contentJobOutbox.findUnique({ where: { jobId } });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

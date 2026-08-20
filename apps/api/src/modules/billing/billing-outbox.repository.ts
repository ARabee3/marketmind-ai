import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";

type BillingOutboxRow = Prisma.BillingOutboxGetPayload<Record<string, never>>;

export const BILLING_OUTBOX_MAX_ATTEMPTS = 5;

/**
 * Durable lease/retry state for committed billing outbox events (issue #247).
 *
 * Rows are written inside the payment transaction, so the unique dedupe key
 * already makes duplicate webhooks idempotent. This repository adds a
 * lease/backoff state machine mirroring the content outbox pattern: the
 * reconciler claims due events and enqueues them, the worker re-claims each
 * event by id and marks it sent only after the mail provider accepted it.
 * A transient mail failure releases the lease for a retry and never undoes
 * the confirmed payment, wallet credit, or ledger entry.
 */
@Injectable()
export class BillingOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimDueEvents(
    leaseOwner: string,
    limit = 50,
    leaseMs = 60_000,
  ): Promise<BillingOutboxRow[]> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.billingOutbox.updateMany({
        where: { state: "processing", leaseExpiresAt: { lt: now } },
        data: {
          state: "pending",
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: now,
        },
      });

      const ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "billing_outbox"
        WHERE "state" = 'pending'
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `;
      if (ids.length === 0) return [];

      const claimedIds: string[] = [];
      for (const row of ids) {
        const claimed = await tx.billingOutbox.updateMany({
          where: { id: row.id, state: "pending" },
          data: {
            state: "processing",
            leaseOwner,
            leaseExpiresAt: new Date(now.getTime() + leaseMs),
          },
        });
        if (claimed.count === 1) claimedIds.push(row.id);
      }
      return tx.billingOutbox.findMany({
        where: { id: { in: claimedIds } },
        orderBy: { createdAt: "asc" },
      });
    });
  }

  /**
   * Returns a claimed event (pending → processing) for the worker to process.
   * A missing or already-processing event returns null so replays are no-ops.
   */
  async claimEventById(
    eventId: string,
    leaseOwner: string,
    leaseMs = 60_000,
  ): Promise<BillingOutboxRow | null> {
    const claimed = await this.prisma.billingOutbox.updateMany({
      where: { id: eventId, state: "pending" },
      data: {
        state: "processing",
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + leaseMs),
      },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.billingOutbox.findUnique({ where: { id: eventId } });
  }

  /**
   * Releases a claimed event back to pending after it was enqueued, so the
   * worker re-claims and processes it (mirrors the content outbox flow).
   */
  async releaseClaim(eventId: string, leaseOwner: string): Promise<boolean> {
    const result = await this.prisma.billingOutbox.updateMany({
      where: { id: eventId, state: "processing", leaseOwner },
      data: { state: "pending", leaseOwner: null, leaseExpiresAt: null },
    });
    return result.count === 1;
  }

  async markDispatched(eventId: string, leaseOwner: string): Promise<boolean> {
    const result = await this.prisma.billingOutbox.updateMany({
      where: { id: eventId, state: "processing", leaseOwner },
      data: {
        state: "sent",
        dispatchedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return result.count === 1;
  }

  /**
   * Releases a failed delivery with exponential backoff. After the terminal
   * attempt count the event stays `failed`; the confirmed payment is never
   * touched. Error text is truncated and must not contain secrets.
   */
  async releaseForRetry(
    eventId: string,
    leaseOwner: string,
    errorMessage: string,
  ): Promise<boolean> {
    const current = await this.prisma.billingOutbox.findFirst({
      where: { id: eventId, state: "processing", leaseOwner },
      select: { attempts: true },
    });
    if (!current) return false;

    const attempts = current.attempts + 1;
    const terminal = attempts >= BILLING_OUTBOX_MAX_ATTEMPTS;
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
    const result = await this.prisma.billingOutbox.updateMany({
      where: { id: eventId, state: "processing", leaseOwner },
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
}

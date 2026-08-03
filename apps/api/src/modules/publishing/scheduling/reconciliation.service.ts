import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../../../common/persistence/prisma.service";

/** Attempts stuck in QUEUED or DISPATCHING past this threshold are flagged UNKNOWN. */
const STUCK_ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Automated reconciliation sweep — runs every 3 minutes (§6).
 *
 * Three sweeps:
 * 1. Intents in SCHEDULED with passed scheduledUtcAt but no attempt → re-enqueue.
 * 2. Attempts stuck in QUEUED/DISPATCHING past 10 min with no callback → flag UNKNOWN.
 * 3. BullMQ delayed jobs whose intent is already terminal → remove as orphans.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("publishing-dispatch") private readonly dispatchQueue: Queue,
  ) {}

  @Cron("0 */3 * * * *") // every 3 minutes
  async runSweep(): Promise<void> {
    this.logger.log("Starting reconciliation sweep");
    await Promise.all([
      this.recoverMissedJobs(),
      this.flagStuckAttempts(),
      this.removeOrphanJobs(),
    ]);
    this.logger.log("Reconciliation sweep complete");
  }

  /**
   * §6 sweep 1: SCHEDULED intents whose due time has passed with zero attempts.
   * These are gaps from Redis data loss or a silently failed job creation.
   */
  async recoverMissedJobs(): Promise<void> {
    const overdue = await this.prisma.publishingIntent.findMany({
      where: {
        status: "SCHEDULED",
        scheduledUtcAt: { lt: new Date() },
      },
    });

    for (const intent of overdue) {
      // Re-check with version-scoped attempt count
      const attemptCount = await this.prisma.publishingAttempt.count({
        where: { intentId: intent.id, intentVersion: intent.version },
      });
      if (attemptCount === 0) {
        const jobKey = `publish:${intent.id}:${intent.version}`;
        const exists = await this.dispatchQueue.getJob(jobKey);
        if (!exists) {
          this.logger.warn(
            `Recovering missed dispatch for intent=${intent.id} v=${intent.version}`,
          );
          await this.dispatchQueue.add(
            "dispatch",
            {
              intentId: intent.id,
              version: intent.version,
              // Deterministic per (intent, version) so a replayed sweep resolves
              // to the same attempt / recorded no-op (dispatch processor).
              idempotencyKey: `recovery:${intent.id}:${intent.version}`,
            },
            { jobId: jobKey, delay: 0 },
          );
        }
      }
    }
  }

  /**
   * §6 sweep 2: Attempts stuck in QUEUED/DISPATCHING past timeout → flag UNKNOWN.
   * This is the recovery path for crash-after-commit-before-claim (§7.4).
   */
  async flagStuckAttempts(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_ATTEMPT_TIMEOUT_MS);
    const stuck = await this.prisma.publishingAttempt.findMany({
      where: {
        status: { in: ["QUEUED", "DISPATCHING"] },
        createdAt: { lt: cutoff },
      },
    });

    for (const attempt of stuck) {
      this.logger.warn(
        `Flagging stuck attempt=${attempt.id} (status=${attempt.status}) as UNKNOWN`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.publishingAttempt.update({
          where: { id: attempt.id },
          data: { status: "UNKNOWN", finishedAt: new Date() },
        });
        // Create an UNKNOWN result row (only if none exists) so an admin can
        // resolve it via /publishing/admin/results/:id/resolve — the resolve
        // endpoint requires a result id. Without this row a stuck attempt is
        // unresolvable (#119 non-blocking truthfulness gap).
        const existing = await tx.publishingResult.findUnique({
          where: { attemptId: attempt.id },
        });
        if (!existing) {
          await tx.publishingResult.create({
            data: {
              attemptId: attempt.id,
              intentId: attempt.intentId,
              outcome: "UNKNOWN",
              provider: "meta",
              errorCode: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
              // UNKNOWN means the request may already have reached the
              // provider. It requires reconciliation and is never retryable.
              retryable: false,
              sanitizedError:
                "Stuck in QUEUED/DISPATCHING past timeout — delivery outcome unknown",
              occurredAt: new Date(),
            },
          });
        }
        // Only transition intent if it's still in SCHEDULED/DISPATCHING
        await tx.publishingIntent.updateMany({
          where: {
            id: attempt.intentId,
            status: { in: ["SCHEDULED", "DISPATCHING"] },
          },
          data: { status: "ACTION_REQUIRED" },
        });
      });
    }
  }

  /**
   * §6 sweep 3: Remove BullMQ delayed jobs whose intent is already terminal.
   */
  async removeOrphanJobs(): Promise<void> {
    const TERMINAL = ["SUCCEEDED", "FAILED", "CANCELLED", "ACTION_REQUIRED"];
    try {
      const delayed = await this.dispatchQueue.getDelayed();
      for (const job of delayed) {
        const { intentId } = job.data as { intentId: string };
        if (!intentId) continue;
        const intent = await this.prisma.publishingIntent.findUnique({
          where: { id: intentId },
          select: { status: true },
        });
        if (intent && TERMINAL.includes(intent.status)) {
          this.logger.warn(
            `Removing orphan job ${job.id} for terminal intent=${intentId}`,
          );
          await job.remove();
        }
      }
    } catch (err) {
      this.logger.error("Failed to sweep orphan BullMQ jobs", err);
    }
  }

  /**
   * Manual trigger: re-sync BullMQ for a single intent (admin endpoint §9).
   */
  async resyncIntent(
    intentId: string,
  ): Promise<{ queued: boolean; reason: string }> {
    const intent = await this.prisma.publishingIntent.findUniqueOrThrow({
      where: { id: intentId },
    });

    if (intent.status !== "SCHEDULED") {
      return {
        queued: false,
        reason: `Intent status is "${intent.status}", not SCHEDULED`,
      };
    }

    const jobKey = `publish:${intentId}:${intent.version}`;
    const existing = await this.dispatchQueue.getJob(jobKey);
    if (existing) {
      return { queued: false, reason: "Job already present in queue" };
    }

    const delay = Math.max(
      0,
      (intent.scheduledUtcAt?.getTime() ?? Date.now()) - Date.now(),
    );
    await this.dispatchQueue.add(
      "dispatch",
      {
        intentId,
        version: intent.version,
        idempotencyKey: `recovery:${intentId}:${intent.version}`,
      },
      { jobId: jobKey, delay },
    );

    this.logger.log(`Manual resync: enqueued ${jobKey} delay=${delay}ms`);
    return { queued: true, reason: `Re-enqueued with delay=${delay}ms` };
  }
}

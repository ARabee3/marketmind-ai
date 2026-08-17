import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import type { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import {
  PerformanceRepository,
  PerformanceRepositoryError,
} from "../publishing/performance/performance.repository";
import {
  FACEBOOK_PERFORMANCE_JOB,
  FACEBOOK_PERFORMANCE_QUEUE,
  PERFORMANCE_LEASE_DURATION_MS,
  PERFORMANCE_RECONCILE_BATCH_SIZE,
  PERFORMANCE_RECONCILE_INTERVAL_MS,
  PERFORMANCE_RETRY_BASE_MS,
} from "./performance.constants";
import type { PerformanceSyncJobData } from "./performance.processor";

export type PerformanceReconcileResult = {
  readonly discovered: number;
  readonly recovered: number;
  readonly claimed: number;
  readonly enqueued: number;
};

/**
 * PostgreSQL-authoritative scheduler. Redis/BullMQ only carries a recoverable
 * execution signal; every due row can be rebuilt from the database after a
 * queue outage, process crash, or expired lease.
 */
@Injectable()
export class PerformanceReconciler {
  private readonly logger = new Logger(PerformanceReconciler.name);

  constructor(
    private readonly repository: PerformanceRepository,
    @InjectQueue(FACEBOOK_PERFORMANCE_QUEUE)
    private readonly queue: Queue<PerformanceSyncJobData>,
  ) {}

  @Cron(`*/${PERFORMANCE_RECONCILE_INTERVAL_MS / 1000} * * * * *`)
  async scheduledReconcile(): Promise<void> {
    await this.reconcileOnce().catch((error: unknown) => {
      this.logger.warn(
        `Performance reconciliation skipped: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
  }

  async reconcileOnce(now = new Date()): Promise<PerformanceReconcileResult> {
    const publicationIds = await this.repository.listEligiblePublicationIds(
      PERFORMANCE_RECONCILE_BATCH_SIZE * 4,
    );
    let discovered = 0;
    for (const publishingResultId of publicationIds) {
      try {
        const windows =
          await this.repository.ensureSyncWindowsForResult(publishingResultId);
        discovered += windows.length;
      } catch (error) {
        if (error instanceof PerformanceRepositoryError) {
          this.logger.warn(
            `Performance result skipped result=${publishingResultId} code=${error.code}`,
          );
        } else {
          throw error;
        }
      }
    }

    const recovered = await this.repository.recoverExpiredLeases(now);
    const dueIds = await this.repository.listDueSyncWindowIds(
      now,
      PERFORMANCE_RECONCILE_BATCH_SIZE,
    );
    let claimed = 0;
    let enqueued = 0;
    for (const syncWindowId of dueIds) {
      const owner = `performance-reconciler:${syncWindowId}:${randomUUID()}`;
      const window = await this.repository.claimSyncWindow(
        syncWindowId,
        owner,
        now,
        PERFORMANCE_LEASE_DURATION_MS,
      );
      if (!window) continue;
      claimed += 1;
      const jobId = `performance-sync:${syncWindowId}:${window.attempt_count}`;
      try {
        await this.queue.add(
          FACEBOOK_PERFORMANCE_JOB,
          { syncWindowId, leaseOwner: owner },
          {
            jobId,
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        );
        enqueued += 1;
      } catch (error) {
        await this.repository.releaseSyncWindowAfterEnqueueFailure(
          syncWindowId,
          owner,
          new Date(now.getTime() + PERFORMANCE_RETRY_BASE_MS),
        );
        this.logger.warn(
          `Performance queue enqueue failed window=${syncWindowId}; row retained for recovery`,
        );
      }
    }
    return { discovered, recovered, claimed, enqueued };
  }
}

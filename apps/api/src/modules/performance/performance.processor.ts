import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Job } from "bullmq";
import type { PerformanceErrorCode } from "@marketmind/contracts";
import {
  PerformanceRepository,
  PerformanceRepositoryError,
} from "../publishing/performance/performance.repository";
import {
  FacebookPerformanceProvider,
  PerformanceProviderError,
} from "./facebook-performance.provider";
import {
  PERFORMANCE_MAX_ATTEMPTS,
  PERFORMANCE_RETRY_BASE_MS,
  FACEBOOK_PERFORMANCE_QUEUE,
} from "./performance.constants";
import { buildPerformanceSnapshot } from "./performance.snapshot";

export type PerformanceSyncJobData = {
  readonly syncWindowId: string;
  readonly leaseOwner: string;
};

@Injectable()
@Processor(FACEBOOK_PERFORMANCE_QUEUE)
export class PerformanceProcessor extends WorkerHost {
  private readonly logger = new Logger(PerformanceProcessor.name);

  constructor(
    private readonly repository: PerformanceRepository,
    private readonly provider: FacebookPerformanceProvider,
  ) {
    super();
  }

  async process(job: Job<PerformanceSyncJobData>): Promise<void> {
    const { syncWindowId, leaseOwner } = job.data;
    const window = await this.repository.getSyncWindowById(syncWindowId);
    if (
      !window ||
      window.state !== "leased" ||
      window.lease_owner !== leaseOwner
    ) {
      this.logger.log(`Ignoring stale performance job window=${syncWindowId}`);
      return;
    }
    const context = await this.repository.getPublicationContext(
      window.publishing_result_id,
      window.business_id,
    );
    if (!context) {
      await this.repository.markSyncWindowTerminal({
        syncWindowId,
        owner: leaseOwner,
        errorCode: "PERFORMANCE_NOT_ELIGIBLE",
      });
      return;
    }

    // A crash after the immutable insert but before the state update is
    // recovered without calling Meta a second time.
    const existing = await this.repository.getSnapshotForWindow(
      window.business_id,
      window.publishing_result_id,
      window.window,
    );
    if (existing) {
      await this.repository.markSyncWindowSucceeded(syncWindowId, leaseOwner);
      return;
    }

    try {
      const observation = await this.provider.fetch(context);
      const snapshot = buildPerformanceSnapshot({
        window: {
          sync_window_id: window.sync_window_id,
          publishing_result_id: window.publishing_result_id,
          business_id: window.business_id,
          window: window.window,
          due_at: window.due_at,
        },
        context,
        observation,
      });
      await this.repository.completeSyncWindowWithSnapshot({
        syncWindowId,
        owner: leaseOwner,
        snapshot,
      });
    } catch (error) {
      await this.handleFailure(
        window.attempt_count,
        syncWindowId,
        leaseOwner,
        error,
      );
    }
  }

  private async handleFailure(
    attemptCount: number,
    syncWindowId: string,
    owner: string,
    error: unknown,
  ): Promise<void> {
    const normalized = normalizeFailure(error);
    const retry =
      normalized.retryable && attemptCount < PERFORMANCE_MAX_ATTEMPTS;
    if (retry) {
      const delay =
        PERFORMANCE_RETRY_BASE_MS * 2 ** Math.max(attemptCount - 1, 0);
      await this.repository.markSyncWindowRetryable({
        syncWindowId,
        owner,
        errorCode: normalized.code,
        nextAttemptAt: new Date(Date.now() + delay),
      });
      return;
    }
    await this.repository.markSyncWindowTerminal({
      syncWindowId,
      owner,
      errorCode: normalized.code,
    });
    this.logger.warn(
      `Performance sync stopped window=${syncWindowId} code=${normalized.code}`,
    );
  }
}

function normalizeFailure(error: unknown): {
  readonly code: PerformanceErrorCode;
  readonly retryable: boolean;
} {
  if (error instanceof PerformanceProviderError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof PerformanceRepositoryError) {
    return { code: error.code, retryable: false };
  }
  return {
    code: "PERFORMANCE_PROVIDER_UNAVAILABLE",
    retryable: true,
  };
}

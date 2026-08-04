import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { ContentJobOutboxRepository } from "./content-job-outbox.repository";

@Injectable()
export class ContentJobOutboxDispatcher {
  private readonly logger = new Logger(ContentJobOutboxDispatcher.name);

  constructor(
    private readonly jobs: ContentJobOutboxRepository,
    @InjectQueue("content-generation") private readonly generationQueue: Queue,
    @InjectQueue("content-outbox") private readonly outboxQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    const leaseOwner = `content-job-reconciler:${randomUUID()}`;
    const claimed = await this.jobs.claimDueJobs(leaseOwner);
    for (const job of claimed) {
      try {
        const queue =
          job.queueName === "content-generation"
            ? this.generationQueue
            : job.queueName === "content-outbox"
              ? this.outboxQueue
              : null;
        if (!queue) {
          await this.jobs.releaseForRetry(
            job.id,
            leaseOwner,
            `Unsupported queue ${job.queueName}.`,
          );
          continue;
        }
        await queue.add(job.jobName, job.payload, {
          jobId: job.jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
        });
        await this.jobs.markDispatched(job.id, leaseOwner);
      } catch (error) {
        await this.jobs.releaseForRetry(
          job.id,
          leaseOwner,
          error instanceof Error ? error.message : "Unknown queue error",
        );
        this.logger.error(
          `Content job ${job.jobId} could not be dispatched: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }
  }
}

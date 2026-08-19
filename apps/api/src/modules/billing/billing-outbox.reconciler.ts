import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { BillingOutboxRepository } from "./billing-outbox.repository";
import { toBullMqJobId } from "../../common/queues/bullmq-job-id";

/**
 * Periodic reconciler for the billing outbox: claims due `billing_outbox`
 * rows (including expired leases and backed-off retries) and enqueues each
 * onto the `billing-outbox` queue for the worker, mirroring the content
 * outbox flow. The claim is released back to pending so the worker re-claims
 * and processes the event exactly once; a queue failure keeps the row due.
 */
@Injectable()
export class BillingOutboxReconciler {
  private readonly logger = new Logger(BillingOutboxReconciler.name);

  constructor(
    private readonly outbox: BillingOutboxRepository,
    @InjectQueue("billing-outbox") private readonly queue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    const leaseOwner = `billing-mail-reconciler:${randomUUID()}`;
    const events = await this.outbox.claimDueEvents(leaseOwner);
    for (const event of events) {
      try {
        await this.queue.add(
          "dispatch-billing-email",
          { eventId: event.id },
          {
            jobId: toBullMqJobId(`billing-email:${event.id}`),
            attempts: 3,
            backoff: { type: "exponential", delay: 2_000 },
          },
        );
        await this.outbox.releaseClaim(event.id, leaseOwner);
      } catch (error) {
        await this.outbox.releaseForRetry(
          event.id,
          leaseOwner,
          error instanceof Error ? error.message : "Unknown queue error",
        );
        this.logger.error(
          `Billing outbox event ${event.id} could not be queued: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }
  }
}

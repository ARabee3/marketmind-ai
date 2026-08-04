import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";

interface OutboxJobData {
  eventId: string;
}

@Processor("content-outbox")
@Injectable()
export class OutboxDispatcher extends WorkerHost {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly candidateRepo: PublicationCandidateRepository,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @Optional()
    @InjectQueue("content-outbox")
    private readonly outboxQueue?: Queue,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    const { eventId } = job.data;

    this.logger.log(`Processing outbox event: ${eventId}`);

    const leaseOwner = `publication-worker:${String(job.id ?? randomUUID())}`;
    const event = this.candidateRepo.claimOutboxByEventId
      ? await this.candidateRepo.claimOutboxByEventId(eventId, leaseOwner)
      : await this.candidateRepo.getOutboxEventById(eventId);

    if (!event || event.state !== "pending") {
      this.logger.warn(`Event ${eventId} not found or not pending`);
      return;
    }

    const webhookUrl = this.configService.get<string>("AUTOMATION_WEBHOOK_URL");

    if (!webhookUrl) {
      this.logger.log(
        `No AUTOMATION_WEBHOOK_URL configured for event ${eventId}; leaving pending`,
      );
      if (this.candidateRepo.releaseOutboxClaim) {
        await this.candidateRepo.releaseOutboxClaim(eventId, leaseOwner);
      }
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, event.payload, {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            "X-Event-Id": event.eventId,
            "X-Event-Type": event.eventType,
          },
        }),
      );

      if (this.candidateRepo.claimOutboxByEventId) {
        await this.candidateRepo.markOutboxDispatched(eventId, leaseOwner);
      } else {
        await this.candidateRepo.markOutboxDispatched(eventId);
      }
      this.logger.log(`Event ${eventId} dispatched successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to dispatch event ${eventId}: ${errorMessage}`);
      if (this.candidateRepo.claimOutboxByEventId) {
        await this.candidateRepo.markOutboxFailed(
          eventId,
          errorMessage,
          leaseOwner,
        );
      } else {
        await this.candidateRepo.markOutboxFailed(eventId, errorMessage);
      }
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    if (!this.candidateRepo.claimDueOutboxEvents || !this.outboxQueue) return;
    const leaseOwner = `publication-reconciler:${randomUUID()}`;
    const events = await this.candidateRepo.claimDueOutboxEvents(
      leaseOwner,
      50,
    );
    for (const event of events) {
      try {
        await this.outboxQueue.add(
          "dispatch-outbox",
          { eventId: event.eventId },
          {
            jobId: `dispatch-outbox:${event.eventId}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 2_000 },
          },
        );
        await this.candidateRepo.releaseOutboxClaim(event.eventId, leaseOwner);
      } catch (error) {
        await this.candidateRepo.releaseOutboxClaim(
          event.eventId,
          leaseOwner,
          error instanceof Error ? error.message : "Unknown queue error",
        );
        this.logger.error(
          `Publication event ${event.eventId} could not be queued: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }
    }
  }
}

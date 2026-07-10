import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { ProviderError } from "../../common/errors/provider-error";

export type DiscoveryResearchJobData = {
  readonly session_id: string;
};

/**
 * Produces jobs onto the discovery-research BullMQ queue.
 *
 * Uses the session UUID as jobId to prevent duplicate research jobs.
 * Jobs retry 3 times with exponential backoff and bounded retention.
 */
@Injectable()
export class DiscoveryQueueProducer implements OnModuleDestroy {
  private readonly queue: Queue<DiscoveryResearchJobData>;

  constructor(private readonly config: ConfigService) {
    const redisUrl =
      this.config.get<string>("redis.url") || "redis://localhost:6379";
    this.queue = new Queue<DiscoveryResearchJobData>("discovery-research", {
      connection: { url: redisUrl },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }

  /**
   * Enqueue a discovery research job for the given session.
   * The session UUID is used as the jobId to deduplicate.
   */
  async enqueueResearch(sessionId: string): Promise<void> {
    try {
      await this.queue.add(
        "research",
        { session_id: sessionId },
        { jobId: sessionId },
      );
    } catch (error) {
      throw new ProviderError(
        "DISCOVERY_ENQUEUE_FAILED",
        error instanceof Error
          ? error.message
          : "Failed to enqueue discovery research",
        true,
      );
    }
  }

  getQueue(): Queue<DiscoveryResearchJobData> {
    return this.queue;
  }
}

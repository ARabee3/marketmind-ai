import { Module } from "@nestjs/common";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";
import { DiscoveryQueueWorker } from "./discovery-queue.worker";
import { DiscoveryResearchProcessor } from "./discovery-research.processor";

/**
 * DiscoveryQueueModule registers the BullMQ queue and worker for
 * discovery research jobs.
 *
 * The producer enqueues jobs using the session UUID as the jobId.
 * The worker processes jobs with configurable concurrency and retry policy.
 */
@Module({
  providers: [
    DiscoveryQueueProducer,
    DiscoveryQueueWorker,
    DiscoveryResearchProcessor,
  ],
  exports: [DiscoveryQueueProducer],
})
export class DiscoveryQueueModule {}

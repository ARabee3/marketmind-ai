import { Module } from "@nestjs/common";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";

/**
 * DiscoveryQueueModule registers the BullMQ queue producer.
 *
 * Kept minimal to avoid circular dependencies with DiscoveryModule.
 * The worker and processor are registered in DiscoveryModule where
 * all discovery repositories and services are available.
 */
@Module({
  providers: [DiscoveryQueueProducer],
  exports: [DiscoveryQueueProducer],
})
export class DiscoveryQueueModule {}

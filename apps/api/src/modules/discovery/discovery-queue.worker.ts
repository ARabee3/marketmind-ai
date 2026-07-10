import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker } from "bullmq";
import { DiscoveryResearchProcessor } from "./discovery-research.processor";
import {
  DiscoveryQueueProducer,
  DiscoveryResearchJobData,
} from "./discovery-queue.producer";

/**
 * BullMQ worker for the discovery-research queue.
 *
 * Runs inside the NestJS process when DISCOVERY_WORKER_ENABLED is true.
 * Controlled concurrency (default 2), bounded retention, and retry-safe.
 */
@Injectable()
export class DiscoveryQueueWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryQueueWorker.name);
  private worker: Worker<DiscoveryResearchJobData> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly producer: DiscoveryQueueProducer,
    private readonly processor: DiscoveryResearchProcessor,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get<boolean>("discovery.workerEnabled") ?? true;
    if (!enabled) {
      this.logger.log(
        "Discovery worker is disabled (DISCOVERY_WORKER_ENABLED=false)",
      );
      return;
    }

    const concurrency =
      this.config.get<number>("discovery.workerConcurrency") ?? 2;
    const redisUrl =
      this.config.get<string>("redis.url") || "redis://localhost:6379";

    this.worker = new Worker<DiscoveryResearchJobData>(
      "discovery-research",
      async (job: Job<DiscoveryResearchJobData>) => {
        const attempts = job.opts.attempts ?? 3;
        const attemptNumber = (job.attemptsMade ?? 0) + 1;
        this.logger.log(
          `Processing discovery research job ${job.id} (attempt ${attemptNumber}/${attempts})`,
        );
        await this.processor.process(job.data.session_id, attemptNumber, attempts);
      },
      {
        connection: { url: redisUrl },
        concurrency,
      },
    );

    this.worker.on("completed", (job) => {
      this.logger.log(`Discovery research job ${job.id} completed`);
    });

    this.worker.on("failed", (job, err) => {
      this.logger.error(
        `Discovery research job ${job?.id} failed: ${err.message}`,
      );
    });
  }

  onModuleDestroy(): void {
    this.worker?.close();
    this.worker = null;
  }
}

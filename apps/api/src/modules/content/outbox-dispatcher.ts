import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PublicationCandidateRepository } from './repositories/publication-candidate.repository';

interface OutboxJobData {
  eventId: string;
}

@Processor('content-outbox')
@Injectable()
export class OutboxDispatcher extends WorkerHost {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    private readonly candidateRepo: PublicationCandidateRepository,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    const { eventId } = job.data;

    this.logger.log(`Processing outbox event: ${eventId}`);

    const event = await this.candidateRepo.getOutboxEventById(eventId);

    if (!event || event.state !== "pending") {
      this.logger.warn(`Event ${eventId} not found or not pending`);
      return;
    }

    const webhookUrl = this.configService.get<string>('AUTOMATION_WEBHOOK_URL');

    if (!webhookUrl) {
      this.logger.log(
        `No AUTOMATION_WEBHOOK_URL configured for event ${eventId}; leaving pending`,
      );
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, event.payload, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Id': event.eventId,
            'X-Event-Type': event.eventType,
          },
        }),
      );

      await this.candidateRepo.markOutboxDispatched(eventId);
      this.logger.log(`Event ${eventId} dispatched successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to dispatch event ${eventId}: ${errorMessage}`);
      await this.candidateRepo.markOutboxFailed(eventId, errorMessage);
      throw error;
    }
  }
}

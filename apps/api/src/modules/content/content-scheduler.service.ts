import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentService } from "./content.service";

@Injectable()
export class ContentScheduler {
  private readonly logger = new Logger(ContentScheduler.name);

  constructor(
    private readonly cycleRepository: ContentCycleRepository,
    private readonly contentService: ContentService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async progressWeeks(): Promise<void> {
    const readyCycles = await this.cycleRepository.listActiveReadyForNextWeek();

    for (const cycle of readyCycles) {
      const nextWeek = cycle.currentWeekNumber + 1;
      const correlationId = randomUUID();

      try {
        await this.contentService.generateWeek(
          cycle.id,
          nextWeek,
          {
            content_cycle_id: cycle.id,
            week_number: nextWeek,
            idempotency_key: `scheduler:${cycle.id}:week:${nextWeek}`,
          },
          // The scheduler acts as a system worker, not a user. It passes the
          // cycle owner's user ID to preserve the ownership invariant inside
          // getCycleByIdAndOwner — future refactors that add system-only
          // service methods must still verify the cycle belongs to its owner.
          cycle.ownerUserId,
        );
        this.logger.log(
          `Scheduled week ${nextWeek} for cycle ${cycle.id} (correlation_id=${correlationId})`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to schedule week ${nextWeek} for cycle ${cycle.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}

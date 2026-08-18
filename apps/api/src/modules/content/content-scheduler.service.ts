import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";

/**
 * Content V2 owner-first weekly rollover (issue #240).
 *
 * Every five minutes this cron advances the actionable cursor for active
 * content-v2 cycles whose current week has elapsed its generation cutoff.
 * It does NOT generate content: the owner plans and explicitly generates each
 * week through the V2 studio. Crossing the cutoff only advances the cursor
 * and prepares the next week's structural context row so the owner can plan.
 *
 * `ScheduleModule.forRoot()` is registered exactly once at the application
 * root, so this handler fires a single time per tick inside one API process.
 */
@Injectable()
export class ContentScheduler {
  private readonly logger = new Logger(ContentScheduler.name);

  constructor(private readonly cycleRepository: ContentCycleRepository) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async progressWeeks(): Promise<void> {
    const readyCycles = await this.cycleRepository.listActiveReadyForNextWeek();

    for (const cycle of readyCycles) {
      const correlationId = randomUUID();

      try {
        const result = await this.cycleRepository.advanceToNextWeek(
          cycle.id,
          cycle.currentWeekNumber,
        );
        if (result.advanced) {
          this.logger.log(
            `Rolled over cycle ${cycle.id} to actionable week ${result.nextWeekNumber} (correlation_id=${correlationId})`,
          );
        } else if (result.completed) {
          this.logger.log(
            `Completed cycle ${cycle.id} after week 12 (correlation_id=${correlationId})`,
          );
        }
        // A concurrent tick that already advanced the cycle returns
        // advanced=false / completed=false; nothing to log.
      } catch (error) {
        this.logger.error(
          `Failed to roll over cycle ${cycle.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}

import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

/**
 * HealthModule exposes the /api/v1/health endpoint.
 *
 * Checks database, Redis, and BullMQ queue readiness.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}

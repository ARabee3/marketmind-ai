import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

/**
 * HealthModule exposes the /api/v1/health endpoint.
 *
 * Sprint 1: simple healthy response.
 * Later: can add database, Redis, BullMQ, AI service, and Qdrant checks.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}

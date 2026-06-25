import { Controller, Get } from "@nestjs/common";

/**
 * Health endpoint controller.
 *
 * GET /api/v1/health — returns a simple healthy response.
 * Does not require authentication.
 * Does not check database, Redis, or AI service status yet.
 */
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "marketmind-api",
    };
  }
}

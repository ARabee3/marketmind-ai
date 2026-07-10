import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { RedisService } from "../redis/redis.service";

export type HealthCheckResult = {
  status: "up" | "down";
  error?: string;
};

export type HealthCheckResponse = {
  status: "healthy" | "unhealthy";
  timestamp: string;
  service: string;
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
    queue: HealthCheckResult;
  };
};

/**
 * Health endpoint controller.
 *
 * GET /api/v1/health — returns overall service health and dependency status.
 * Checks database, Redis, and queue readiness.
 */
@Controller("health")
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthCheckResponse> {
    const database = await this.checkDatabase();
    const redis = await this.checkRedis();
    const queue = redis.status === "up" ? redis : { status: "down" as const, error: redis.error };

    const allUp = database.status === "up" && redis.status === "up" && queue.status === "up";

    return {
      status: allUp ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      service: "marketmind-api",
      checks: { database, redis, queue },
    };
  }

  private async checkDatabase(): Promise<HealthCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "up" };
    } catch (error) {
      return { status: "down", error: (error as Error).message };
    }
  }

  private async checkRedis(): Promise<HealthCheckResult> {
    const ok = await this.redis.ping();
    return ok ? { status: "up" } : { status: "down", error: "Redis did not respond to PING" };
  }
}

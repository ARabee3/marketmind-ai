import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * PrismaService wraps PrismaClient for NestJS lifecycle integration.
 *
 * Handles connection/disconnection with the NestJS application lifecycle.
 * All modules that need database access should inject PrismaService.
 *
 * During development, if PostgreSQL is not running, the service logs a
 * warning but does not crash the application. This allows the health
 * endpoint and other non-database features to work standalone.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("Connected to PostgreSQL");
    } catch (error) {
      this.logger.warn(
        "Could not connect to PostgreSQL. Database features will not work. " +
          "Start PostgreSQL with: docker compose -f infra/docker/docker-compose.local.yml up -d",
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

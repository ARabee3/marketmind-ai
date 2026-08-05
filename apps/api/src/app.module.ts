import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { BullModule } from "@nestjs/bullmq";
import { configuration } from "./config/configuration";
import { envSchema } from "./config/env.schema";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { RbacModule } from "./modules/rbac/rbac.module";
import { DiscoveryModule } from "./modules/discovery/discovery.module";
import { JourneyModule } from "./modules/journey/journey.module";
import { MarketingKnowledgeModule } from "./modules/marketing-knowledge/marketing-knowledge.module";
import { RedisModule } from "./modules/redis/redis.module";
import { MailModule } from "./modules/mail/mail.module";
import { PrismaModule } from "./common/persistence/prisma.module";

import { AppController } from "./app.controller";
import { StrategyModule } from './modules/strategy/strategy.module';
import { ContentModule } from './modules/content/content.module';
import { PublishingModule } from './modules/publishing/publishing.module';

@Module({
  imports: [
    // Environment configuration — validates env vars at startup
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: envSchema,
    }),

    // Database
    PrismaModule,

    // Rate limiting — default global guard; auth endpoints override with stricter limits
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60000,
        limit: 100,
      },
    ]),

    // BullMQ — shared Redis connection for all queues
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('redis.url') || 'redis://localhost:6379',
        },
      }),
    }),

    // Infrastructure
    RedisModule,
    MailModule,

    // Feature modules
    HealthModule,
    AuthModule,
    UsersModule,
    RbacModule,
    DiscoveryModule,
    JourneyModule,
    MarketingKnowledgeModule,
    StrategyModule,
    ContentModule,
    PublishingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

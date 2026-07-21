import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
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
  ],
  controllers: [AppController],
})
export class AppModule {}

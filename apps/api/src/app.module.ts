import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { configuration } from "./config/configuration";
import { envSchema } from "./config/env.schema";
import { HealthModule } from "./modules/health/health.module";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { RbacModule } from "./modules/rbac/rbac.module";
import { DiscoveryModule } from "./modules/discovery/discovery.module";
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

    // Feature modules
    HealthModule,
    AuthModule,
    UsersModule,
    RbacModule,
    DiscoveryModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

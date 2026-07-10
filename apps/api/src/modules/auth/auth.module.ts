import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule } from "@nestjs/config";

import { PrismaModule } from "../../common/persistence/prisma.module";
import { RedisModule } from "../redis/redis.module";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { ActionTokenService } from "./action-token.service";
import { FederatedIdentityService } from "./federated-identity.service";
import { AuthRateLimiterService } from "./auth-rate-limiter.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtRefreshStrategy } from "./strategies/jwt-refresh.strategy";

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
    PrismaModule,
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    ActionTokenService,
    FederatedIdentityService,
    AuthRateLimiterService,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
  exports: [
    AuthService,
    ActionTokenService,
    FederatedIdentityService,
    AuthRateLimiterService,
  ],
})
export class AuthModule {}

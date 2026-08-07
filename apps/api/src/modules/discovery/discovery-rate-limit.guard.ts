import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { externalProviderConfig } from "../../common/config/external-provider.config";
import { DiscoveryRedisLimiterService } from "./discovery-redis-limiter.service";

type RequestWithUser = Request & {
  readonly user?: AuthenticatedUser;
};

/**
 * Rate-limit guard for Discovery POST endpoints.
 *
 * Uses an atomic Redis counter to enforce 20 POSTs per minute
 * per owner and route. Replaces the previous in-memory Map.
 */
@Injectable()
export class DiscoveryRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: DiscoveryRedisLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.method !== "POST") {
      return true;
    }

    const ownerKey = request.user?.id ?? request.ip ?? "anonymous";
    const routeKey = request.route?.path ?? request.path;
    const isVoiceTranscription =
      routeKey === "/discovery/:sessionId/transcribe";
    const allowed = isVoiceTranscription
      ? await this.limiter.checkLimit(
          ownerKey,
          routeKey,
          externalProviderConfig().voiceTranscription.rateLimitPerMinute,
        )
      : await this.limiter.checkLimit(ownerKey, routeKey);

    if (!allowed) {
      throw new HttpException(
        {
          code: isVoiceTranscription
            ? "DISCOVERY_TRANSCRIPTION_RATE_LIMITED"
            : "DISCOVERY_RATE_LIMITED",
          message: "Too many discovery requests",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request } from "express";
import { AuthenticatedUser } from "../auth/interfaces/jwt-payload.interface";
import { RedisService } from "../redis/redis.service";

type RequestWithUser = Request & {
  readonly user?: AuthenticatedUser;
};

const WINDOW_SECONDS = 60;

/**
 * Per-route POST rate limits. Generation, decisions, and retry have
 * significantly higher provider cost than brief updates, so they get a
 * tighter bound. GET requests are exempt.
 */
const LIMITS: Record<string, number> = {
  generate: 5,
  decisions: 10,
  retry: 5,
};

const DEFAULT_POST_LIMIT = 20;

/**
 * Rate-limit guard for Strategy POST endpoints.
 *
 * Uses an atomic Redis counter to enforce per-owner POST limits per minute,
 * scoped by route. Generation and retry are capped at 5/min because each
 * request triggers FastAPI retrieval/generation calls with real provider
 * cost. Decisions are capped at 10/min. Other POSTs default to 20/min. GET
 * requests pass through unthrottled.
 *
 * Mirrors the Discovery rate-limit pattern (DiscoveryRateLimitGuard +
 * DiscoveryRedisLimiterService) but uses a strategy-specific Redis key
 * namespace so the budgets are independent.
 */
@Injectable()
export class StrategyRateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.method !== "POST") {
      return true;
    }

    const ownerKey = request.user?.id ?? request.ip ?? "anonymous";
    const routeKey = this.routeKey(request.path);
    const limit = LIMITS[routeKey] ?? DEFAULT_POST_LIMIT;

    const key = `rate:strategy:${ownerKey}:${routeKey}`;
    const client = this.redis.getClient();

    const pipeline = client.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, WINDOW_SECONDS, "NX");
    const results = await pipeline.exec();

    if (!results) {
      // Pipeline failed; be permissive to avoid blocking legitimate traffic.
      return true;
    }

    const [incrResult] = results;
    const count = incrResult[1] as number;

    if (count > limit) {
      throw new HttpException(
        {
          code: "STRATEGY_RATE_LIMITED",
          message: "Too many strategy requests. Please wait a moment.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private routeKey(path: string): string {
    if (path.endsWith("/generate")) return "generate";
    if (path.endsWith("/decisions")) return "decisions";
    if (path.endsWith("/retry")) return "retry";
    return "default";
  }
}
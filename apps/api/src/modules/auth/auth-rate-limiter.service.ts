import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

/**
 * Per-action rate limit configuration.
 *
 * Actions not listed here fall back to the DEFAULT_LIMIT.
 */
const ACTION_LIMITS: Record<
  string,
  { maxAttempts: number; windowSeconds: number }
> = {
  login: { maxAttempts: 5, windowSeconds: 900 }, // 5 per 15 min
  "password-reset": { maxAttempts: 3, windowSeconds: 900 }, // 3 per 15 min
  "verify-email": { maxAttempts: 3, windowSeconds: 3600 }, // 3 per hour
  register: { maxAttempts: 5, windowSeconds: 3600 }, // 5 per hour
};

const DEFAULT_LIMIT = { maxAttempts: 10, windowSeconds: 60 };

/**
 * Reusable Redis-backed rate limiter for auth-related actions.
 *
 * Uses the same atomic INCR + EXPIRE NX pipeline pattern established by
 * DiscoveryRedisLimiterService, but with a separate key namespace:
 *
 *   rate:auth:{action}:{identifier}
 *
 * This ensures complete isolation from Discovery keys (rate:discovery:*).
 */
@Injectable()
export class AuthRateLimiterService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Check whether a request is within the rate limit.
   *
   * @param action     - The rate-limited action (e.g. 'login', 'password-reset').
   * @param identifier - The entity being limited (e.g. email, userId, IP).
   * @returns true if allowed, false if limit exceeded.
   */
  async checkLimit(action: string, identifier: string): Promise<boolean> {
    const { maxAttempts, windowSeconds } =
      ACTION_LIMITS[action] ?? DEFAULT_LIMIT;
    const key = this.buildKey(action, identifier);
    const client = this.redis.getClient();

    const pipeline = client.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, windowSeconds, "NX");
    const results = await pipeline.exec();

    if (!results) {
      // Pipeline failed; be permissive to avoid blocking legitimate traffic.
      return true;
    }

    const [incrResult] = results;
    const count = incrResult[1] as number;

    return count <= maxAttempts;
  }

  /**
   * Build the Redis key.
   *
   * Uses the `rate:auth:` prefix to isolate from Discovery rate-limit keys
   * which use `rate:discovery:`.
   */
  private buildKey(action: string, identifier: string): string {
    return `rate:auth:${action}:${identifier}`;
  }
}

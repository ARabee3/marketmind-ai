import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

const WINDOW_SECONDS = 60;
const MAX_POSTS_PER_WINDOW = 20;

/**
 * Atomic Redis-backed rate limiter for Discovery POST endpoints.
 *
 * Enforces 20 POSTs per minute per owner and route using Redis INCR + EXPIRE.
 * Safe under concurrent requests and distributed deployment.
 */
@Injectable()
export class DiscoveryRedisLimiterService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Check whether a request is within the rate limit.
   *
   * @returns true if allowed, false if limit exceeded.
   */
  async checkLimit(ownerId: string, route: string): Promise<boolean> {
    const key = this.buildKey(ownerId, route);
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

    return count <= MAX_POSTS_PER_WINDOW;
  }

  private buildKey(ownerId: string, route: string): string {
    return `rate:discovery:${ownerId}:${route}`;
  }
}

import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";

import { RedisService } from "../redis/redis.service";

interface StoredFacebookSession {
  readonly userId: string;
}

/**
 * Shared, single-use storage for the Facebook popup handshake.
 *
 * OAuth callbacks may land on a different API instance than the one that
 * opened the dialog. Keeping both the browser start session and Graph state
 * in Redis makes the handshake restart-safe and prevents a state token from
 * being replayed after it has been consumed. The values are opaque nonces;
 * no Facebook credential is ever stored here.
 */
@Injectable()
export class FacebookOAuthStateStore {
  private readonly logger = new Logger(FacebookOAuthStateStore.name);
  private readonly ttlSeconds = 10 * 60;
  private readonly startPrefix = "facebook:oauth:start:";
  private readonly statePrefix = "facebook:oauth:state:";

  constructor(private readonly redis: RedisService) {}

  async createStartSession(userId: string): Promise<string> {
    return this.create(this.startPrefix, userId);
  }

  async consumeStartSession(token: string | undefined): Promise<string | null> {
    return this.consume(this.startPrefix, token);
  }

  async createOAuthState(userId: string): Promise<string> {
    return this.create(this.statePrefix, userId);
  }

  async consumeOAuthState(state: string | undefined): Promise<string | null> {
    return this.consume(this.statePrefix, state);
  }

  private async create(prefix: string, userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    const payload: StoredFacebookSession = { userId };
    await this.redis
      .getClient()
      .setex(`${prefix}${token}`, this.ttlSeconds, JSON.stringify(payload));
    return token;
  }

  private async consume(
    prefix: string,
    token: string | undefined,
  ): Promise<string | null> {
    if (!token || token.length < 16) return null;

    // GETDEL is atomic: a callback and a replay cannot both resolve the same
    // user, even when they arrive concurrently on different API instances.
    const raw = await this.redis.getClient().getdel(`${prefix}${token}`);
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw) as Partial<StoredFacebookSession>;
      if (!payload.userId || typeof payload.userId !== "string") return null;
      return payload.userId;
    } catch {
      this.logger.warn("Facebook OAuth state payload was malformed");
      return null;
    }
  }
}

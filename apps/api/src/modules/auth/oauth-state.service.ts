import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "node:crypto";

import { RedisService } from "../redis/redis.service";
import { OAuthException } from "./exceptions/oauth.exception";

/**
 * Payload stored alongside an OAuth state nonce in Redis.
 */
export interface OAuthStatePayload {
  /** Provider identifier, e.g. "google". */
  provider: string;
  /** Optional client fingerprint (IP + user-agent hash) for extra binding. */
  fingerprint?: string;
}

/**
 * OAuth state parameter management.
 *
 * Generates a cryptographically random nonce, stores it in Redis with a
 * short TTL, and consumes it atomically during the provider callback.
 * This prevents CSRF/replay attacks against the OAuth callback endpoint.
 */
@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly keyPrefix = "oauth:state:";
  private readonly ttlSeconds = 600; // 10 minutes

  constructor(private readonly redis: RedisService) {}

  /**
   * Create and persist a new OAuth state nonce.
   *
   * @param provider    - Provider slug, e.g. "google".
   * @param fingerprint - Optional fingerprint to bind the state to a client.
   * @returns The raw state string to pass to the OAuth provider.
   */
  async createState(
    provider: string,
    fingerprint?: string,
  ): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    const payload: OAuthStatePayload = { provider, fingerprint };

    await this.redis
      .getClient()
      .setex(`${this.keyPrefix}${state}`, this.ttlSeconds, JSON.stringify(payload));

    this.logger.debug(`Created OAuth state for provider ${provider}`);
    return state;
  }

  /**
   * Validate and consume an OAuth state nonce.
   *
   * The state is retrieved and deleted with Redis GETDEL. If the state
   * is missing, expired, malformed, or bound to a different fingerprint,
   * an OAuthException with code OAUTH_STATE_MISMATCH is thrown.
   *
   * @param state       - The state value from the callback query string.
   * @param fingerprint - Optional fingerprint to verify against the stored value.
   * @returns The stored payload (provider and optional fingerprint).
   */
  async consumeState(
    state: string | undefined,
    fingerprint?: string,
  ): Promise<OAuthStatePayload> {
    if (!state || state.length < 16) {
      throw new OAuthException(
        "OAUTH_STATE_MISMATCH",
        "Invalid or missing OAuth state",
      );
    }

    const key = `${this.keyPrefix}${state}`;
    // GETDEL is atomic in Redis, so a state nonce can only be consumed once.
    const raw = await this.redis.getClient().getdel(key);

    if (!raw) {
      this.logger.warn("OAuth state missing or expired");
      throw new OAuthException(
        "OAUTH_STATE_MISMATCH",
        "OAuth state missing or expired",
      );
    }

    let payload: OAuthStatePayload;
    try {
      payload = JSON.parse(raw as string) as OAuthStatePayload;
    } catch {
      this.logger.warn("OAuth state payload is corrupted");
      throw new OAuthException(
        "OAUTH_STATE_MISMATCH",
        "OAuth state corrupted",
      );
    }

    if (fingerprint && payload.fingerprint && fingerprint !== payload.fingerprint) {
      this.logger.warn("OAuth state fingerprint mismatch");
      throw new OAuthException(
        "OAUTH_STATE_MISMATCH",
        "OAuth state fingerprint mismatch",
      );
    }

    return payload;
  }
}

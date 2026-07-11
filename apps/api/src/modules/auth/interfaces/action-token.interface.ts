/**
 * Action token types and service contracts.
 *
 * Exported for use by password recovery (S3-2) and email verification flows.
 * The raw token is a 64-character hex string (32 random bytes); only its
 * SHA-256 hash is persisted.
 */

import { ActionTokenType } from "@prisma/client";

export { ActionTokenType };

/** Returned to the caller (e.g. email service) — contains the raw token. */
export interface IssuedToken {
  /** 64-character hex-encoded raw token, safe to include in a URL. */
  rawToken: string;
  /** Absolute expiry timestamp. */
  expiresAt: Date;
}

/** ActionTokenService contract for S3-2 (recovery) and email verification. */
export interface IActionTokenService {
  /**
   * Issue a new action token. Invalidates any existing unconsumed tokens
   * of the same (userId, type) pair before creating the new one.
   */
  issue(userId: string, type: ActionTokenType): Promise<IssuedToken>;

  /**
   * Validate and consume a token in one atomic operation.
   * Returns the userId if valid; throws if expired, already consumed, or not found.
   */
  consume(rawToken: string, type: ActionTokenType): Promise<string>;
}

/** FederatedIdentityService contract for S3-3 (Google OAuth). */
export interface IFederatedIdentityService {
  /**
   * Find or create a federated identity link.
   * If the (provider, providerSubject) pair already exists, returns the
   * existing link. Otherwise, creates a new one for the given user.
   */
  findOrCreate(params: {
    userId: string;
    provider: string;
    providerSubject: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    rawProfile?: Record<string, unknown>;
  }): Promise<{ id: string; userId: string; isNew: boolean }>;

  /**
   * Look up a user by their federated identity.
   * Returns null if no link exists.
   */
  findByProvider(
    provider: string,
    providerSubject: string,
  ): Promise<{ userId: string; id: string } | null>;
}

/** AuthRateLimiterService contract. */
export interface IAuthRateLimiter {
  /**
   * Check if the action is within rate limits.
   * @returns true if allowed, false if limit exceeded.
   */
  checkLimit(action: string, identifier: string): Promise<boolean>;
}

import { Injectable, Logger } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { ActionTokenType } from "@prisma/client";

import { PrismaService } from "../../common/persistence/prisma.service";
import type { IssuedToken } from "./interfaces/action-token.interface";

/**
 * Expiry durations by token type.
 *
 * PASSWORD_RESET:      30 minutes — short-lived to limit attack window.
 * EMAIL_VERIFICATION:  12 hours   — generous for email delivery delays.
 */
const EXPIRY_MS: Record<ActionTokenType, number> = {
  [ActionTokenType.PASSWORD_RESET]: 30 * 60 * 1000,
  [ActionTokenType.EMAIL_VERIFICATION]: 12 * 60 * 60 * 1000,
};

@Injectable()
export class ActionTokenService {
  private readonly logger = new Logger(ActionTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issue a new action token.
   *
   * 1. Generates 32 cryptographically random bytes (64 hex chars).
   * 2. Computes SHA-256 hash for storage — the raw token is NEVER persisted.
   * 3. Invalidates all existing unconsumed tokens of the same (userId, type).
   * 4. Persists the hash with the correct expiry.
   * 5. Returns the raw token (for embedding in a URL sent via email).
   */
  async issue(userId: string, type: ActionTokenType): Promise<IssuedToken> {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + EXPIRY_MS[type]);

    // Invalidate all existing unconsumed tokens of the same (userId, type)
    // before creating the new one. This ensures reissue invalidation.
    await this.prisma.$transaction([
      this.prisma.actionToken.updateMany({
        where: {
          userId,
          type,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      }),
      this.prisma.actionToken.create({
        data: {
          userId,
          type,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    this.logger.log(
      `Issued ${type} token for user ${userId}, expires at ${expiresAt.toISOString()}`,
    );

    return { rawToken, expiresAt };
  }

  /**
   * Validate and consume a token in one atomic operation.
   *
   * 1. Hashes the incoming raw token with SHA-256.
   * 2. Looks up by (tokenHash, type).
   * 3. Rejects if not found, expired, or already consumed.
   * 4. Atomically sets consumedAt to prevent replay.
   * 5. Returns the userId associated with the token.
   */
  async consume(rawToken: string, type: ActionTokenType): Promise<string> {
    const tokenHash = this.hashToken(rawToken);

    const token = await this.prisma.actionToken.findUnique({
      where: { tokenHash },
    });

    if (!token) {
      throw new ActionTokenError("ACTION_TOKEN_INVALID", "Token not found");
    }

    if (token.type !== type) {
      throw new ActionTokenError("ACTION_TOKEN_INVALID", "Token type mismatch");
    }

    if (token.consumedAt) {
      throw new ActionTokenError(
        "ACTION_TOKEN_CONSUMED",
        "Token has already been used",
      );
    }

    if (token.expiresAt < new Date()) {
      throw new ActionTokenError("ACTION_TOKEN_EXPIRED", "Token has expired");
    }

    // Atomically mark as consumed
    await this.prisma.actionToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });

    this.logger.log(`Consumed ${type} token for user ${token.userId}`);
    return token.userId;
  }

  /**
   * SHA-256 hash of a raw token string.
   *
   * Action tokens are high-entropy random values (256 bits), so SHA-256 is
   * sufficient — bcrypt's deliberate slowness is unnecessary here.
   */
  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }
}

/**
 * Structured error thrown by ActionTokenService.
 *
 * The `code` field maps directly to error codes in @marketmind/contracts,
 * allowing controllers to return typed API error responses.
 */
export class ActionTokenError extends Error {
  constructor(
    public readonly code:
      | "ACTION_TOKEN_INVALID"
      | "ACTION_TOKEN_CONSUMED"
      | "ACTION_TOKEN_EXPIRED",
    message: string,
  ) {
    super(message);
    this.name = "ActionTokenError";
  }
}

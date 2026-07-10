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
   * Uses a serializable interactive transaction to guarantee that exactly
   * one unconsumed token exists per (userId, type) at any time — even under
   * concurrent reissue requests.
   *
   * 1. Generates 32 cryptographically random bytes (64 hex chars).
   * 2. Computes SHA-256 hash for storage — the raw token is NEVER persisted.
   * 3. Atomically invalidates all existing unconsumed tokens and creates the new one.
   * 4. Returns the raw token (for embedding in a URL sent via email).
   */
  async issue(userId: string, type: ActionTokenType): Promise<IssuedToken> {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + EXPIRY_MS[type]);

    // Interactive transaction with serializable isolation prevents two
    // concurrent issue() calls from both invalidating and then both
    // creating, which would leave two active tokens.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.actionToken.updateMany({
          where: {
            userId,
            type,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        });

        await tx.actionToken.create({
          data: {
            userId,
            type,
            tokenHash,
            expiresAt,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );

    this.logger.log(
      `Issued ${type} token for user ${userId}, expires at ${expiresAt.toISOString()}`,
    );

    return { rawToken, expiresAt };
  }

  /**
   * Validate and consume a token in a single atomic conditional update.
   *
   * Instead of read-then-update (which is vulnerable to concurrent
   * consumption), this uses updateMany with conditions that require the
   * token to be unconsumed, unexpired, and of the expected type. If zero
   * rows match, the token is invalid, already consumed, or expired.
   *
   * A follow-up findUnique determines the exact rejection reason for
   * the caller.
   */
  async consume(rawToken: string, type: ActionTokenType): Promise<string> {
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();

    // Single atomic conditional update: only succeeds if the token exists,
    // is unconsumed, unexpired, and has the expected type.
    const result = await this.prisma.actionToken.updateMany({
      where: {
        tokenHash,
        type,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });

    if (result.count === 1) {
      // Token was successfully consumed. Look up the userId.
      const token = await this.prisma.actionToken.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });

      this.logger.log(`Consumed ${type} token for user ${token!.userId}`);
      return token!.userId;
    }

    // Zero rows updated — determine the exact reason for a helpful error.
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

    if (token.expiresAt <= now) {
      throw new ActionTokenError("ACTION_TOKEN_EXPIRED", "Token has expired");
    }

    // Fallback — should not be reachable, but safe default.
    throw new ActionTokenError("ACTION_TOKEN_INVALID", "Token not found");
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

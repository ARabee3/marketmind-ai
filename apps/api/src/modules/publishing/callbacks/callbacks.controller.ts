import * as crypto from "crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Param,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

/** Max age for a signed callback before it is rejected as stale (§8 replay-window).
 *  Default matches configuration.ts; kept as a fallback only if config is absent. */
const DEFAULT_CALLBACK_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

interface N8nCallbackBody {
  attemptId: string;
  outcome: "published" | "exported" | "simulated" | "failed" | "unknown";
  nonce: string;
  timestamp: string;
  signature: string;
  kid?: string; // key id for rotation support
  executionId?: string;
  remotePublicationId?: string;
  errorCode?: string;
  retryable?: boolean;
}

/**
 * Inbound callback endpoint from n8n.
 *
 * Security pipeline (§8):
 * 1. Timestamp replay-window check (before any identity lookup)
 * 2. Constant-time HMAC-SHA256 signature verification
 * 3. Idempotency / replay logic via publishing_callback_identities
 * 4. Transactional result write + intent status update
 */
@Controller()
export class CallbacksController {
  private readonly logger = new Logger(CallbacksController.name);
  private readonly signingSecret: string;
  private readonly callbackWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.signingSecret = this.config.get<string>(
      "publishing.n8nSigningSecret",
      "",
    );
    this.callbackWindowMs = this.config.get<number>(
      "publishing.callbackWindowMs",
      DEFAULT_CALLBACK_WINDOW_MS,
    );
  }

  /** Public-facing path matches architecture doc §11 */
  @Post("internal/v1/publishing/dispatch/:attemptId/callback")
  @HttpCode(200)
  async handleCallback(
    @Param("attemptId") attemptId: string,
    @Body() body: N8nCallbackBody,
  ): Promise<{ ok: boolean }> {
    // ── Step 1: Replay-window check ─────────────────────────────────────────
    const payloadTs = new Date(body.timestamp);
    if (isNaN(payloadTs.getTime())) {
      throw new UnauthorizedException(
        PublishingErrorCode.WEBHOOK_TIMESTAMP_INVALID,
      );
    }
    const age = Math.abs(Date.now() - payloadTs.getTime());
    if (age > this.callbackWindowMs) {
      this.logger.warn(
        `Callback rejected: timestamp out of window (age=${age}ms)`,
      );
      throw new UnauthorizedException(
        PublishingErrorCode.WEBHOOK_TIMESTAMP_INVALID,
      );
    }

    // ── Step 2: Constant-time HMAC signature verification ───────────────────
    const canonicalString = [
      body.attemptId,
      body.outcome,
      body.nonce,
      body.timestamp,
    ].join(":");

    const expected = crypto
      .createHmac("sha256", this.signingSecret)
      .update(canonicalString)
      .digest();

    let actual: Buffer;
    try {
      actual = Buffer.from(body.signature, "hex");
    } catch {
      throw new UnauthorizedException(PublishingErrorCode.WEBHOOK_UNAUTHORIZED);
    }

    // timingSafeEqual requires same-length buffers — pad/truncate to prevent length oracle
    const safe =
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);

    if (!safe) {
      this.logger.warn(
        `Callback rejected: invalid HMAC signature for attempt=${attemptId}`,
      );
      throw new UnauthorizedException(PublishingErrorCode.WEBHOOK_UNAUTHORIZED);
    }

    // ── Step 3/4/5: Atomically resolve nonce + attempt + intent ─────────────
    // Idempotency is enforced inside the $transaction so the unique
    // external_callback_id insert is race-free with the replay lookup.
    const payloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");

    const intentId = await this.prisma.$transaction(async (tx) => {
      // ── Resolve attempt + intent (read-only) ─────────────────────────────
      const attempt = await tx.publishingAttempt.findUnique({
        where: { id: attemptId },
        include: { intent: true },
      });

      if (!attempt) {
        this.logger.warn(`Callback references unknown attempt=${attemptId}`);
        throw new BadRequestException(PublishingErrorCode.CALLBACK_INVALID);
      }

      // Check if this attempt is still the current one for this intent+version
      const latestAttempt = await tx.publishingAttempt.findFirst({
        where: { intentId: attempt.intentId },
        orderBy: [{ intentVersion: "desc" }, { attemptSequence: "desc" }],
      });
      const isSuperseded = latestAttempt?.id !== attempt.id;

      if (isSuperseded) {
        this.logger.warn(
          `Superseded-attempt callback: attempt=${attemptId} is no longer current for intent=${attempt.intentId} — recording for audit only`,
        );
      }

      // ── Nonce idempotency (race-safe on unique external_callback_id) ──────
      try {
        await tx.publishingCallbackIdentity.create({
          data: {
            attemptId,
            externalCallbackId: body.nonce,
            signatureValid: true,
            payloadHash,
            payloadTimestamp: payloadTs,
            outcome: this.mapOutcome(body.outcome),
          },
        });
      } catch (err) {
        // P2002: a concurrent handler already consumed this nonce.
        // (Check err.code rather than instanceof to stay robust across Prisma
        // versions and plain-object errors.)
        if ((err as { code?: string })?.code === "P2002") {
          const existing = await tx.publishingCallbackIdentity.findUnique({
            where: { externalCallbackId: body.nonce },
          });
          if (existing && existing.payloadHash === payloadHash) {
            this.logger.log(
              `Identical callback replay for nonce=${body.nonce} — returning 200 no-op`,
            );
            return ""; // idempotent replay — nothing to write
          }
          throw new ConflictException(PublishingErrorCode.CALLBACK_CONFLICT);
        }
        throw err;
      }

      // Map outcome (ambiguity → unknown, never force-mapped to success/failed)
      const outcome = this.mapOutcome(body.outcome);
      const intentNextStatus = isSuperseded
        ? null
        : this.outcomeToIntentStatus(outcome);

      // Write immutable result row
      const existingResult = await tx.publishingResult.findUnique({
        where: { attemptId },
      });
      if (!existingResult) {
        await tx.publishingResult.create({
          data: {
            attemptId,
            intentId: attempt.intentId,
            outcome: outcome as never,
            provider: "meta",
            remotePublicationId: body.remotePublicationId ?? null,
            // Never store remoteUrl if it may contain signed URLs — omit for now
            errorCode: body.errorCode ?? null,
            retryable: body.retryable ?? false,
            rawPayloadHash: payloadHash,
            occurredAt: payloadTs,
          },
        });
      }

      // Update attempt status — must stay consistent with intent status.
      const attemptStatus =
        outcome === "UNKNOWN"
          ? "UNKNOWN"
          : outcome === "FAILED"
            ? "FAILED"
            : "SUCCEEDED";
      await tx.publishingAttempt.update({
        where: { id: attemptId },
        data: { status: attemptStatus as never, finishedAt: new Date() },
      });

      // Only update intent status from the current (non-superseded) attempt
      if (intentNextStatus) {
        await tx.publishingIntent.update({
          where: { id: attempt.intentId },
          data: { status: intentNextStatus as never },
        });
      }

      return attempt.intentId;
    });

    if (intentId === "") {
      return { ok: true }; // idempotent replay, no write performed
    }

    this.logger.log(
      `Callback processed: attempt=${attemptId} outcome=${this.mapOutcome(body.outcome)}`,
    );
    return { ok: true };
  }

  /** Map provider outcome — ambiguity always → UNKNOWN, never guessed into PUBLISHED. */
  private mapOutcome(raw: string): string {
    switch (raw) {
      case "published":
        return "PUBLISHED";
      case "exported":
        return "EXPORTED";
      case "simulated":
        return "SIMULATED";
      case "failed":
        return "FAILED";
      case "unknown":
        return "UNKNOWN";
      default:
        this.logger.warn(
          `Unrecognized callback outcome "${raw}" — mapping to UNKNOWN`,
        );
        return "UNKNOWN";
    }
  }

  private outcomeToIntentStatus(outcome: string): string | null {
    switch (outcome) {
      case "PUBLISHED":
      case "EXPORTED":
      case "SIMULATED":
        return "SUCCEEDED";
      case "FAILED":
        return "FAILED";
      case "UNKNOWN":
        return "ACTION_REQUIRED";
      default:
        return null;
    }
  }
}

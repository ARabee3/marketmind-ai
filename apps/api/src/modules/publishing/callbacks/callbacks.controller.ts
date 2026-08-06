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
import { toPublicationAttemptV1 } from "../common/serializers";
import {
  computeCallbackFingerprint,
  publicationAttemptStateForOutcome,
  publicationIntentStateForOutcome,
  validatePublicationCallbackContext,
  type PublicationCallbackBodyV1,
  type PublicationResultV1,
  type PublishingValidationIssue,
  type SignedPublicationCallbackEnvelopeV1,
} from "@marketmind/contracts";

/**
 * Inbound callback endpoint from n8n.
 *
 * P1 (#119 review): the wire shape is the FROZEN
 * `SignedPublicationCallbackEnvelopeV1`, NOT a custom camelCase body. The
 * envelope signature (HMAC-SHA256 over the canonical envelope fields +
 * body_sha256) and the body shape are validated by the frozen contract. The
 * callback is then bound to the EXACT stored attempt via
 * {@link validatePublicationCallbackContext}: the signed `attempt_id`,
 * `intent_id`, `intent_version`, `request_fingerprint` (= the stored dispatch
 * body_sha256), and `workflow_version` must all match the accepted attempt. A
 * valid signature for attempt A therefore cannot mutate attempt B, and a
 * conflicting subsequent callback cannot split result/attempt/intent truth.
 *
 * Security pipeline (§8):
 *   1. reject route↔signed-attempt-id mismatch BEFORE any DB lookup;
 *   2. load the stored attempt + build the frozen PublicationAttemptV1;
 *   3. validatePublicationCallbackContext (signature, timestamp window, body
 *      shape, result identity, and exact-attempt binding);
 *   4. nonce (`callback_id`) idempotency on `publishing_callback_identities`
 *      (race-safe via the unique `external_callback_id` index);
 *   5. reject a conflicting subsequent callback before any state mutation;
 *   6. one immutable result row per attempt + transactional attempt/intent
 *      status transition.
 *
 * The canonical callback fingerprint (`computeCallbackFingerprint(body)`) is
 * persisted as the result `raw_payload_hash` so admin reconciliation can
 * reproduce the exact accepted callback.
 */
/**
 * Thrown inside the callback transaction when the unique
 * `external_callback_id` index detects a concurrent duplicate. Postgres has
 * already aborted the transaction at that point (25P02), so recovery reads
 * must happen outside it — this signal carries the conflicting id out.
 */
class CallbackIdentityDuplicateSignal extends Error {
  constructor(readonly callbackId: string) {
    super(`callback identity duplicate: ${callbackId}`);
    this.name = "CallbackIdentityDuplicateSignal";
  }
}

@Controller()
export class CallbacksController {
  private readonly logger = new Logger(CallbacksController.name);
  private readonly signingSecret: string;
  private readonly signingKeyId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.signingSecret = this.config.get<string>(
      "publishing.n8nSigningSecret",
      "",
    );
    this.signingKeyId = this.config.get<string>(
      "publishing.n8nSigningKeyId",
      "",
    );
  }

  /** Public-facing path matches architecture doc §11. */
  @Post("internal/v1/publishing/dispatch/:attemptId/callback")
  @HttpCode(200)
  async handleCallback(
    @Param("attemptId") attemptId: string,
    @Body() envelope: unknown,
  ): Promise<{ ok: boolean }> {
    // Fail closed on misconfiguration instead of accepting an unsigned body.
    if (!this.signingSecret || !this.signingKeyId) {
      this.logger.error(
        "Callback signing secret/key id is not configured — rejecting inbound callback",
      );
      throw new UnauthorizedException(PublishingErrorCode.WEBHOOK_UNAUTHORIZED);
    }

    // ── Step 1: route ↔ signed-attempt-id binding (before any DB lookup) ──
    // The signature binds `body.attempt_id`; the URL carries a separate
    // attemptId. Reject unless they match so a valid callback signed for
    // attempt A cannot be POSTed to attempt B's URL and mutate B.
    const signedBody = (envelope as { body?: PublicationCallbackBodyV1 })?.body;
    if (!signedBody || signedBody.attempt_id !== attemptId) {
      this.logger.warn(
        `Callback attemptId rebinding rejected: signed attemptId=${signedBody?.attempt_id} vs route attemptId=${attemptId}`,
      );
      throw new UnauthorizedException(PublishingErrorCode.WEBHOOK_UNAUTHORIZED);
    }

    const context = {
      secret: this.signingSecret,
      expected_key_id: this.signingKeyId,
      now: new Date().toISOString(),
    };

    // The canonical fingerprint of the frozen callback body — persisted as the
    // result `raw_payload_hash` and used to tell an identical replay from a
    // conflicting subsequent callback.
    const callbackFingerprint = computeCallbackFingerprint(signedBody);
    const sentAt = (envelope as { sent_at?: string })?.sent_at;
    const payloadTimestamp = sentAt ? new Date(sentAt) : new Date();

    // ── Steps 2–6: atomically resolve attempt + validate + persist ──────
    // P1 (#123): Serializable, in combination with the ordered `FOR UPDATE`
    // locks, makes the callback critical section unambiguous. Postgres
    // Serializable raises 40001 ("could not serialize access") whenever a
    // concurrent transaction commits a write to a row we read — most commonly
    // the worker's own acknowledgement tx (which writes the same attempt row)
    // finishing while a fast loopback/runner callback is in flight. That is a
    // transient conflict, not a validation failure: the aborted transaction
    // rolled back completely, so re-running it against a fresh snapshot is
    // safe and converges. The retry is bounded; genuine repeated conflicts
    // surface as 500s for admin investigation.
    let intentId: string;
    try {
      intentId = await this.withSerializationRetry(
        () =>
          this.prisma.$transaction(
            async (tx) => {
        // ── P1 (#123): pessimistic row locks in deterministic order ──────
        // (attempts → intents) BEFORE any read or mutation, so a concurrent
        // duplicate callback for the same attempt cannot interleave its
        // read between our lookup and our write. Prisma has no `FOR UPDATE`
        // helper — the lock is a raw SELECT that also validates existence.
        // Locking attempts before intents everywhere prevents circular waits
        // (deadlock) between two concurrent callbacks.
        await tx.$queryRaw`SELECT id FROM publishing_attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;

        // ── Resolve attempt + intent ───────────────────────────────────────
        const attempt = await tx.publishingAttempt.findUnique({
          where: { id: attemptId },
          include: { intent: true },
        });
        if (!attempt) {
          this.logger.warn(`Callback references unknown attempt=${attemptId}`);
          throw new BadRequestException(PublishingErrorCode.CALLBACK_INVALID);
        }

        // Lock the owning intent row (ordered after the attempt lock).
        await tx.$queryRaw`SELECT id FROM publishing_intents WHERE id = ${attempt.intentId}::uuid FOR UPDATE`;

      // Build the frozen PublicationAttemptV1 from the stored row so the
      // frozen validator can bind the signed callback to the EXACT accepted
      // attempt (attempt_id, intent_id, intent_version, request_fingerprint =
      // the stored dispatch body_sha256, and workflow_version).
      const attemptV1 = toPublicationAttemptV1(attempt);

      // ── Step 3: frozen context validation (signature, body, exact attempt)
      const validation = validatePublicationCallbackContext({
        envelope,
        attempt: attemptV1,
        context,
      });
      if (!validation.valid) {
        const issue = validation.issues[0];
        this.logger.warn(
          `Callback rejected for attempt=${attemptId}: ${issue?.code} ${issue?.field} ${issue?.message}`,
        );
        throw this.toException(issue);
      }

      const signed = envelope as SignedPublicationCallbackEnvelopeV1;
      const resultBody = signed.body.result as PublicationResultV1;
      const outcome = resultBody.outcome;

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

      // ── Step 4: nonce (callback_id) idempotency — race-safe on the unique
      // external_callback_id index ─────────────────────────────────────────
      try {
        await tx.publishingCallbackIdentity.create({
          data: {
            attemptId,
            externalCallbackId: signed.body.callback_id,
            signatureValid: true,
            payloadHash: callbackFingerprint,
            payloadTimestamp,
            outcome: outcome.toUpperCase(),
          },
        });
      } catch (err) {
        if ((err as { code?: string })?.code === "P2002") {
          // The unique index resolved a concurrent duplicate: the OTHER tx has
          // now committed its identity row (the insert blocks on the index
          // until that tx resolves). Postgres has aborted THIS transaction
          // (25P02) — any further query inside it fails, so bail out with a
          // signal and resolve replay-vs-conflict outside with a fresh read.
          throw new CallbackIdentityDuplicateSignal(signed.body.callback_id);
        }
        throw err;
      }

      // ── Step 5: reject a CONFLICTING subsequent callback before any state
      // mutation. The result row is immutable once written; a second signed
      // callback (different callback_id) for the same attempt is either an
      // identical replay (same canonical fingerprint → no-op, already handled
      // by the identity check above) or a conflicting callback that must NOT
      // overwrite the attempt/intent status beside the existing immutable
      // result (e.g. a late FAILED after a PUBLISHED result).
      const existingResult = await tx.publishingResult.findUnique({
        where: { attemptId },
      });
      if (existingResult) {
        if (existingResult.rawPayloadHash === callbackFingerprint) {
          this.logger.log(
            `Identical subsequent callback for attempt=${attemptId} — 200 no-op`,
          );
          return ""; // identical replay — do not mutate attempt/intent
        }
        this.logger.warn(
          `Conflicting subsequent callback for attempt=${attemptId}: existing outcome=${existingResult.outcome} vs new outcome=${outcome}`,
        );
        throw new ConflictException(PublishingErrorCode.CALLBACK_CONFLICT);
      }

      // ── Step 6: one immutable result row + transactional status transition
      const attemptState = publicationAttemptStateForOutcome(outcome);
      const intentState = publicationIntentStateForOutcome(outcome);

      await tx.publishingResult.create({
        data: {
          attemptId,
          intentId: attempt.intentId,
          outcome: outcome.toUpperCase() as never,
          provider: resultBody.provider,
          remotePublicationId: resultBody.remote_publication_id,
          remoteUrl: resultBody.remote_url,
          exportArtifactId: resultBody.export_artifact_id,
          simulationLabel: resultBody.simulation_label,
          errorCode: resultBody.error_code,
          retryable: resultBody.retryable,
          rawPayloadHash: callbackFingerprint,
          sanitizedError: null,
          occurredAt: new Date(resultBody.occurred_at),
        },
      });

      await tx.publishingAttempt.update({
        where: { id: attemptId },
        data: {
          status: attemptState.toUpperCase() as never,
          finishedAt: new Date(),
        },
      });

      // Only update intent status from the current (non-superseded) attempt.
      if (!isSuperseded) {
        await tx.publishingIntent.update({
          where: { id: attempt.intentId },
          data: { status: intentState.toUpperCase() as never },
        });
      }

      return attempt.intentId;
      },
      // P1 (#123): Serializable, in combination with the ordered
      // `FOR UPDATE` locks above, makes the callback critical section
      // unambiguous — two concurrent callbacks for the same attempt can
      // never both observe "no result row yet".
      { isolationLevel: "Serializable" },
    ),
      );
    } catch (err) {
      if (err instanceof CallbackIdentityDuplicateSignal) {
        // A concurrent callback with the SAME callback_id committed first.
        // By the time P2002 surfaced, that transaction has committed — resolve
        // replay-vs-conflict with a fresh read outside the aborted transaction.
        const existing = await this.prisma.publishingCallbackIdentity.findUnique(
          { where: { externalCallbackId: err.callbackId } },
        );
        if (existing && existing.payloadHash === callbackFingerprint) {
          this.logger.log(
            `Identical callback replay for callback_id=${err.callbackId} — returning 200 no-op`,
          );
          return { ok: true };
        }
        throw new ConflictException(PublishingErrorCode.CALLBACK_CONFLICT);
      }
      throw err;
    }

    if (intentId === "") {
      return { ok: true }; // idempotent replay, no write performed
    }

    this.logger.log(
      `Callback processed: attempt=${attemptId} outcome=${
        (signedBody as PublicationCallbackBodyV1).result.outcome
      }`,
    );
    return { ok: true };
  }

  /**
   * Runs the callback critical section, retrying transient Postgres
   * serialization failures. Under Serializable isolation a conflicting
   * concurrent commit (e.g. the dispatch worker's acknowledgement tx writing
   * the same attempt row while a fast callback is in flight) aborts the whole
   * transaction with 40001 — the transaction rolled back completely, so
   * re-running it against a fresh snapshot is correct and converges.
   * Genuine repeated conflicts (or deadlocks) exhaust the bounded budget and
   * propagate as 500s.
   */
  private async withSerializationRetry<T>(
    run: () => Promise<T>,
    attemptsLeft = 5,
  ): Promise<T> {
    try {
      return await run();
    } catch (err) {
      const isSerializationFailure =
        (err as { code?: string })?.code === "P2034" ||
        ((err as { meta?: { code?: string } })?.meta?.code === "40001" &&
          (err as { code?: string })?.code === "P2010");
      if (!isSerializationFailure || attemptsLeft <= 1) {
        throw err;
      }
      this.logger.warn(
        `Callback tx serialization conflict, retrying (${attemptsLeft - 1} left): ${(err as Error).message}`,
      );
      return this.withSerializationRetry(run, attemptsLeft - 1);
    }
  }

  /** Maps a frozen validation issue to the matching HTTP exception. Signature
   *  / timestamp / replay failures are 401; shape/conflict failures are 400
   *  or 409. Never leaks the raw issue message — only the stable error code. */
  private toException(issue: PublishingValidationIssue | undefined): Error {
    if (!issue) {
      return new BadRequestException(PublishingErrorCode.CALLBACK_INVALID);
    }
    switch (issue.code) {
      case "PUBLISHING_WEBHOOK_UNAUTHORIZED":
      case "PUBLISHING_WEBHOOK_TIMESTAMP_INVALID":
      case "PUBLISHING_WEBHOOK_NONCE_REPLAYED":
        return new UnauthorizedException(issue.code);
      case "PUBLISHING_CALLBACK_CONFLICT":
      case "PUBLISHING_IDEMPOTENCY_CONFLICT":
      case "PUBLISHING_STATE_CONFLICT":
        return new ConflictException(issue.code);
      default:
        return new BadRequestException(issue.code);
    }
  }
}

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
import {
  computeCallbackFingerprint,
  publicationAttemptStateForOutcome,
  publicationIntentStateForOutcome,
  validatePublicationCallbackContext,
  type PublicationAttemptV1,
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
    const intentId = await this.prisma.$transaction(async (tx) => {
      // ── Resolve attempt + intent ───────────────────────────────────────
      const attempt = await tx.publishingAttempt.findUnique({
        where: { id: attemptId },
        include: { intent: true },
      });
      if (!attempt) {
        this.logger.warn(`Callback references unknown attempt=${attemptId}`);
        throw new BadRequestException(PublishingErrorCode.CALLBACK_INVALID);
      }

      // Build the frozen PublicationAttemptV1 from the stored row so the
      // frozen validator can bind the signed callback to the EXACT accepted
      // attempt (attempt_id, intent_id, intent_version, request_fingerprint =
      // the stored dispatch body_sha256, and workflow_version).
      const attemptV1 = this.toPublicationAttemptV1(attempt);

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
          const existing = await tx.publishingCallbackIdentity.findUnique({
            where: { externalCallbackId: signed.body.callback_id },
          });
          if (existing && existing.payloadHash === callbackFingerprint) {
            this.logger.log(
              `Identical callback replay for callback_id=${signed.body.callback_id} — returning 200 no-op`,
            );
            return ""; // idempotent replay — nothing to write
          }
          throw new ConflictException(PublishingErrorCode.CALLBACK_CONFLICT);
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
    });

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

  /** Maps a stored `publishing_attempts` row to the frozen
   *  `PublicationAttemptV1` shape the contract validator binds against. The DB
   *  `DISPATCHING`/`RUNNING` statuses both project to the frozen `running`
   *  state (the runner is in flight, awaiting a callback). */
  private toPublicationAttemptV1(attempt: {
    id: string;
    intentId: string;
    intentVersion: number;
    attemptSequence: number;
    status: string;
    workflowVersion: string | null;
    providerRequestFingerprint: string | null;
    idempotencyKey: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
  }): PublicationAttemptV1 {
    return {
      contract_version: "publication-attempt-v1",
      attempt_id: attempt.id,
      intent_id: attempt.intentId,
      intent_version: attempt.intentVersion,
      attempt_number: attempt.attemptSequence,
      idempotency_key: attempt.idempotencyKey,
      workflow_version: attempt.workflowVersion ?? "",
      request_fingerprint: attempt.providerRequestFingerprint ?? "",
      state: this.toFrozenAttemptState(attempt.status),
      started_at: attempt.startedAt ? attempt.startedAt.toISOString() : null,
      finished_at: attempt.finishedAt ? attempt.finishedAt.toISOString() : null,
      created_at: attempt.createdAt.toISOString(),
    };
  }

  private toFrozenAttemptState(
    dbStatus: string,
  ): PublicationAttemptV1["state"] {
    switch (dbStatus) {
      case "QUEUED":
        return "queued";
      case "RUNNING":
      case "DISPATCHING":
        return "running";
      case "SUCCEEDED":
        return "succeeded";
      case "FAILED":
        return "failed";
      case "UNKNOWN":
        return "unknown";
      case "CANCELLED":
        return "cancelled";
      default:
        return "queued";
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

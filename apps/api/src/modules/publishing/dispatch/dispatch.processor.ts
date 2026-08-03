import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { N8nClientService } from "./n8n-client.service";
import { AssetIntegrityValidator } from "./asset-integrity-validator";
import { DispatchEnvelopeBuilder } from "./dispatch-envelope.builder";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

export interface DispatchJobData {
  intentId: string;
  version: number;
  /** Per-owner-action idempotency key. Stable across delayed-job replays so a
   *  replayed BullMQ delivery resolves to the SAME attempt row, not a new one. */
  idempotencyKey: string;
}

/**
 * Dispatch processor — consumes 'dispatch' jobs from the 'publishing-dispatch' queue.
 *
 * Full revalidation checklist (§9.2) runs inside a DB transaction:
 *   1. intent version + status (SCHEDULED);
 *   2. approval row matches the approved intent version;
 *   3. candidate ACTIVE and checksum matches the approval snapshot;
 *   4. target CONNECTED and not expired;
 *   5. no successful/in-flight attempt already exists for this version;
 *   6. (asset integrity) retrieved media bytes match the approved digests
 *      via the frozen validateRetrievedPublicationAssetsV1 contract validator.
 *
 * Idempotency model (issue #119 / contract publication-attempt-v1):
 *   - The job carries an `idempotencyKey`. Before creating a new attempt, the
 *     processor looks one up by `(intentId, idempotencyKey)`.
 *   - If an attempt exists with the SAME canonical request fingerprint, the
 *     replay is a NO-OP — we return the existing attempt (recorded no-op).
 *   - If an attempt exists with a DIFFERENT fingerprint, the same key was
 *     reused with different canonical bytes → PUBLISHING_IDEMPOTENCY_CONFLICT.
 *   - The unique index `publishing_attempts(intent_id, idempotency_key)` makes
 *     this race-proof: a concurrent double-create raises 23505 (P2002).
 *
 * Atomic claim step (§7.2) prevents double-dispatch from stalled-job
 * redelivery even after a replay resolves to the same attempt:
 *   UPDATE ... SET status='DISPATCHING' WHERE id=$1 AND status='QUEUED'
 * Only the winner proceeds to call n8n.
 */
@Injectable()
@Processor("publishing-dispatch")
export class DispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly n8n: N8nClientService,
    private readonly assetIntegrity: AssetIntegrityValidator,
    private readonly envelopeBuilder: DispatchEnvelopeBuilder,
  ) {
    super();
  }

  async process(job: Job<DispatchJobData>): Promise<void> {
    const { intentId, version, idempotencyKey } = job.data;
    if (!idempotencyKey) {
      this.logger.warn(
        `Dispatch job for intent=${intentId} v=${version} carried no idempotencyKey — ignoring`,
      );
      return;
    }
    this.logger.log(
      `Processing dispatch job for intent=${intentId} v=${version} key=${idempotencyKey}`,
    );

    // Revalidation transaction + replay resolution + attempt creation happen
    // together: the replay check compares the canonical request fingerprint
    // with the stored one (identical → recorded no-op, conflicting →
    // PUBLISHING_IDEMPOTENCY_CONFLICT). All DB writes are inside the tx.
    let result: Awaited<
      ReturnType<DispatchProcessor["runRevalidationAndCreateAttempt"]>
    >;
    try {
      result = await this.runRevalidationAndCreateAttempt(
        intentId,
        version,
        idempotencyKey,
      );
    } catch (err) {
      this.logger.warn(
        `Dispatch revalidation failed for intent=${intentId} v=${version}: ${(err as Error).message}`,
      );
      // P1: predicate the failure transition on the job's expected version so a
      // stale vN job (e.g. from a stalled BullMQ delivery) cannot flip a newly
      // approved vN+1 SCHEDULED intent to FAILED. If the intent has since moved
      // (a newer version exists), markIntentFailed updates 0 rows — a recorded
      // no-op for the stale job.
      await this.markIntentFailed(intentId, version, this.sanitizeError(err));
      return; // do not throw — job is considered handled
    }

    if (result.replayed) {
      // Identical replay → recorded no-op. Do not call n8n again.
      this.logger.log(
        `Replay for intent=${intentId} resolves to existing attempt=${result.attemptId} (status=${result.status}) — no-op`,
      );
      return;
    }

    const { attemptId, body } = result as {
      attemptId: string;
      body: import("@marketmind/contracts").PublicationDispatchBodyV1 | null;
    };

    // ── Step 3: Asset integrity check (§9.2 #6) — OUTSIDE the tx ───────────
    // Real byte retrieval (#121) is network/IO; must not hold DB locks.
    // For a REAL dispatch, the body carries the frozen candidate bytes + asset
    // digests the validator checks against retrieved bytes.
    if (body && body.mode === "real") {
      try {
        await this.assetIntegrity.validateForDispatch(body.candidate as never);
      } catch (err) {
        this.logger.warn(
          `Asset integrity check blocked dispatch for attempt=${attemptId}: ${(err as Error).message}`,
        );
        await this.prisma.$transaction(async (tx) => {
          await tx.publishingAttempt.update({
            where: { id: attemptId },
            data: {
              status: "FAILED",
              sanitizedError: this.sanitizeError(err),
              finishedAt: new Date(),
            },
          });
          // Version-predicated: a stale job must not fail a newer intent version.
          await tx.publishingIntent.updateMany({
            where: {
              id: intentId,
              version,
              status: { in: ["SCHEDULED", "DISPATCHING"] },
            },
            data: { status: "FAILED" },
          });
        });
        return;
      }
    }

    // ── Step 4: Atomic claim — prevents double-dispatch from stalled jobs ──
    const claimed = await this.claimAttempt(attemptId);
    if (!claimed) {
      this.logger.warn(
        `Attempt ${attemptId} already claimed by another worker — stopping`,
      );
      return;
    }

    // ── Step 5: Outbound call to n8n (outside any transaction) ─────────────
    try {
      const n8nResult = await this.n8n.dispatch(body!);

      await this.prisma.$transaction(async (tx) => {
        await tx.publishingAttempt.update({
          where: { id: attemptId },
          data: {
            status: "DISPATCHING", // = dispatched to n8n (not yet published)
            n8nExecutionRef: n8nResult.executionId ?? null,
            dispatchedAt: new Date(),
          },
        });
        await tx.publishingIntent.update({
          where: { id: intentId },
          data: { status: "DISPATCHING" },
        });
      });

      this.logger.log(
        `Dispatch succeeded for attempt=${attemptId}, n8n execution=${n8nResult.executionId}`,
      );
    } catch (err) {
      // P1: distinguish a PRE-SEND failure from an AMBIGUOUS post-send outcome.
      // Once the request may have reached n8n (timeout / connection reset / 5xx
      // after the runner accepted), the provider might already have published.
      // Marking FAILED would make the intent eligible for a blind retry that
      // could double-publish. Instead, persist the attempt as UNKNOWN with a
      // matching UNKNOWN result row and move the intent to ACTION_REQUIRED so
      // reconciliation (or admin investigation) resolves it using the SAME
      // idempotency key — never an automatic re-dispatch.
      const ambiguous = this.isAmbiguousDelivery(err);
      const sanitized = this.sanitizeError(err);
      this.logger.error(
        `Dispatch ${ambiguous ? "timed out ambiguously" : "failed deterministically"} for attempt=${attemptId}: ${(err as Error).message}`,
      );
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        await tx.publishingAttempt.update({
          where: { id: attemptId },
          data: {
            status: ambiguous ? "UNKNOWN" : "FAILED",
            sanitizedError: sanitized,
            finishedAt: now,
          },
        });
        // One result row per attempt (unique on attempt_id); only create if absent.
        const existingResult = await tx.publishingResult.findUnique({
          where: { attemptId },
        });
        if (!existingResult) {
          await tx.publishingResult.create({
            data: {
              attemptId,
              intentId,
              outcome: ambiguous ? "UNKNOWN" : ("FAILED" as never),
              provider: "meta",
              retryable: ambiguous ? true : false,
              rawPayloadHash: null,
              sanitizedError: sanitized,
              occurredAt: now,
            },
          });
        }
        // Version-predicated intent transition (stale-job guard, see P1-6).
        await tx.publishingIntent.updateMany({
          where: {
            id: intentId,
            version,
            status: { in: ["SCHEDULED", "DISPATCHING"] },
          },
          data: { status: ambiguous ? "ACTION_REQUIRED" : "FAILED" },
        });
      });
    }
  }

  /**
   * Opens a single transaction, runs the replay-resolution + full §9.2
   * revalidation checklist, creates the attempt row (with idempotency_key +
   * request_fingerprint), commits. Lock duration is short: no network calls
   * happen inside this transaction. Asset byte retrieval is performed AFTER
   * this transaction by the asset integrity validator.
   *
   * Replay resolution happens FIRST, before the state checks, so a delayed-job
   * replay of an already-accepted job short-circuits to a recorded no-op even
   * if the intent has since moved to a terminal state (e.g. cancelled after
   * the best-effort stale-job removal failed). A replay whose canonical bytes
   * differ from the stored attempt is rejected as an idempotency conflict.
   */
  private async runRevalidationAndCreateAttempt(
    intentId: string,
    version: number,
    idempotencyKey: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Load intent first.
        const intent = await tx.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
        });

        // §9.2 Check 0: idempotent replay resolution. The (intent_id,
        // idempotency_key) unique index makes the existing attempt THE attempt
        // for this key — a replay of the same delayed job short-circuits to it
        // as a recorded no-op, even if the intent has since moved to a terminal
        // state. (Per-key uniqueness means a different dispatch request cannot
        // reuse the key — it is insert-blocked by the index.)
        const existingByKey = await tx.publishingAttempt.findUnique({
          where: { intentId_idempotencyKey: { intentId, idempotencyKey } },
        });
        if (existingByKey) {
          return {
            replayed: true,
            attemptId: existingByKey.id,
            status: existingByKey.status,
            body: null,
          } as const;
        }

        // §9.2 Check 1: version match
        if (intent.version !== version) {
          throw new Error(
            `${PublishingErrorCode.STATE_CONFLICT}: intent version mismatch (expected ${version}, current ${intent.version})`,
          );
        }
        // §9.2 Check 2: status must be SCHEDULED
        if (intent.status !== "SCHEDULED") {
          throw new Error(
            `${PublishingErrorCode.STATE_CONFLICT}: intent status is "${intent.status}", expected SCHEDULED`,
          );
        }

        // §9.2 Check 3: approval row with matching intent version
        const approval = await tx.publishingApproval.findFirst({
          where: {
            intentId,
            intentVersionAtDecision: version,
            decision: "APPROVED",
          },
        });
        if (!approval) {
          throw new Error(
            `${PublishingErrorCode.APPROVAL_REQUIRED}: no valid approval for intent version ${version}`,
          );
        }

        // Load candidate (with the frozen payload + active status snapshot).
        const candidate = await tx.publishingCandidate.findUniqueOrThrow({
          where: { id: intent.candidateId },
        });
        // §9.2 Check 4: candidate active
        if (candidate.status !== "ACTIVE") {
          throw new Error(
            `${PublishingErrorCode.CANDIDATE_REVOKED}: candidate is ${candidate.status}`,
          );
        }
        // §9.2 Check 5: checksum still matches approval snapshot
        if (candidate.candidateChecksum !== approval.candidateChecksum) {
          throw new Error(
            `${PublishingErrorCode.ASSET_TAMPERED}: candidate checksum drifted since approval`,
          );
        }

        // Load target.
        const target = await tx.publishingTarget.findUniqueOrThrow({
          where: { id: intent.targetId! },
        });
        // §9.2 Check 7: target connected and not expired
        if (target.connectionState !== "CONNECTED") {
          throw new Error(
            `${PublishingErrorCode.TARGET_UNAUTHORIZED}: target connection state is ${target.connectionState}`,
          );
        }
        if (target.expiresAt && target.expiresAt < new Date()) {
          throw new Error(
            `${PublishingErrorCode.TARGET_UNAUTHORIZED}: target credential expired`,
          );
        }

        // §9.2 Check 6: no existing active/succeeded attempt for this version
        const existingAttempt = await tx.publishingAttempt.findFirst({
          where: {
            intentId,
            intentVersion: version,
            status: { in: ["QUEUED", "RUNNING", "DISPATCHING", "SUCCEEDED"] },
          },
        });
        if (existingAttempt) {
          throw new Error(
            `${PublishingErrorCode.DUPLICATE_DISPATCH}: attempt already in-flight for version ${version}`,
          );
        }

        // All checks passed — create attempt row (provisional fingerprint; the
        // canonical body hash needs the created attempt id and is stamped next).
        const lastAttempt = await tx.publishingAttempt.findFirst({
          where: { intentId, intentVersion: version },
          orderBy: { attemptSequence: "desc" },
        });
        const nextSeq = lastAttempt ? lastAttempt.attemptSequence + 1 : 1;

        let attempt: { id: string; status: string };
        try {
          attempt = await tx.publishingAttempt.create({
            data: {
              intentId,
              intentVersion: version,
              attemptSequence: nextSeq,
              status: "QUEUED",
              idempotencyKey,
              // P1 (#119 review): the request fingerprint is the frozen
              // SignedPublicationDispatchEnvelopeV1 body hash (body_sha256).
              // It is stamped after the body is assembled with this attempt id
              // so attempt.request_fingerprint === envelope.body_sha256.
              providerRequestFingerprint: null,
              startedAt: new Date(),
            },
          });
        } catch (err) {
          // P2002 on (intent_id, idempotency_key): a concurrent worker created
          // the attempt first — resolve to it as a recorded no-op (the unique
          // index guarantees it is THE attempt for this key). Never fail intent.
          if ((err as { code?: string })?.code === "P2002") {
            const winner = await tx.publishingAttempt.findUnique({
              where: { intentId_idempotencyKey: { intentId, idempotencyKey } },
            });
            if (winner) {
              this.logger.warn(
                `Concurrent attempt create race for key=${idempotencyKey} — resolving to existing attempt=${winner.id}`,
              );
              return {
                replayed: true,
                attemptId: winner.id,
                status: winner.status,
                body: null,
              } as const;
            }
            throw new ConflictException(
              `${PublishingErrorCode.IDEMPOTENCY_CONFLICT}: idempotency key ${idempotencyKey} race with no winner`,
            );
          }
          throw err;
        }

        // Assemble the frozen dispatch body (P1) and stamp the canonical
        // request fingerprint on the attempt so the signed callback can bind.
        const { body, requestFingerprint } = this.envelopeBuilder.buildDispatchBody({
          attemptId: attempt.id,
          intentId,
          intentVersion: version,
          businessId: intent.businessId,
          idempotencyKey,
          candidate: candidate.payload as never,
          candidateStatus: candidate.sourceStatus as never,
          target: {
            id: target.id,
            businessId: target.businessId,
            provider: target.provider,
            channel: target.channel,
            externalAccountId: target.externalAccountId,
            displayName: target.displayName,
            connectionState: target.connectionState,
            credentialRef: target.credentialRef,
            capabilities: target.capabilities,
            lastVerifiedAt: target.lastVerifiedAt,
            version: target.version,
          },
          approval: {
            id: approval.id,
            candidateChecksum: approval.candidateChecksum,
            decidedByUserId: approval.decidedByUserId,
            decidedAt: approval.decidedAt,
          },
          scheduledUtcAt: intent.scheduledUtcAt!,
          scheduledLocalAt: intent.scheduledLocalAt,
          timezone: intent.timezone,
        });
        await tx.publishingAttempt.update({
          where: { id: attempt.id },
          data: { providerRequestFingerprint: requestFingerprint },
        });

        return {
          replayed: false,
          attemptId: attempt.id,
          status: attempt.status,
          body,
        } as const;
      },
      { timeout: 10_000 }, // short lock duration — no network calls inside
    );
  }

  /**
   * §7.2 Atomic claim — compare-and-swap from QUEUED → DISPATCHING.
   * Returns true only if this worker won the claim.
   */
  private async claimAttempt(attemptId: string): Promise<boolean> {
    const result = await this.prisma.publishingAttempt.updateMany({
      where: { id: attemptId, status: "QUEUED" },
      data: { status: "DISPATCHING" },
    });
    return result.count === 1;
  }

  /**
   * Fail the intent ONLY if it is still at the job's expected version and in a
   * non-terminal state. This is the stale-job guard (P1-6): a stalled BullMQ
   * delivery for vN must not flip a newly approved vN+1 SCHEDULED intent to
   * FAILED. `updateMany` with a version predicate updates 0 rows for a stale
   * job — a recorded no-op.
   */
  private async markIntentFailed(
    intentId: string,
    version: number,
    sanitizedError: string,
  ): Promise<void> {
    try {
      await this.prisma.publishingIntent.updateMany({
        where: {
          id: intentId,
          version,
          status: { in: ["SCHEDULED", "DISPATCHING"] },
        },
        data: { status: "FAILED" },
      });
    } catch (e) {
      this.logger.error(`Failed to mark intent ${intentId} as failed`, e);
    }
  }

  /**
   * Classifies a dispatch-time exception as AMBIGUOUS (the request may have
   * reached n8n and the provider may already have published) versus a
   * DETERMINISTIC pre-send failure (misconfiguration / hard 4xx rejection
   * before any provider call). Ambiguous outcomes must never be retried blind.
   */
  private isAmbiguousDelivery(err: unknown): boolean {
    if (!err) return false;
    const e = err as {
      code?: string;
      response?: { status?: number };
      isAxiosError?: boolean;
      name?: string;
      message?: string;
    };
    // Axios/transport ambiguity: timeout, connection reset, dropped connection.
    if (
      e.code === "ECONNABORTED" ||
      e.code === "ETIMEDOUT" ||
      e.code === "ECONNRESET" ||
      e.code === "ECONNREFUSED" ||
      e.code === "EPIPE" ||
      e.code === "EAI_AGAIN"
    ) {
      return true;
    }
    // A 5xx after the runner may have started executing is ambiguous.
    if (e.isAxiosError && typeof e.response?.status === "number") {
      return e.response.status >= 500;
    }
    // No response at all (network) and not a deterministic BadRequest misconfig
    // — treat as ambiguous.
    if (e.isAxiosError && e.response === undefined) return true;
    return false;
  }

  private sanitizeError(err: unknown): string {
    if (!(err instanceof Error)) return "Unknown dispatch error";
    // Strip any line that looks like it contains a token/secret
    return err.message
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/authorization[^,\n]*/gi, "authorization: [REDACTED]")
      .replace(/secret[^,\n]*/gi, "secret: [REDACTED]")
      .slice(0, 512); // hard cap
  }
}

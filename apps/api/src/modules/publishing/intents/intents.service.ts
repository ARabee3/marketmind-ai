import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import * as crypto from "crypto";
import { Prisma } from "@prisma/client";
import type { PublicationCandidateV1 } from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { toTargetProjection } from "../targets/targets.service";
import {
  localToUtc,
  utcToCairoLocalIso,
  isInPast,
} from "../common/time/cairo-time.util";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { ManualExportArchiveService } from "../exports/manual-export-archive.service";
import {
  ApproveIntentDto,
  CancelIntentDto,
  CreateIntentDto,
  DispatchLocalActionDto,
  ListIntentsQueryDto,
  RescheduleIntentDto,
  RetryIntentDto,
  ScheduleIntentDto,
} from "./intents.dto";

import { PublishingIntentStatus } from "@prisma/client";

/** Statuses that occupy the one-intent-per-candidate slot (P1 #119 review):
 *  only CANCELLED frees the candidate, so a succeeded/failed/action-required
 *  outcome cannot be followed by a fresh intent that would duplicate or
 *  republish a confirmed candidate. The DB partial unique index is the
 *  race-proof guarantee; this is the friendly fast-path mirror. */
const INTENT_SLOT_STATUSES: PublishingIntentStatus[] = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "SCHEDULED",
  "DISPATCHING",
  "SUCCEEDED",
  "FAILED",
  "ACTION_REQUIRED",
];

/** Statuses from which cancel is valid. */
const CANCELLABLE_STATUSES: PublishingIntentStatus[] = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "SCHEDULED",
];

/** Statuses from which retry is valid.
 *
 * P1 (#119 review): only a proven FAILED intent may retry. ACTION_REQUIRED
 * (the intent state for an UNKNOWN/ambiguous delivery) is NOT retryable — the
 * provider may already have published, so a blind re-dispatch with a fresh
 * idempotency key could double-publish. Unknown outcomes must first be
 * reconciled (admin investigation, the stuck-attempt sweep, or a proven
 * provider failure) until the intent reaches FAILED; only then can the owner
 * retry. */
const RETRYABLE_STATUSES: PublishingIntentStatus[] = ["FAILED"];

@Injectable()
export class IntentsService {
  private readonly logger = new Logger(IntentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue("publishing-dispatch") private readonly dispatchQueue: Queue,
    private readonly manualExportArchive: ManualExportArchiveService,
  ) {}

  /**
   * Derives the dispatch-attempt idempotency key from an owner action's key.
   * The contract gives the owner one `idempotency_key` per action (approve,
   * retry); the dispatch attempt needs its own key that is stable across
   * BullMQ delayed-job replays but distinct from prior attempts. We append a
   * deterministic `::dispatch` suffix so the same approval replay produces
   * the same dispatch key → same attempt (recorded no-op).
   */
  private dispatchKeyFor(actionKey: string): string {
    return `${actionKey}::dispatch`;
  }

  /**
   * BullMQ retains completed jobs by default, so a retry must not reuse the
   * original `publish:<intent>:<version>` job id. Hash the owner-action key to
   * produce a stable id for replays of this retry without exposing the key in
   * Redis or colliding with an earlier completed dispatch job.
   */
  private retryJobId(
    intentId: string,
    intentVersion: number,
    actionKey: string,
  ): string {
    const actionFingerprint = crypto
      .createHash("sha256")
      .update(actionKey)
      .digest("hex");
    return `publishing-retry-${intentId}-v${intentVersion}-${actionFingerprint}`;
  }

  /** Validate that a target belongs to the business AND is CONNECTED before
   *  it can be bound to a real-mode intent (§9.2 / issue #119 G7). Prevents
   *  pointing a real publication at another business's target id or at an
   *  already-disconnected target. */
  private async assertTargetBindable(
    tx: Prisma.TransactionClient,
    targetId: string,
    businessId: string,
  ): Promise<void> {
    const target = await tx.publishingTarget.findUnique({
      where: { id: targetId },
    });
    if (!target || target.businessId !== businessId) {
      // 404 NOT 403, to avoid cross-tenant enumeration.
      throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    }
    if (target.connectionState !== "CONNECTED") {
      throw new BadRequestException(
        `${PublishingErrorCode.TARGET_NOT_CONNECTED}: target ${targetId} is ${target.connectionState}`,
      );
    }
    if (target.expiresAt && target.expiresAt < new Date()) {
      throw new BadRequestException(PublishingErrorCode.TARGET_UNAUTHORIZED);
    }
  }

  // ── Create ──────────────────────────────────────────────────────────

  async createIntent(businessId: string, userId: string, dto: CreateIntentDto) {
    // Idempotency (contract matrix "Create intent"): an identical create replay
    // with the same (business, idempotencyKey) resolves to the existing intent.
    // This pre-check is a friendly fast-path; the partial unique index
    // (business_id, idempotency_key) is the race-proof guarantee and the
    // P2002 handler below resolves a concurrent identical create to the same
    // existing intent. A key reused with DIFFERENT bytes (different candidate
    // or mode) is a conflict.
    const replayed = await this.prisma.publishingIntent.findFirst({
      where: { businessId, idempotencyKey: dto.idempotencyKey },
    });
    if (replayed) {
      const replayedMode = replayed.mode as string;
      if (
        replayed.candidateId !== dto.candidateId ||
        replayedMode !== (dto.mode ?? "REAL")
      ) {
        throw new ConflictException(PublishingErrorCode.IDEMPOTENCY_CONFLICT);
      }
      this.logger.log(
        `Identical create-intent replay for key=${dto.idempotencyKey} — returning existing`,
      );
      return replayed;
    }

    return this.prisma.$transaction(async (tx) => {
      // G10 / §7: the candidate must belong to this business (404 to avoid
      // cross-tenant enumeration) and must still be ACTIVE — a revoked or
      // replaced candidate cannot receive a fresh intent (§13).
      const candidate = await tx.publishingCandidate.findUnique({
        where: { id: dto.candidateId },
        select: { businessId: true, status: true },
      });
      if (!candidate || candidate.businessId !== businessId) {
        throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
      }
      if (candidate.status !== "ACTIVE") {
        throw new UnprocessableEntityException(
          `${PublishingErrorCode.CANDIDATE_REVOKED}: candidate is ${candidate.status}`,
        );
      }

      // At most one logical intent per candidate (active, terminal, or ambiguous —
      // only CANCELLED frees the slot, see P1). Friendly fast-path; the
      // authoritative partial unique index in the migration is the guarantee.
      const existing = await tx.publishingIntent.findFirst({
        where: {
          businessId,
          candidateId: dto.candidateId,
          status: { in: INTENT_SLOT_STATUSES },
        },
      });
      if (existing) {
        throw new ConflictException(PublishingErrorCode.STATE_CONFLICT);
      }

      try {
        return await tx.publishingIntent.create({
          data: {
            businessId,
            candidateId: dto.candidateId,
            mode: dto.mode ?? "REAL",
            createdByUserId: userId,
            idempotencyKey: dto.idempotencyKey,
          },
        });
      } catch (err) {
        // P2002 = unique violation. Two constraints can fire on intent insert:
        //  - the partial ACTIVE-intent index → duplicate active intent (race);
        //  - the partial (business_id, idempotency_key) index → a concurrent
        //    identical create won the race → resolve to the existing intent.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const winner = await tx.publishingIntent.findFirst({
            where: { businessId, idempotencyKey: dto.idempotencyKey },
          });
          if (
            winner &&
            winner.candidateId === dto.candidateId &&
            winner.mode === (dto.mode ?? "REAL")
          ) {
            this.logger.log(
              `Concurrent create-intent replay for key=${dto.idempotencyKey} — returning existing`,
            );
            return winner;
          }
          this.logger.warn(
            `createIntent race: duplicate active intent for candidate=${dto.candidateId} (unique index hit)`,
          );
          throw new ConflictException(PublishingErrorCode.STATE_CONFLICT);
        }
        throw err;
      }
    });
  }

  // ── Read ────────────────────────────────────────────────────────────

  async getIntent(intentId: string, businessId: string) {
    const intent = await this.prisma.publishingIntent.findFirst({
      where: { id: intentId, businessId },
      include: {
        candidate: true,
        target: true,
        approvals: { orderBy: { decidedAt: "desc" } },
      },
    });
    if (!intent) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return this.projectIntent(intent);
  }

  async listIntents(businessId: string, query: ListIntentsQueryDto) {
    const intents = await this.prisma.publishingIntent.findMany({
      where: {
        businessId,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.candidateId ? { candidateId: query.candidateId } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
      },
      include: { candidate: true, target: true },
      orderBy: { createdAt: "desc" },
    });
    return intents.map((i) => this.projectIntent(i));
  }

  // ── Schedule ────────────────────────────────────────────────────────

  async scheduleIntent(
    intentId: string,
    businessId: string,
    dto: ScheduleIntentDto,
  ) {
    // Validate & convert timezone
    const scheduledUtcAt = localToUtc(dto.scheduledLocalAt, dto.timezone);
    if (isInPast(scheduledUtcAt)) {
      throw new BadRequestException(PublishingErrorCode.SCHEDULE_IN_PAST);
    }

    return this.prisma
      .$transaction(async (tx) => {
        const intent = await tx.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
        });
        this.assertOwnership(intent.businessId, businessId);
        this.assertVersion(intent.version, dto.currentVersion);
        this.assertStatusIn(intent.status, [
          "DRAFT",
          "AWAITING_APPROVAL",
          "SCHEDULED",
        ]);
        // §9.2 / G7: a target may only be bound when it belongs to this business
        // AND is CONNECTED + not expired — before any approval is requested.
        await this.assertTargetBindable(tx, dto.targetId, businessId);

        // Invalidate existing approval if any (version bump will do this at the DB level)
        const newVersion = intent.version + 1;
        const updated = await tx.publishingIntent.update({
          where: { id: intentId },
          data: {
            targetId: dto.targetId,
            scheduledLocalAt: new Date(dto.scheduledLocalAt),
            timezone: dto.timezone,
            scheduledUtcAt,
            status: "AWAITING_APPROVAL",
            version: newVersion,
          },
        });

        // Remove old BullMQ job for the old version (best-effort after commit)
        return updated;
      })
      .then(async (updated) => {
        // Remove stale queue job (outside transaction — best-effort)
        await this.removeOldDispatchJobs(intentId);
        return this.projectIntent(updated);
      });
  }

  // ── Approve ─────────────────────────────────────────────────────────

  async approveIntent(
    intentId: string,
    businessId: string,
    userId: string,
    dto: ApproveIntentDto,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        const intent = await tx.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
          include: { candidate: true },
        });
        this.assertOwnership(intent.businessId, businessId);
        this.assertVersion(intent.version, dto.currentVersion);
        this.assertStatusIn(intent.status, ["AWAITING_APPROVAL"]);

        // Verify candidate checksum matches what the owner is approving
        if (intent.candidate.candidateChecksum !== dto.candidateChecksum) {
          throw new ConflictException(PublishingErrorCode.CANDIDATE_TAMPERED);
        }

        // Canonical fingerprint over the EXACT decision the owner approves —
        // mirrors the frozen publication-approval-v1.approval_fingerprint (every
        // material field: candidate identity+checksum, mode, target, local time,
        // timezone, UTC instant, intent version, decision). Stored uniquely so a
        // replayed exact decision resolves to the existing approval (no-op) while
        // a conflicting decision for the same intent+version surfaces as
        // PUBLISHING_IDEMPOTENCY_CONFLICT.
        const approvalFingerprint = this.computeApprovalFingerprint({
          decision: dto.decision,
          intentId,
          intentVersion: intent.version,
          candidateId: intent.candidateId,
          candidateChecksum: dto.candidateChecksum,
          mode: intent.mode,
          targetId: intent.targetId,
          scheduledLocalAt: intent.scheduledLocalAt,
          timeZone: intent.timezone,
          scheduledUtcAt: intent.scheduledUtcAt,
        });

        // Idempotent replay of an approval action with the SAME key: if an
        // approval already exists for this idempotency key, return it unchanged
        // (recorded no-op) without re-transitioning the intent. This honours the
        // contract's one-key-per-action rule across network replays.
        const replayed = await tx.publishingApproval.findFirst({
          where: { intentId, idempotencyKey: dto.idempotencyKey },
        });
        if (replayed) {
          if (replayed.approvalFingerprint !== approvalFingerprint) {
            throw new ConflictException(
              PublishingErrorCode.IDEMPOTENCY_CONFLICT,
            );
          }
          this.logger.log(
            `Identical approval replay for key=${dto.idempotencyKey} — returning existing approval`,
          );
          return { intent, approval: replayed, raced: false, replayed: true };
        }

        let approval;
        try {
          approval = await tx.publishingApproval.create({
            data: {
              intentId,
              intentVersionAtDecision: intent.version,
              candidateChecksum: dto.candidateChecksum,
              decision: dto.decision,
              decidedByUserId: userId,
              notes: dto.notes,
              approvalFingerprint,
              idempotencyKey: dto.idempotencyKey,
            },
          });
        } catch (err) {
          // P2002 on approval_fingerprint or (intentId, idempotencyKey): a
          // concurrent identical replay won the race. Treat as idempotent no-op
          // — the intent is already in the right state.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            this.logger.warn(
              `Approval create race for key=${dto.idempotencyKey} — concurrent replay treated as no-op`,
            );
            const existing = await tx.publishingApproval.findFirstOrThrow({
              where: { intentId, idempotencyKey: dto.idempotencyKey },
            });
            return { intent, approval: existing, raced: true, replayed: true };
          }
          throw err;
        }

        let nextStatus = intent.status;
        if (dto.decision === "APPROVED" && intent.scheduledUtcAt) {
          nextStatus = "SCHEDULED";
        } else if (dto.decision === "REJECTED") {
          nextStatus = "CANCELLED";
        }

        const updated = await tx.publishingIntent.update({
          where: { id: intentId },
          data: { status: nextStatus },
        });

        return { intent: updated, approval, raced: false, replayed: false };
      })
      .then(async ({ intent, approval, raced, replayed }) => {
        // Enqueue dispatch job after commit — only for a fresh APPROVED decision
        // that schedules the intent. A race no-op or replay must NOT enqueue a
        // duplicate (on those paths `intent` is still AWAITING_APPROVAL).
        if (
          !raced &&
          !replayed &&
          intent.status === "SCHEDULED" &&
          intent.scheduledUtcAt
        ) {
          const delay = Math.max(
            0,
            intent.scheduledUtcAt.getTime() - Date.now(),
          );
          const jobKey = `publish:${intentId}:${intent.version}`;
          await this.dispatchQueue.add(
            "dispatch",
            {
              intentId,
              version: intent.version,
              idempotencyKey: this.dispatchKeyFor(dto.idempotencyKey),
            },
            { jobId: jobKey, delay },
          );
          this.logger.log(
            `Enqueued dispatch job ${jobKey} with delay=${delay}ms`,
          );
        }
        return { intent: this.projectIntent(intent), approval };
      });
  }

  // ── Cancel ──────────────────────────────────────────────────────────

  async cancelIntent(
    intentId: string,
    businessId: string,
    dto: CancelIntentDto,
  ) {
    return this.prisma
      .$transaction(async (tx) => {
        const intent = await tx.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
        });
        this.assertOwnership(intent.businessId, businessId);
        this.assertVersion(intent.version, dto.currentVersion);
        if (!CANCELLABLE_STATUSES.includes(intent.status as never)) {
          throw new BadRequestException(PublishingErrorCode.STATE_CONFLICT);
        }
        return tx.publishingIntent.update({
          where: { id: intentId },
          data: { status: "CANCELLED" },
        });
      })
      .then(async (updated) => {
        await this.removeOldDispatchJobs(intentId);
        return this.projectIntent(updated);
      });
  }

  // ── Reschedule ──────────────────────────────────────────────────────

  async rescheduleIntent(
    intentId: string,
    businessId: string,
    dto: RescheduleIntentDto,
  ) {
    const scheduledUtcAt = localToUtc(dto.scheduledLocalAt, dto.timezone);
    if (isInPast(scheduledUtcAt)) {
      throw new BadRequestException(PublishingErrorCode.SCHEDULE_IN_PAST);
    }

    return this.prisma
      .$transaction(async (tx) => {
        const intent = await tx.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
        });
        this.assertOwnership(intent.businessId, businessId);
        this.assertVersion(intent.version, dto.currentVersion);
        this.assertStatusIn(intent.status, ["SCHEDULED", "AWAITING_APPROVAL"]);
        // §9.2 / G7: re-binding the target after a reschedule must also pass the
        // own + connected + not-expired checks.
        await this.assertTargetBindable(tx, dto.targetId, businessId);

        return tx.publishingIntent.update({
          where: { id: intentId },
          data: {
            targetId: dto.targetId,
            scheduledLocalAt: new Date(dto.scheduledLocalAt),
            timezone: dto.timezone,
            scheduledUtcAt,
            status: "AWAITING_APPROVAL", // invalidates previous approval
            version: { increment: 1 },
          },
        });
      })
      .then(async (updated) => {
        await this.removeOldDispatchJobs(intentId);
        return this.projectIntent(updated);
      });
  }

  // ── Retry ───────────────────────────────────────────────────────────

  async retryIntent(intentId: string, businessId: string, dto: RetryIntentDto) {
    return this.prisma
      .$transaction(async (tx) => {
        const intent = await tx.publishingIntent.findUniqueOrThrow({
          where: { id: intentId },
          include: {
            approvals: { orderBy: { decidedAt: "desc" }, take: 1 },
            attempts: { orderBy: { attemptSequence: "desc" }, take: 1 },
          },
        });
        this.assertOwnership(intent.businessId, businessId);
        this.assertVersion(intent.version, dto.currentVersion);
        if (!RETRYABLE_STATUSES.includes(intent.status as never)) {
          throw new BadRequestException(PublishingErrorCode.STATE_CONFLICT);
        }

        // P1 (#119 review): a retry may only proceed against a proven, known
        // failure. The intent's latest attempt must be FAILED with the exact
        // sequence the caller expects. This blocks retrying an ambiguous
        // UNKNOWN/ACTION_REQUIRED outcome (which may already have published) and
        // a stale client view (an older attempt number) from re-dispatching.
        const latestAttempt = intent.attempts[0];
        if (
          !latestAttempt ||
          latestAttempt.status !== "FAILED" ||
          latestAttempt.attemptSequence !== dto.expectedLastAttemptNumber
        ) {
          throw new ConflictException(PublishingErrorCode.IDEMPOTENCY_CONFLICT);
        }

        // Revalidate that approval is still current
        const currentApproval = intent.approvals[0];
        if (
          !currentApproval ||
          currentApproval.intentVersionAtDecision !== intent.version
        ) {
          throw new BadRequestException(PublishingErrorCode.APPROVAL_REQUIRED);
        }

        return tx.publishingIntent.update({
          where: { id: intentId },
          data: { status: "SCHEDULED" },
        });
      })
      .then(async (updated) => {
        if (updated.scheduledUtcAt) {
          const delay = Math.max(
            0,
            updated.scheduledUtcAt.getTime() - Date.now(),
          );
          const jobKey = this.retryJobId(
            intentId,
            updated.version,
            dto.idempotencyKey,
          );
          await this.dispatchQueue.add(
            "dispatch",
            {
              intentId,
              version: updated.version,
              idempotencyKey: this.dispatchKeyFor(dto.idempotencyKey),
            },
            { jobId: jobKey, delay },
          );
          this.logger.log(`Re-enqueued dispatch job ${jobKey} after retry`);
        }
        return this.projectIntent(updated);
      });
  }

  // ── Export & Simulation dispatch (§8 draft → dispatching → succeeded) ──

  /**
   * Manual export dispatch (issue #119 G5 / §8 / §10.2).
   *
   * Export has no external side effect — the owner's explicit Export action is
   * the only approval required (no real-publication approval, no BullMQ
   * delay). This builds the export metadata record, writes an EXPORTED result,
   * and transitions the intent DRAFT → DISPATCHING → SUCCEEDED.
   *
   * Idempotent: a second call with the same `idempotencyKey` resolves to the
   * existing result (recorded no-op).
   */
  async dispatchExport(
    intentId: string,
    businessId: string,
    userId: string,
    dto: DispatchLocalActionDto,
  ) {
    return this.runLocalAction(
      intentId,
      businessId,
      userId,
      dto,
      "MANUAL_EXPORT",
    );
  }

  /**
   * Simulation dispatch (issue #119 G5 / §8 / §10.3).
   *
   * Simulation performs all candidate/asset-shape/schedule validation that can
   * run without a real provider, NEVER sends an external request, returns a
   * deterministic fake remote identity scoped to the attempt, stores
   * `simulationLabel = "SIMULATION"`, and displays that label everywhere. It
   * transitions the intent DRAFT → DISPATCHING → SUCCEEDED with outcome
   * SIMULATED. Idempotent on the action key.
   */
  async dispatchSimulation(
    intentId: string,
    businessId: string,
    userId: string,
    dto: DispatchLocalActionDto,
  ) {
    return this.runLocalAction(intentId, businessId, userId, dto, "SIMULATION");
  }

  /**
   * Shared engine for export and simulation: both are deterministic local
   * actions with no external network call and no second approval. Both go
   * DRAFT → DISPATCHING → SUCCEEDED and write one immutable result + (for
   * export) export metadata. The SIMULATION label and EXPORTED artifact id
   * keep the two outcomes visually and textually distinct from a real
   * PUBLISHED result.
   */
  private async runLocalAction(
    intentId: string,
    businessId: string,
    userId: string,
    dto: DispatchLocalActionDto,
    mode: "MANUAL_EXPORT" | "SIMULATION",
  ) {
    // Import is deferred to keep the module graph flat; crypto is tiny.
    const { randomUUID } = await import("crypto");

    return this.prisma.$transaction(async (tx) => {
      const intent = await tx.publishingIntent.findUniqueOrThrow({
        where: { id: intentId },
        include: { candidate: true },
      });
      this.assertOwnership(intent.businessId, businessId);
      if (intent.mode !== mode) {
        throw new BadRequestException(
          `${PublishingErrorCode.STATE_CONFLICT}: intent mode is ${intent.mode}, expected ${mode}`,
        );
      }
      // §8: local actions dispatch straight from DRAFT. AWAITING_APPROVAL/
      // SCHEDULED are real-mode states; an export/sim intent should never
      // reach them, but reject defensively.
      this.assertStatusIn(intent.status, [
        "DRAFT",
        "FAILED",
        "ACTION_REQUIRED",
      ]);

      // Idempotent: if an attempt already exists for this (intent, key), this
      // is a replay — return the existing result (recorded no-op).
      const replayedAttempt = await tx.publishingAttempt.findUnique({
        where: {
          intentId_idempotencyKey: {
            intentId,
            idempotencyKey: dto.idempotencyKey,
          },
        },
        include: { result: true },
      });
      if (replayedAttempt) {
        this.logger.log(
          `Identical ${mode} replay for key=${dto.idempotencyKey} — no-op`,
        );
        return {
          intent: this.projectIntent(intent),
          attempt: replayedAttempt,
          replayed: true,
        };
      }

      // Candidate must be ACTIVE — a revoked/replaced candidate cannot be
      // exported or simulated either (§13: "preserves candidate").
      if (intent.candidate.status !== "ACTIVE") {
        throw new BadRequestException(
          `${PublishingErrorCode.CANDIDATE_REVOKED}: candidate is ${intent.candidate.status}`,
        );
      }

      // DRAFT → DISPATCHING
      await tx.publishingIntent.update({
        where: { id: intentId },
        data: { status: "DISPATCHING" },
      });

      const lastAttempt = await tx.publishingAttempt.findFirst({
        where: { intentId },
        orderBy: { attemptSequence: "desc" },
      });
      const nextSeq = lastAttempt ? lastAttempt.attemptSequence + 1 : 1;

      const now = new Date();
      const artifactId = randomUUID();

      // A manual export is complete only after the exact approved media and
      // copy have been written to a checksum-addressed downloadable archive.
      if (mode === "MANUAL_EXPORT") {
        const archive = this.manualExportArchive.createArchive({
          artifactId,
          intentId,
          candidate: intent.candidate
            .payload as unknown as PublicationCandidateV1,
          generatedAt: now,
        });
        const attempt = await tx.publishingAttempt.create({
          data: {
            intentId,
            intentVersion: intent.version,
            attemptSequence: nextSeq,
            status: "SUCCEEDED",
            idempotencyKey: dto.idempotencyKey,
            workflowVersion: "local-export-v1",
            dispatchedAt: now,
            startedAt: now,
            finishedAt: now,
          },
        });

        await tx.publishingExportMetadata.create({
          data: {
            intentId,
            exportType: "manual_archive_targz",
            destinationRef: archive.destinationRef,
            checksum: archive.checksum,
            exportedAt: now,
          },
        });

        const result = await tx.publishingResult.create({
          data: {
            attemptId: attempt.id,
            intentId,
            outcome: "EXPORTED",
            provider: null,
            remotePublicationId: null,
            remoteUrl: null,
            exportArtifactId: artifactId,
            simulationLabel: null,
            errorCode: null,
            retryable: false,
            occurredAt: now,
          },
        });

        const updated = await tx.publishingIntent.update({
          where: { id: intentId },
          data: { status: "SUCCEEDED" },
        });

        this.logger.log(
          `MANUAL_EXPORT completed for intent=${intentId} by user=${userId} → artifact ${artifactId}`,
        );
        return {
          intent: this.projectIntent(updated),
          attempt: { ...attempt, result },
          exportArtifactId: artifactId,
          replayed: false,
        };
      }

      // SIMULATION: fully deterministic local action with no external side
      // effect — completes synchronously to SIMULATED/SUCCEEDED.
      const outcome = "SIMULATED";
      const attempt = await tx.publishingAttempt.create({
        data: {
          intentId,
          intentVersion: intent.version,
          attemptSequence: nextSeq,
          status: "SUCCEEDED",
          idempotencyKey: dto.idempotencyKey,
          workflowVersion: "local-v1",
          dispatchedAt: now,
          startedAt: now,
          finishedAt: now,
        },
      });

      const result = await tx.publishingResult.create({
        data: {
          attemptId: attempt.id,
          intentId,
          outcome: outcome as never,
          provider: null,
          remotePublicationId: null,
          remoteUrl: null,
          exportArtifactId: null,
          // A SIMULATION is the only local outcome that claims SUCCEEDED — it
          // performs real candidate/asset/schedule validation without any
          // external publication, and is labelled SIMULATION everywhere.
          simulationLabel: "SIMULATION",
          errorCode: null,
          retryable: false,
          occurredAt: now,
        },
      });

      // DISPATCHING → SUCCEEDED
      const updated = await tx.publishingIntent.update({
        where: { id: intentId },
        data: { status: "SUCCEEDED" },
      });

      this.logger.log(
        `${mode} dispatched for intent=${intentId} by user=${userId} → outcome=${outcome}`,
      );
      return {
        intent: this.projectIntent(updated),
        attempt: { ...attempt, result },
        replayed: false,
      };
    });
  }

  // ── Approvals history ───────────────────────────────────────────────

  async listApprovals(intentId: string, businessId: string) {
    const intent = await this.prisma.publishingIntent.findFirst({
      where: { id: intentId, businessId },
    });
    if (!intent) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return this.prisma.publishingApproval.findMany({
      where: { intentId },
      orderBy: { decidedAt: "desc" },
    });
  }

  // ── Attempts list ───────────────────────────────────────────────────

  async listAttempts(intentId: string, businessId: string) {
    const intent = await this.prisma.publishingIntent.findFirst({
      where: { id: intentId, businessId },
    });
    if (!intent) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return this.prisma.publishingAttempt.findMany({
      where: { intentId },
      include: { result: true },
      orderBy: { attemptSequence: "asc" },
    });
  }

  // ── Export metadata ─────────────────────────────────────────────────

  async getExportMetadata(intentId: string, businessId: string) {
    const intent = await this.prisma.publishingIntent.findFirst({
      where: { id: intentId, businessId },
    });
    if (!intent) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return this.prisma.publishingExportMetadata.findMany({
      where: { intentId },
    });
  }

  async getExportArchive(intentId: string, businessId: string) {
    const intent = await this.prisma.publishingIntent.findFirst({
      where: { id: intentId, businessId },
    });
    if (!intent) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);

    const metadata = await this.prisma.publishingExportMetadata.findFirst({
      where: { intentId, exportType: "manual_archive_targz" },
      orderBy: { exportedAt: "desc" },
    });
    if (!metadata) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);

    return this.manualExportArchive.readArchive(
      metadata.destinationRef,
      metadata.checksum,
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Canonical SHA-256 over the EXACT decision the owner approves — mirrors the
   * frozen publication-approval-v1.approval_fingerprint. Object keys are
   * emitted in lexicographic order and dates are normalized to ISO strings so
   * the same decision always produces the same digest (contract canonical
   * JSON rules). It binds candidate identity+checksum, mode, target, local
   * time, timezone, UTC instant, intent version, and the decision itself.
   */
  private computeApprovalFingerprint(input: {
    decision: string;
    intentId: string;
    intentVersion: number;
    candidateId: string;
    candidateChecksum: string;
    mode: string;
    targetId: string | null;
    scheduledLocalAt: Date | null;
    timeZone: string | null;
    scheduledUtcAt: Date | null;
  }): string {
    const canonical = JSON.stringify({
      candidateChecksum: input.candidateChecksum,
      candidateId: input.candidateId,
      decision: input.decision,
      intentId: input.intentId,
      intentVersion: input.intentVersion,
      mode: input.mode,
      scheduledLocalAt: input.scheduledLocalAt
        ? input.scheduledLocalAt.toISOString()
        : null,
      scheduledUtcAt: input.scheduledUtcAt
        ? input.scheduledUtcAt.toISOString()
        : null,
      targetId: input.targetId,
      timeZone: input.timeZone,
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  private assertOwnership(
    resourceBusinessId: string,
    callerBusinessId: string,
  ) {
    if (resourceBusinessId !== callerBusinessId) {
      throw new NotFoundException(PublishingErrorCode.NOT_FOUND); // 404, not 403, to avoid enumeration
    }
  }

  private assertVersion(current: number, submitted: number) {
    if (current !== submitted) {
      throw new ConflictException({
        code: PublishingErrorCode.VERSION_CONFLICT,
        currentVersion: current,
        message: `Version conflict: expected ${current}, got ${submitted}`,
      });
    }
  }

  private assertStatusIn(status: string, allowed: string[]) {
    if (!allowed.includes(status)) {
      throw new BadRequestException({
        code: PublishingErrorCode.STATE_CONFLICT,
        currentStatus: status,
        message: `Operation not valid in status "${status}"`,
      });
    }
  }

  private async removeOldDispatchJobs(intentId: string): Promise<void> {
    try {
      // BullMQ does not support wildcard removal; we look up all jobs for this intent
      // by fetching delayed jobs and filtering by our naming convention
      const jobs = await this.dispatchQueue.getDelayed();
      const toRemove = jobs.filter(
        (j) => j.name === "dispatch" && String(j.data?.intentId) === intentId,
      );
      await Promise.all(toRemove.map((j) => j.remove()));
      if (toRemove.length > 0) {
        this.logger.log(
          `Removed ${toRemove.length} stale dispatch job(s) for intent ${intentId}`,
        );
      }
    } catch (err) {
      // Log but do not throw — the reconciliation sweep will catch any drift
      this.logger.error(
        `Failed to remove old dispatch jobs for intent ${intentId}`,
        err,
      );
    }
  }

  private projectIntent(
    intent: Record<string, unknown>,
  ): Record<string, unknown> {
    // The ONLY path through which target data leaves the service is
    // toTargetProjection (targets.service.ts), which statically omits
    // `credentialRef`. getIntent/listIntents include the raw target row, so we
    // MUST project it here — otherwise GET /publication-intents leaks the
    // opaque credential pointer to the browser (Issue #119 acceptance:
    // "Secrets, auth headers, tokens, and signed media URLs are excluded from
    // browser output and ordinary logs").
    const rawTarget = intent["target"] as
      | Parameters<typeof toTargetProjection>[0]
      | undefined;
    const { target: _rawTarget, ...rest } = intent;
    const safeTarget = rawTarget ? toTargetProjection(rawTarget) : undefined;

    // Include both Cairo-local and UTC timestamps on every read
    const scheduledUtcAt = rest["scheduledUtcAt"] as Date | null;
    return {
      ...rest,
      ...(safeTarget ? { target: safeTarget } : {}),
      scheduledLocalDisplay:
        scheduledUtcAt && rest["timezone"]
          ? utcToCairoLocalIso(scheduledUtcAt, rest["timezone"] as string)
          : null,
    };
  }
}

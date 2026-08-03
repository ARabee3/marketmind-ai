import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { IngestCandidateDto, UpdateCandidateStateDto } from "./candidates.dto";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent candidate ingestion.
   *
   * Rules:
   * 1. If (businessId, externalContentId, candidateChecksum) already exists → no-op, return existing.
   * 2. If eventFingerprint already exists with different data → tamper conflict.
   * 3. If externalContentId exists with a DIFFERENT checksum → content drift → reject.
   * 4. Otherwise → create.
   */
  async ingestCandidate(dto: IngestCandidateDto) {
    // Idempotency: same fingerprint = same event delivery
    const byFingerprint = await this.prisma.publishingCandidate.findUnique({
      where: { eventFingerprint: dto.eventFingerprint },
    });
    if (byFingerprint) {
      if (byFingerprint.candidateChecksum !== dto.candidateChecksum) {
        throw new ConflictException(PublishingErrorCode.CANDIDATE_TAMPERED);
      }
      this.logger.debug(
        `Duplicate candidate event ${dto.eventFingerprint} — no-op`,
      );
      return byFingerprint;
    }

    // Dedup: same content + same checksum under this business
    const existing = await this.prisma.publishingCandidate.findFirst({
      where: {
        businessId: dto.businessId,
        externalContentId: dto.externalContentId,
      },
    });
    if (existing) {
      if (existing.candidateChecksum !== dto.candidateChecksum) {
        // Content drift: same id, different checksum → reject
        throw new ConflictException(PublishingErrorCode.CANDIDATE_TAMPERED);
      }
      // Identical re-delivery — no-op
      return existing;
    }

    return this.prisma.publishingCandidate.create({
      data: {
        businessId: dto.businessId,
        externalContentId: dto.externalContentId,
        candidateChecksum: dto.candidateChecksum,
        eventFingerprint: dto.eventFingerprint,
        payload: dto.payload as Prisma.InputJsonValue,
        channel: dto.channel,
        format: dto.format,
        locale: dto.locale ?? "ar",
        strategyWeekNumber: dto.strategyWeekNumber,
      },
    });
  }

  async listCandidates(businessId: string) {
    return this.prisma.publishingCandidate.findMany({
      where: { businessId },
      orderBy: { receivedAt: "desc" },
    });
  }

  async getCandidate(candidateId: string, businessId: string) {
    const c = await this.prisma.publishingCandidate.findFirst({
      where: { id: candidateId, businessId },
    });
    if (!c) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return c;
  }

  /**
   * Update candidate state (revoke/replace) from the content pipeline.
   * Enforces optimistic concurrency (version) and stateVersion monotonicity.
   */
  async updateCandidateState(
    candidateId: string,
    dto: UpdateCandidateStateDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.publishingCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });

      if (candidate.version !== dto.currentVersion) {
        throw new ConflictException(PublishingErrorCode.VERSION_CONFLICT);
      }
      if (dto.sourceStateVersion <= candidate.sourceStateVersion) {
        this.logger.debug(
          `Stale state update ignored for candidate ${candidateId}`,
        );
        return candidate; // stale — no-op
      }

      const updated = await tx.publishingCandidate.update({
        where: { id: candidateId },
        data: {
          status: dto.newStatus,
          sourceStateVersion: dto.sourceStateVersion,
          version: { increment: 1 },
        },
      });

      // Cancel any non-dispatched intents if candidate is revoked/replaced
      if (dto.newStatus !== "ACTIVE") {
        await tx.publishingIntent.updateMany({
          where: {
            candidateId,
            status: { in: ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"] },
          },
          data: { status: "CANCELLED" },
        });
      }

      return updated;
    });
  }

  /** Used by the dispatch processor for dispatch-time revalidation. */
  async assertCandidateActive(
    candidateId: string,
    expectedChecksum: string,
  ): Promise<void> {
    const c = await this.prisma.publishingCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!c)
      throw new UnprocessableEntityException(
        PublishingErrorCode.CANDIDATE_INVALID,
      );
    if (c.status !== "ACTIVE")
      throw new UnprocessableEntityException(
        PublishingErrorCode.CANDIDATE_REVOKED,
      );
    if (c.candidateChecksum !== expectedChecksum)
      throw new UnprocessableEntityException(
        PublishingErrorCode.ASSET_TAMPERED,
      );
  }
}

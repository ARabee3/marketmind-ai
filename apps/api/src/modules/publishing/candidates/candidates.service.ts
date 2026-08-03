import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, PublishingCandidate } from "@prisma/client";
import {
  reducePublicationCandidateEventV1,
  type PublicationCandidateRecordV1,
  type PublicationCandidateIntakeResultV1,
  type PublicationCandidateV1,
  type PublicationCandidateStatusV1,
} from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

/** DB enum value for the candidate status ("source_state"). */
type CandidateDbStatus = "ACTIVE" | "REVOKED" | "REPLACED";

function sourceStateToDbStatus(
  state: "active" | "revoked" | "replaced",
): CandidateDbStatus {
  if (state === "revoked") return "REVOKED";
  if (state === "replaced") return "REPLACED";
  return "ACTIVE";
}

/**
 * CandidatesService — authoritative candidate store for publishing.
 *
 * P1 (#119 review): ingestion is NOT an owner-JWT action. Candidates arrive
 * from the authoritative content-service handoff via the internal `ingest`
 * route and are reduced with the frozen `reducePublicationCandidateEventV1`
 * (validates the event envelope, dedups by event fingerprint, enforces
 * strictly-increasing state_version, and binds candidate identity/checksum).
 * An owner browser can only LIST/READ its own candidates.
 */
@Injectable()
export class CandidatesService {
  private readonly logger = new Logger(CandidatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reduce a frozen content-service candidate event (created or state-changed)
   * against the authoritative stored record and persist the outcome.
   *
   * Dispositions returned by the frozen reducer:
   *   applied           → create or update the row and return it
   *   identical_replay    → return the existing row unchanged (no write)
   *   rejected_stale    → 409 STATE_CONFLICT
   *   rejected_conflict → 409 CANDIDATE_TAMPERED / STATE_CONFLICT
   *   rejected_invalid  → 422 CANDIDATE_INVALID / CONTRACT_UNSUPPORTED
   */
  async ingestEvent(eventValue: unknown): Promise<{
    disposition: string;
    candidate: PublishingCandidate | null;
  }> {
    const receivedAt = new Date().toISOString();
    const candidateId = extractCandidateId(eventValue);

    // Re-hydrate the authoritative record from the DB row (if any) so the
    // frozen reducer can validate the existing record exactly.
    const existingRow = candidateId
      ? await this.prisma.publishingCandidate.findUnique({
          where: { id: candidateId },
        })
      : null;
    const existingRecord = existingRow
      ? rowToRecord(existingRow)
      : null;

    const result: PublicationCandidateIntakeResultV1 =
      reducePublicationCandidateEventV1(existingRecord, eventValue, receivedAt);

    if (!result.accepted) {
      throw this.toHttpException(result, eventValue);
    }

    if (!result.changed) {
      // identical_replay — no write
      this.logger.debug(
        `Candidate event identical replay (disposition=${result.disposition}) for candidate=${candidateId ?? "<unknown>"}`,
      );
      const row = existingRow;
      return { disposition: result.disposition, candidate: row ?? null };
    }

    // applied — persist the new authoritative record
    const record = result.record;
    if (!record) {
      // Defensive: the reducer contract guarantees a record on `applied`.
      throw new UnprocessableEntityException(
        PublishingErrorCode.CANDIDATE_INVALID,
      );
    }

    const payload = record.payload as PublicationCandidateV1;
    const isCreate = !existingRow;

    if (isCreate) {
      const created = await this.prisma.publishingCandidate.create({
        data: {
          id: record.candidate_id,
          businessId: record.business_id,
          externalContentId: payload.content_item_version_id,
          candidateChecksum: record.candidate_checksum,
          eventFingerprint: record.event_fingerprint,
          eventId: record.event_id,
          status: sourceStateToDbStatus(record.source_state),
          sourceStatus: record.source_status as Prisma.InputJsonValue,
          payload: record.payload as Prisma.InputJsonValue,
          channel: payload.target_channel,
          format: payload.content_format,
          locale: payload.selected_locale,
          strategyWeekNumber: payload.strategy_week_number,
          sourceStateVersion: record.source_state_version,
        },
      });
      this.logger.log(
        `Ingested candidate ${created.id} (event ${record.event_id}) checksum=${record.candidate_checksum}`,
      );
      return { disposition: result.disposition, candidate: created };
    }

    // state-changed apply on the existing row
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.publishingCandidate.update({
        where: { id: record.candidate_id },
        data: {
          status: sourceStateToDbStatus(record.source_state),
          sourceStatus: record.source_status as Prisma.InputJsonValue,
          sourceStateVersion: record.source_state_version,
          eventFingerprint: record.event_fingerprint,
          eventId: record.event_id,
          version: { increment: 1 },
        },
      });
      // Cascade-cancel non-dispatched intents when the candidate is revoked or
      // replaced (the owner must not publish a withdrawn content version).
      if (row.status !== "ACTIVE") {
        await tx.publishingIntent.updateMany({
          where: {
            candidateId: row.id,
            status: { in: ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"] },
          },
          data: { status: "CANCELLED" },
        });
      }
      return row;
    });
    this.logger.log(
      `Applied candidate state-changed ${updated.id} → ${updated.status} (event ${record.event_id})`,
    );
    return { disposition: result.disposition, candidate: updated };
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

  private toHttpException(
    result: PublicationCandidateIntakeResultV1,
    eventValue: unknown,
  ): never {
    const issue = result.validation.issues[0];
    const message = issue
      ? `${issue.code}: ${issue.message}`
      : `Candidate intake rejected (disposition=${result.disposition})`;
    const code = issue?.code;
    this.logger.warn(
      `Candidate ingestion rejected: ${message} (event_type=${(eventValue as { event_type?: string })?.event_type ?? "unknown"})`,
    );
    switch (result.disposition) {
      case "rejected_stale":
        throw new ConflictException(
          `${PublishingErrorCode.STATE_CONFLICT}: ${message}`,
        );
      case "rejected_conflict":
        if (code === "PUBLISHING_CANDIDATE_TAMPERED") {
          throw new ConflictException(
            `${PublishingErrorCode.CANDIDATE_TAMPERED}: ${message}`,
          );
        }
        throw new ConflictException(
          `${PublishingErrorCode.STATE_CONFLICT}: ${message}`,
        );
      case "rejected_invalid":
      default:
        if (code === "PUBLISHING_CONTRACT_UNSUPPORTED") {
          throw new BadRequestException(
            `${PublishingErrorCode.CONTRACT_UNSUPPORTED}: ${message}`,
          );
        }
        throw new UnprocessableEntityException(
          `${PublishingErrorCode.CANDIDATE_INVALID}: ${message}`,
        );
    }
  }
}

/** Extracts the candidate_id from a created/state-changed event payload
 *  so we can re-hydrate the authoritative record before reducing. Returns
 *  null for malformed events (the reducer will reject them). */
function extractCandidateId(eventValue: unknown): string | null {
  if (!eventValue || typeof eventValue !== "object") return null;
  const payload = (eventValue as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { candidate_id?: unknown }).candidate_id;
  return typeof id === "string" ? id : null;
}

/** Maps a stored DB row back to the frozen PublicationCandidateRecordV1 so the
 *  reducer can validate the existing authoritative record on a state-changed
 *  event (issue #119 P1). */
function rowToRecord(row: PublishingCandidate): PublicationCandidateRecordV1 {
  return {
    contract_version: "publishing-candidate-record-v1",
    candidate_id: row.id,
    event_id: row.eventId,
    business_id: row.businessId,
    candidate_checksum: row.candidateChecksum,
    event_fingerprint: row.eventFingerprint,
    source_state:
      row.status === "REVOKED"
        ? "revoked"
        : row.status === "REPLACED"
          ? "replaced"
          : "active",
    source_state_version: row.sourceStateVersion,
    source_status: row.sourceStatus as unknown as PublicationCandidateStatusV1,
    received_at: row.receivedAt.toISOString(),
    payload: row.payload as unknown as PublicationCandidateV1,
  };
}
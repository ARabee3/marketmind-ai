import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  PublicationCandidateCreatedEventV1,
  PublicationCandidateStateChangedEventV1,
  PublicationCandidateV1,
  ContentChannel,
  ContentFormat,
  computePublicationCandidateChecksum,
  validatePublicationCandidateV1,
} from "@marketmind/contracts";
import { ContentDecisionRow } from "./content-decision.repository";

export type PublicationCandidateAssetInput = {
  readonly assetId: string;
  readonly kind: "owner_supplied" | "generated_static";
  readonly mimeType: string;
  readonly storageKey: string;
  readonly checksum: string;
};

export type CreateCandidateInput = {
  readonly approval: ContentDecisionRow;
  readonly itemVersion: {
    readonly id: string;
    readonly contentItemId: string;
    readonly contentPackId: string;
    readonly version: number;
    readonly versionChecksum: string;
    readonly channel: string;
    readonly format: string;
    readonly languageMode: string;
    readonly captionVariants: Prisma.InputJsonValue;
    readonly cta: string | null;
    readonly hashtags: Prisma.InputJsonValue;
    readonly altText: string;
    readonly recommendedPublishWindow: Prisma.InputJsonValue;
  };
  readonly assets: PublicationCandidateAssetInput[];
  readonly ownerUserId: string;
};

export type CreateCandidateResult = {
  readonly candidate: PublicationCandidateV1;
  readonly outboxEventId: string;
};

export type ChangeCandidateStateResult = {
  readonly changed: boolean;
  readonly stateVersion: number;
};

type CaptionVariantJson = { readonly locale?: string; readonly caption?: string };
type PublishWindowJson = { readonly starts_at?: string; readonly ends_at?: string };

const CONTENT_CANDIDATE_TAMPERED = "CONTENT_CANDIDATE_TAMPERED";

/**
 * Persists the frozen PublicationCandidateV1 boundary plus its lifecycle rows.
 *
 * The candidate payload is immutable: it is validated (including its own
 * checksum) BEFORE any row is written, and it is never mutated afterwards.
 * State changes are separate PublicationCandidateStatusV1 rows with monotonic
 * state versions; they never rewrite the candidate bytes.
 */
export class PublicationCandidateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the frozen candidate from the approval, the exact item version, and
   * its ready assets; computes the checksum; validates the complete candidate
   * (throw CONTENT_CANDIDATE_TAMPERED if invalid — nothing is persisted);
   * then inserts the candidate row, the initial `active` status, and the
   * `content.publication_candidate.created.v1` outbox event in ONE transaction.
   *
   * Pass an existing `tx` when the caller coordinates the owner decision and
   * the candidate in ONE transaction; otherwise a transaction is opened here.
   */
  async createCandidate(
    input: CreateCandidateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<CreateCandidateResult> {
    if (tx) {
      return this.createCandidateInTransaction(input, tx);
    }
    return this.prisma.$transaction((client) =>
      this.createCandidateInTransaction(input, client),
    );
  }

  private async createCandidateInTransaction(
    input: CreateCandidateInput,
    tx: Prisma.TransactionClient,
  ): Promise<CreateCandidateResult> {
    const pack = await tx.contentPack.findUniqueOrThrow({
      where: { id: input.itemVersion.contentPackId },
      select: {
        businessId: true,
        strategyId: true,
        strategyVersion: true,
        contentCycleId: true,
        weekNumber: true,
      },
    });

    const { selectedLocale, caption } = this.selectCaption(
      input.itemVersion.captionVariants,
      input.itemVersion.languageMode,
    );

    const window = this.parsePublishWindow(
      input.itemVersion.recommendedPublishWindow,
    );

    const created_at = new Date().toISOString();
    const candidateBase = {
      contract_version: "publication-candidate-v1" as const,
      candidate_id: randomUUID(),
      business_id: pack.businessId,
      strategy_id: pack.strategyId,
      strategy_version: pack.strategyVersion,
      content_cycle_id: pack.contentCycleId,
      strategy_week_number: pack.weekNumber,
      content_pack_id: input.itemVersion.contentPackId,
      content_item_id: input.itemVersion.contentItemId,
      content_item_version_id: input.itemVersion.id,
      content_item_version: input.itemVersion.version,
      content_item_version_checksum: input.itemVersion.versionChecksum,
      target_channel: input.itemVersion.channel as ContentChannel,
      content_format: input.itemVersion.format as ContentFormat,
      selected_locale: selectedLocale,
      caption,
      cta: input.itemVersion.cta,
      hashtags: this.parseHashtags(input.itemVersion.hashtags),
      alt_text: input.itemVersion.altText,
      assets: input.assets.map((asset) => ({
        asset_id: asset.assetId,
        kind: asset.kind,
        mime_type: asset.mimeType,
        storage_key: asset.storageKey,
        checksum: asset.checksum,
      })),
      recommended_publish_window: {
        starts_at: window.starts_at,
        ends_at: window.ends_at,
        timezone: "Africa/Cairo" as const,
      },
      approval: {
        decision_id: input.approval.id,
        decision: "approved" as const,
        content_item_version_id: input.approval.contentItemVersionId,
        content_item_version_checksum:
          input.approval.contentItemVersionChecksum,
        decided_by_user_id: input.approval.decidedByUserId,
        decided_at: input.approval.decidedAt.toISOString(),
      },
      candidate_checksum: "",
      created_at,
    };
    const candidate: PublicationCandidateV1 = {
      ...candidateBase,
      candidate_checksum: computePublicationCandidateChecksum(
        candidateBase as PublicationCandidateV1,
      ),
    };

    const validation = validatePublicationCandidateV1(candidate);
    if (!validation.valid) {
      throw new ConflictException({
        code: CONTENT_CANDIDATE_TAMPERED,
        message: "Publication candidate failed validation; nothing persisted.",
        issues: validation.issues,
      });
    }

    const row = await tx.publicationCandidate.create({
      data: {
        candidateId: candidate.candidate_id,
        businessId: candidate.business_id,
        contractVersion: candidate.contract_version,
        payload: candidate as unknown as Prisma.InputJsonValue,
        candidateChecksum: candidate.candidate_checksum,
        contentCycleId: candidate.content_cycle_id,
        contentPackId: candidate.content_pack_id,
        contentItemId: candidate.content_item_id,
        contentItemVersionId: candidate.content_item_version_id,
        contentItemVersion: candidate.content_item_version,
        state: "active",
      },
    });

    await tx.publicationCandidateStatus.create({
      data: {
        candidateId: row.id,
        candidateChecksum: candidate.candidate_checksum,
        stateVersion: 1,
        candidateState: "active",
        replacementCandidateId: null,
        changedByUserId: input.ownerUserId,
        changedAt: new Date(candidate.created_at),
      },
    });

    const event: PublicationCandidateCreatedEventV1 = {
      event_id: randomUUID(),
      event_type: "content.publication_candidate.created.v1",
      occurred_at: candidate.created_at,
      correlation_id: candidate.candidate_id,
      payload: candidate,
    };

    await tx.publicationCandidateOutbox.create({
      data: {
        eventId: event.event_id,
        eventType: event.event_type,
        correlationId: event.correlation_id,
        candidateId: candidate.candidate_id,
        payload: event as unknown as Prisma.InputJsonValue,
        state: "pending",
      },
    });

    return { candidate, outboxEventId: event.event_id };
  }

  /**
   * Reads the candidate frozen for an item version, if one exists. Used for
   * decision-replay idempotency: a replayed approve decision must return the
   * original candidate instead of creating a duplicate (outbox retries and
   * replay never create duplicate candidates — arch doc 651-653).
   *
   * Pass an existing `tx` when the caller is inside a coordinating transaction.
   */
  async getCandidateByItemVersionId(
    contentItemVersionId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PublicationCandidateV1 | null> {
    const db = tx ?? this.prisma;
    const row = await db.publicationCandidate.findFirst({
      where: { contentItemVersionId },
      orderBy: { createdAt: "asc" },
    });
    if (!row) return null;
    return row.payload as unknown as PublicationCandidateV1;
  }

  /**
   * Appends a new status row with a monotonic state_version, emits the
   * `content.publication_candidate.state_changed.v1` outbox event, and
   * conditionally moves publication_candidates.state. A concurrent change to
   * the candidate state yields zero matched rows and rolls the transaction back.
   */
  async changeCandidateState(
    candidateId: string,
    newState: "revoked" | "replaced",
    byUserId: string,
    replacementId?: string,
  ): Promise<ChangeCandidateStateResult> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.publicationCandidate.findUnique({
        where: { id: candidateId },
        select: {
          candidateId: true,
          businessId: true,
          candidateChecksum: true,
          state: true,
        },
      });
      if (!candidate) {
        throw new ConflictException({
          code: CONTENT_CANDIDATE_TAMPERED,
          message: "Publication candidate not found.",
        });
      }

      const latest = await tx.publicationCandidateStatus.findFirst({
        where: { candidateId },
        orderBy: { stateVersion: "desc" },
        select: { stateVersion: true },
      });
      const stateVersion = latest ? latest.stateVersion + 1 : 1;

      const changed_at = new Date().toISOString();
      const statusBase = {
        contract_version: "publication-candidate-status-v1" as const,
        candidate_id: candidate.candidateId,
        business_id: candidate.businessId,
        candidate_checksum: candidate.candidateChecksum,
        state_version: stateVersion,
        changed_by_user_id: byUserId,
        changed_at,
      };
      const status: PublicationCandidateStateChangedEventV1["payload"] =
        newState === "replaced"
          ? {
              ...statusBase,
              candidate_state: "replaced",
              replacement_candidate_id: replacementId ?? "",
            }
          : {
              ...statusBase,
              candidate_state: "revoked",
              replacement_candidate_id: null,
            };

      await tx.publicationCandidateStatus.create({
        data: {
          candidateId,
          candidateChecksum: candidate.candidateChecksum,
          stateVersion,
          candidateState: newState,
          replacementCandidateId: replacementId ?? null,
          changedByUserId: byUserId,
          changedAt: new Date(status.changed_at),
        },
      });

      const event: PublicationCandidateStateChangedEventV1 = {
        event_id: randomUUID(),
        event_type: "content.publication_candidate.state_changed.v1",
        occurred_at: status.changed_at,
        correlation_id: candidate.candidateId,
        payload: status,
      };

      await tx.publicationCandidateOutbox.create({
        data: {
          eventId: event.event_id,
          eventType: event.event_type,
          correlationId: event.correlation_id,
          candidateId: candidate.candidateId,
          payload: event as unknown as Prisma.InputJsonValue,
          state: "pending",
        },
      });

      const updated = await tx.publicationCandidate.updateMany({
        where: { id: candidateId, state: candidate.state },
        data: { state: newState },
      });
      if (updated.count === 0) {
        throw new ConflictException({
          code: CONTENT_CANDIDATE_TAMPERED,
          message: "A concurrent change moved the candidate state; not applied.",
        });
      }

      return { changed: true, stateVersion };
    });
  }

  async listOutboxPending(limit: number) {
    return this.prisma.publicationCandidateOutbox.findMany({
      where: { state: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async markOutboxDispatched(eventId: string): Promise<void> {
    await this.prisma.publicationCandidateOutbox.updateMany({
      where: { eventId, state: "pending" },
      data: { state: "dispatched", dispatchedAt: new Date() },
    });
  }

  async markOutboxFailed(eventId: string, error: string): Promise<void> {
    await this.prisma.publicationCandidateOutbox.updateMany({
      where: { eventId },
      data: { state: "failed", lastError: error, attempts: { increment: 1 } },
    });
  }

  private selectCaption(
    captionVariants: Prisma.InputJsonValue,
    languageMode: string,
  ): { selectedLocale: "ar" | "en"; caption: string } {
    const variants = Array.isArray(captionVariants)
      ? (captionVariants as unknown as CaptionVariantJson[])
      : [];
    if (variants.length === 0) {
      return { selectedLocale: "ar", caption: "" };
    }
    const primary =
      languageMode === "ar" || languageMode === "en" ? languageMode : "ar";
    const pick =
      variants.find((v) => v.locale === primary) ??
      variants.find((v) => v.locale === "ar") ??
      variants[0];
    return {
      selectedLocale: pick.locale === "en" ? "en" : "ar",
      caption: pick.caption ?? "",
    };
  }

  private parseHashtags(hashtags: Prisma.InputJsonValue): string[] {
    return Array.isArray(hashtags) ? (hashtags as unknown as string[]) : [];
  }

  private parsePublishWindow(
    recommendedPublishWindow: Prisma.InputJsonValue,
  ): { starts_at: string; ends_at: string } {
    const window =
      typeof recommendedPublishWindow === "object" &&
      recommendedPublishWindow !== null
        ? (recommendedPublishWindow as unknown as PublishWindowJson)
        : {};
    return {
      starts_at: window.starts_at ?? "",
      ends_at: window.ends_at ?? "",
    };
  }
}

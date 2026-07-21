import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { CreateEntryVersionDto } from "./dto/create-entry-version.dto";
import {
  KNOWLEDGE_EVIDENCE_TIERS,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_LOCALES,
  KNOWLEDGE_REVIEW_STATUSES,
  assertTaxonomyValue,
  validateVersionTaxonomyArrays,
} from "./taxonomy";

export type NewVersion = {
  id: string;
  entryId: string;
  version: number;
  reviewStatus: string;
  createdAt: Date;
};

/**
 * Repository for immutable {@link MarketingKnowledgeEntryVersion} rows.
 *
 * `createNewVersion` is the supersede operation:
 *  1. Resolves (or creates) the entry identity by slug.
 *  2. Validates every scalar/array taxonomy field against `taxonomy.ts`.
 *  3. Inserts a new immutable version row with `version = latestVersion + 1`.
 *  4. Bumps `MarketingKnowledgeEntry.latestVersion` to the new version.
 *  5. If the new version is `approved`, retires ("retired") any prior
 *     `approved` version for the same entry — history is preserved, nothing
 *     is deleted.
 *
 * All of 1–5 runs in a single DB transaction so an insertion failure cannot
 * leave a half-superseded state. A rollback of one entry's transaction must
 * never affect another entry's already-committed transaction.
 */
@Injectable()
export class MarketingKnowledgeVersionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestVersionForEntry(entryId: string) {
    return this.prisma.marketingKnowledgeEntryVersion.findFirst({
      where: { entryId },
      orderBy: { version: "desc" },
    });
  }

  async findById(versionId: string) {
    return this.prisma.marketingKnowledgeEntryVersion.findUnique({
      where: { id: versionId },
    });
  }

  /**
   * Insert a new immutable version, superseding any prior approved version
   * when the new one is approved. Returns the created version row.
   */
  async createNewVersion(dto: CreateEntryVersionDto): Promise<NewVersion> {
    validateVersionInput(dto);

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.marketingKnowledgeEntry.upsert({
        where: { slug: dto.slug },
        create: { slug: dto.slug },
        update: {},
      });

      const nextVersion = entry.latestVersion + 1;

      // If an approved version exists for this entry, retire it in the same
      // transaction only when the new version is being created as approved.
      // A new draft version does NOT auto-retire an approved one.
      if (dto.reviewStatus === "approved") {
        await tx.marketingKnowledgeEntryVersion.updateMany({
          where: {
            entryId: entry.id,
            reviewStatus: "approved",
          },
          data: { reviewStatus: "retired" },
        });
      }

      const created = await tx.marketingKnowledgeEntryVersion.create({
        data: {
          entryId: entry.id,
          version: nextVersion,
          kind: dto.kind,
          title: dto.title,
          summary: dto.summary,
          body: dto.body,
          locale: dto.locale,
          markets: dto.markets,
          industries: dto.industries,
          businessModels: dto.businessModels,
          objectives: dto.objectives,
          funnelStages: dto.funnelStages,
          channels: dto.channels,
          seasons: dto.seasons,
          budgetModes: dto.budgetModes,
          evidenceTier: dto.evidenceTier,
          reviewStatus: dto.reviewStatus ?? "draft",
          effectiveAt: new Date(dto.effectiveAt),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          author: dto.author,
          reviewer: dto.reviewer ?? null,
          reviewedAt: dto.reviewedAt ? new Date(dto.reviewedAt) : null,
          checksum: dto.checksum,
          sources: dto.sources
            ? { create: dto.sources.map((s) => ({ ...s })) }
            : undefined,
        },
      });

      await tx.marketingKnowledgeEntry.update({
        where: { id: entry.id },
        data: { latestVersion: nextVersion },
      });

      return {
        id: created.id,
        entryId: created.entryId,
        version: created.version,
        reviewStatus: created.reviewStatus,
        createdAt: created.createdAt,
      };
    });
  }

  /**
   * Retire a version. Only `review_status`/`expires_at` may move on an
   * approved row; the trigger (migration) is the DB-level backstop, this is
   * the primary application guard. Moving to `retired` is permitted even
   * when the row was approved; moving approved → draft is not permitted by
   * the trigger.
   */
  async retire(versionId: string): Promise<void> {
    await this.prisma.marketingKnowledgeEntryVersion.update({
      where: { id: versionId },
      data: { reviewStatus: "retired" },
    });
  }

  /**
   * Immediately expire a version by setting `expires_at` to now. Per the
   * trigger, tightening `expires_at` on an approved row is permitted.
   */
  async expireNow(versionId: string): Promise<void> {
    await this.prisma.marketingKnowledgeEntryVersion.update({
      where: { id: versionId },
      data: { expiresAt: new Date(), reviewStatus: "expired" },
    });
  }
}

export function validateVersionInput(dto: CreateEntryVersionDto): void {
  assertTaxonomyValue(KNOWLEDGE_KINDS, dto.kind, "kind");
  assertTaxonomyValue(KNOWLEDGE_LOCALES, dto.locale, "locale");
  assertTaxonomyValue(
    KNOWLEDGE_EVIDENCE_TIERS,
    dto.evidenceTier,
    "evidence_tier",
  );
  if (dto.reviewStatus !== undefined) {
    assertTaxonomyValue(
      KNOWLEDGE_REVIEW_STATUSES,
      dto.reviewStatus,
      "review_status",
    );
  }
  validateVersionTaxonomyArrays(dto);

  if (dto.effectiveAt && dto.expiresAt) {
    if (new Date(dto.expiresAt) <= new Date(dto.effectiveAt)) {
      throw new RangeError(
        "marketing-knowledge: expires_at must be strictly after effective_at",
      );
    }
  }
  if (dto.reviewStatus === "approved" && (!dto.reviewer || !dto.reviewedAt)) {
    throw new RangeError(
      "marketing-knowledge: an approved version requires a reviewer and reviewed_at",
    );
  }
}
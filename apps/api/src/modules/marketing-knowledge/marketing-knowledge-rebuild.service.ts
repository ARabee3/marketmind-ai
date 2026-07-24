import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  eligibilityPredicate,
} from "./marketing-knowledge-eligibility.service";

/**
 * The exact field set of
 * `services/ai/app/qdrant/schemas.py::QdrantKnowledgePoint`, in the order the
 * Pydantic model declares them. There is no shared type across the TS/Python
 * boundary, so drift here is caught by `npm run check:qdrant-field-sync`
 * (`scripts/check-qdrant-field-sync.mjs`, an automated `npm run check` gate)
 * as well as the rebuild-query snapshot test.
 */
export const QDRANT_KNOWLEDGE_POINT_FIELDS = [
  "chunk_id",
  "entry_id",
  "entry_version",
  "checksum",
  "text",
  "kind",
  "locale",
  "markets",
  "industries",
  "business_models",
  "objectives",
  "funnel_stages",
  "channels",
  "seasons",
  "budget_modes",
  "evidence_tier",
  "review_status",
  "effective_at",
  "expires_at",
] as const;

export type QdrantKnowledgePointRow = {
  chunk_id: string;
  entry_id: string;
  entry_version: number;
  checksum: string;
  text: string;
  kind: string;
  locale: string;
  markets: string[];
  industries: string[];
  business_models: string[];
  objectives: string[];
  funnel_stages: string[];
  channels: string[];
  seasons: string[];
  budget_modes: string[];
  evidence_tier: string;
  review_status: string;
  effective_at: Date;
  expires_at: Date | null;
};

/**
 * Proves Qdrant is a rebuildable derived index over Postgres: joins each
 * eligible knowledge version to its chunks and returns rows shaped
 * field-for-field identically to `QdrantKnowledgePoint`. Deleting the Qdrant
 * collection and rebuilding from this output loses no data.
 */
@Injectable()
export class MarketingKnowledgeRebuildService {
  constructor(private readonly prisma: PrismaService) {}

  async exportEligibleChunksForQdrant(): Promise<QdrantKnowledgePointRow[]> {
    const chunks = await this.prisma.marketingKnowledgeChunk.findMany({
      where: {
        entryVersion: eligibilityPredicate(),
      },
      include: {
        entryVersion: { include: { entry: { select: { id: true } } } },
      },
      orderBy: { chunkOrder: "asc" },
    });

    return chunks.map((chunk) => ({
      chunk_id: chunk.id,
      entry_id: chunk.entryVersion.entry.id,
      entry_version: chunk.entryVersion.version,
      checksum: chunk.checksum,
      text: chunk.text,
      kind: chunk.entryVersion.kind,
      locale: chunk.entryVersion.locale,
      markets: chunk.entryVersion.markets,
      industries: chunk.entryVersion.industries,
      business_models: chunk.entryVersion.businessModels,
      objectives: chunk.entryVersion.objectives,
      funnel_stages: chunk.entryVersion.funnelStages,
      channels: chunk.entryVersion.channels,
      seasons: chunk.entryVersion.seasons,
      budget_modes: chunk.entryVersion.budgetModes,
      evidence_tier: chunk.entryVersion.evidenceTier,
      review_status: chunk.entryVersion.reviewStatus,
      effective_at: chunk.entryVersion.effectiveAt,
      expires_at: chunk.entryVersion.expiresAt,
    }));
  }
}
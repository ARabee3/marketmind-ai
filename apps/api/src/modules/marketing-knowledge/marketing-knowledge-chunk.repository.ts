import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";

export type UpsertChunkInput = {
  entryVersionId: string;
  chunkOrder: number;
  text: string;
  tokenCount: number;
  checksum: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingVersion: string;
  qdrantPointId?: string;
  qdrantCollectionName?: string;
  indexedAt?: Date;
};

/**
 * Repository for {@link MarketingKnowledgeChunk}. Idempotent on the
 * `chunk_idempotency_key` unique constraint (`checksum` + embedding config):
 * re-running ingestion with identical text/checksum/embedding-config must not
 * create a duplicate row or a duplicate `qdrant_point_id`.
 */
@Injectable()
export class MarketingKnowledgeChunkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert a chunk keyed on the idempotency unique constraint. Because
   * Prisma cannot `upsert` on a composite unique constraint other than the
   * `@id`, we resolve the existing row by the idempotency key first and
   * either update or insert. The whole operation is intended to run inside a
   * per-entry transaction in the ingestion service.
   */
  async upsertChunk(input: UpsertChunkInput) {
    const existing = await this.prisma.marketingKnowledgeChunk.findFirst({
      where: {
        checksum: input.checksum,
        embeddingProvider: input.embeddingProvider,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embeddingDimensions,
        embeddingVersion: input.embeddingVersion,
      },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.marketingKnowledgeChunk.update({
        where: { id: existing.id },
        data: {
          chunkOrder: input.chunkOrder,
          text: input.text,
          tokenCount: input.tokenCount,
          qdrantPointId: input.qdrantPointId,
          qdrantCollectionName: input.qdrantCollectionName,
          indexedAt: input.indexedAt,
        },
      });
    }

    return this.prisma.marketingKnowledgeChunk.create({
      data: {
        entryVersionId: input.entryVersionId,
        chunkOrder: input.chunkOrder,
        text: input.text,
        tokenCount: input.tokenCount,
        checksum: input.checksum,
        embeddingProvider: input.embeddingProvider,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embeddingDimensions,
        embeddingVersion: input.embeddingVersion,
        qdrantPointId: input.qdrantPointId,
        qdrantCollectionName: input.qdrantCollectionName,
        indexedAt: input.indexedAt,
      },
    });
  }

  async listForVersion(entryVersionId: string) {
    return this.prisma.marketingKnowledgeChunk.findMany({
      where: { entryVersionId },
      orderBy: { chunkOrder: "asc" },
    });
  }

  /** Mark a chunk as indexed into Qdrant with its point id. */
  async markIndexed(chunkId: string, qdrantPointId: string, collectionName: string) {
    return this.prisma.marketingKnowledgeChunk.update({
      where: { id: chunkId },
      data: { qdrantPointId, qdrantCollectionName: collectionName, indexedAt: new Date() },
    });
  }
}
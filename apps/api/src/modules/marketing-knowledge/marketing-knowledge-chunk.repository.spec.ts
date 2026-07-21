import { PrismaService } from "../../common/persistence/prisma.service";
import {
  MarketingKnowledgeChunkRepository,
  UpsertChunkInput,
} from "./marketing-knowledge-chunk.repository";

describe("MarketingKnowledgeChunkRepository", () => {
  describe("upsertChunk", () => {
    it("inserts a new chunk when no idempotency key matches", async () => {
      const prisma = prismaMock({ findFirst: null });
      const repository = new MarketingKnowledgeChunkRepository(prisma as never);

      await repository.upsertChunk(chunkInput("chk"));

      expect(prisma.marketingKnowledgeChunk.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ checksum: "chk", chunkOrder: 0 }),
      });
      expect(prisma.marketingKnowledgeChunk.update).not.toHaveBeenCalled();
    });

    it("updates the existing chunk when the idempotency key matches", async () => {
      const prisma = prismaMock({ findFirst: { id: "existing-chunk" } });
      const repository = new MarketingKnowledgeChunkRepository(prisma as never);

      await repository.upsertChunk(chunkInput("chk", 3));

      expect(prisma.marketingKnowledgeChunk.update).toHaveBeenCalledWith({
        where: { id: "existing-chunk" },
        data: expect.objectContaining({ chunkOrder: 3, text: "body" }),
      });
      expect(prisma.marketingKnowledgeChunk.create).not.toHaveBeenCalled();
    });

    it("looks up the existing row by the full idempotency key", async () => {
      const prisma = prismaMock({ findFirst: null });
      const repository = new MarketingKnowledgeChunkRepository(prisma as never);

      await repository.upsertChunk(chunkInput("chk"));

      expect(prisma.marketingKnowledgeChunk.findFirst).toHaveBeenCalledWith({
        where: {
          checksum: "chk",
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDimensions: 1536,
          embeddingVersion: "v1",
        },
        select: { id: true },
      });
    });
  });

  it("markIndexed sets qdrant point id, collection, and indexed_at", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeChunkRepository(prisma as never);

    await repository.markIndexed("chunk-1", "point-uuid", "mk_kb_v1");

    expect(prisma.marketingKnowledgeChunk.update).toHaveBeenCalledWith({
      where: { id: "chunk-1" },
      data: {
        qdrantPointId: "point-uuid",
        qdrantCollectionName: "mk_kb_v1",
        indexedAt: expect.any(Date),
      },
    });
  });
});

function chunkInput(checksum: string, chunkOrder = 0): UpsertChunkInput {
  return {
    entryVersionId: "version-1",
    chunkOrder,
    text: "body",
    tokenCount: 10,
    checksum,
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    embeddingVersion: "v1",
  };
}

function prismaMock(overrides: { findFirst?: unknown } = {}): PrismaService {
  return {
    marketingKnowledgeChunk: {
      findFirst: jest.fn().mockResolvedValue(overrides.findFirst ?? null),
      create: jest.fn().mockResolvedValue({ id: "new-chunk" }),
      update: jest.fn().mockResolvedValue({ id: "existing-chunk" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}
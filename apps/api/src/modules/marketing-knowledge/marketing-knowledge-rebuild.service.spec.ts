import { PrismaService } from "../../common/persistence/prisma.service";
import {
  MarketingKnowledgeRebuildService,
  QDRANT_KNOWLEDGE_POINT_FIELDS,
} from "./marketing-knowledge-rebuild.service";

describe("MarketingKnowledgeRebuildService", () => {
  it("exports rows with field names matching QdrantKnowledgePoint exactly", async () => {
    const prisma = prismaMock();
    const service = new MarketingKnowledgeRebuildService(prisma as never);

    const rows = await service.exportEligibleChunksForQdrant();

    expect(rows).toHaveLength(1);
    const row = rows[0];
    const keys = Object.keys(row);
    expect(keys).toEqual(QDRANT_KNOWLEDGE_POINT_FIELDS);
    expect(row.chunk_id).toBe("chunk-id");
    expect(row.entry_id).toBe("entry-id");
    expect(row.entry_version).toBe(1);
    expect(row.evidence_tier).toBe("verified_benchmark");
    expect(row.review_status).toBe("approved");
  });

  it("filters chunks to eligible versions only", async () => {
    const prisma = prismaMock();
    const service = new MarketingKnowledgeRebuildService(prisma as never);

    await service.exportEligibleChunksForQdrant();

    expect(prisma.marketingKnowledgeChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entryVersion: expect.objectContaining({
            reviewStatus: "approved",
          }),
        },
      }),
    );
  });
});

describe("QDRANT_KNOWLEDGE_POINT_FIELDS", () => {
  it("lists every QdrantKnowledgePoint field in the python declaration order", () => {
    expect(QDRANT_KNOWLEDGE_POINT_FIELDS).toEqual([
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
    ]);
  });
});

function prismaMock(): PrismaService {
  return {
    marketingKnowledgeChunk: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "chunk-id",
          checksum: "chk",
          text: "body",
          chunkOrder: 0,
          entryVersion: {
            version: 1,
            kind: "benchmark_report",
            locale: "en",
            markets: ["egypt"],
            industries: ["retail"],
            businessModels: [],
            objectives: ["conversion"],
            funnelStages: ["conversion"],
            channels: ["facebook"],
            seasons: [],
            budgetModes: ["monthly_amount"],
            evidenceTier: "verified_benchmark",
            reviewStatus: "approved",
            effectiveAt: new Date("2026-01-01T00:00:00Z"),
            expiresAt: null,
            entry: { id: "entry-id" },
          },
        },
      ]),
    },
  } as unknown as PrismaService;
}
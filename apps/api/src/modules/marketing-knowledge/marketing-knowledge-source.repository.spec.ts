import { PrismaService } from "../../common/persistence/prisma.service";
import { MarketingKnowledgeSourceRepository } from "./marketing-knowledge-source.repository";

describe("MarketingKnowledgeSourceRepository", () => {
  it("listForVersion orders by created_at asc", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeSourceRepository(prisma as never);

    await repository.listForVersion("version-1");

    expect(prisma.marketingKnowledgeSourceRef.findMany).toHaveBeenCalledWith({
      where: { entryVersionId: "version-1" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("add creates a single source ref", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeSourceRepository(prisma as never);

    await repository.add("version-1", "https://example.com", "note");

    expect(prisma.marketingKnowledgeSourceRef.create).toHaveBeenCalledWith({
      data: { entryVersionId: "version-1", reference: "https://example.com", note: "note" },
    });
  });

  it("addMany is a no-op for an empty list", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeSourceRepository(prisma as never);

    await repository.addMany("version-1", []);

    expect(prisma.marketingKnowledgeSourceRef.createMany).not.toHaveBeenCalled();
  });

  it("addMany batches the provided refs", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeSourceRepository(prisma as never);

    await repository.addMany("version-1", [
      { reference: "https://a.example.com" },
      { reference: "https://b.example.com", note: "n" },
    ]);

    expect(prisma.marketingKnowledgeSourceRef.createMany).toHaveBeenCalledWith({
      data: [
        { entryVersionId: "version-1", reference: "https://a.example.com", note: undefined },
        { entryVersionId: "version-1", reference: "https://b.example.com", note: "n" },
      ],
    });
  });
});

function prismaMock(): PrismaService {
  return {
    marketingKnowledgeSourceRef: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "ref-1" }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;
}
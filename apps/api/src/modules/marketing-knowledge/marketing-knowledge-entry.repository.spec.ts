import { PrismaService } from "../../common/persistence/prisma.service";
import { MarketingKnowledgeEntryRepository } from "./marketing-knowledge-entry.repository";

describe("MarketingKnowledgeEntryRepository", () => {
  it("findBySlug delegates to prisma with included versions", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeEntryRepository(prisma as never);

    await repository.findBySlug("framework/awareness-basics");

    expect(prisma.marketingKnowledgeEntry.findUnique).toHaveBeenCalledWith({
      where: { slug: "framework/awareness-basics" },
      include: { versions: { orderBy: { version: "desc" } } },
    });
  });

  it("createIfMissing upserts on slug and is idempotent", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeEntryRepository(prisma as never);

    await repository.createIfMissing("channel_playbook/facebook-basics");

    expect(prisma.marketingKnowledgeEntry.upsert).toHaveBeenCalledWith({
      where: { slug: "channel_playbook/facebook-basics" },
      create: { slug: "channel_playbook/facebook-basics" },
      update: {},
    });
  });
});

function prismaMock(): PrismaService {
  return {
    marketingKnowledgeEntry: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: "entry-id", slug: "x" }),
    },
  } as unknown as PrismaService;
}
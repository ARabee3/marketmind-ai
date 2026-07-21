import { PrismaService } from "../../common/persistence/prisma.service";
import { MarketingKnowledgeIngestionRunRepository } from "./marketing-knowledge-ingestion-run.repository";

describe("MarketingKnowledgeIngestionRunRepository", () => {
  it("start creates a running run with configuration", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeIngestionRunRepository(
      prisma as never,
    );

    await repository.start({
      actor: "ingester",
      commitSha: "abc123",
      configuration: { source: "github" },
    });

    expect(prisma.marketingKnowledgeIngestionRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor: "ingester",
        commitSha: "abc123",
        status: "running",
      }),
    });
  });

  it("recordError stores a per-entry error on the run", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeIngestionRunRepository(
      prisma as never,
    );

    await repository.recordError("run-1", {
      slug: "benchmark/x",
      version: 2,
      errorCode: "INVALID_KIND",
      errorMessage: "kind nope not allowed",
    });

    expect(prisma.marketingKnowledgeIngestionError.create).toHaveBeenCalledWith({
      data: {
        runId: "run-1",
        slug: "benchmark/x",
        version: 2,
        errorCode: "INVALID_KIND",
        errorMessage: "kind nope not allowed",
      },
    });
  });

  it("incrementCount atomically increments the requested counter", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeIngestionRunRepository(
      prisma as never,
    );

    await repository.incrementCount("run-1", "failedCount", 1);

    expect(prisma.marketingKnowledgeIngestionRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: { failedCount: { increment: 1 } },
    });
  });

  it("finish records partial_failure with counts and finished_at", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeIngestionRunRepository(
      prisma as never,
    );

    await repository.finish(
      "run-1",
      "partial_failure",
      { enteredCount: 5, updatedCount: 1, skippedCount: 2, failedCount: 1 },
    );

    expect(prisma.marketingKnowledgeIngestionRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "partial_failure",
        finishedAt: expect.any(Date),
        enteredCount: 5,
        updatedCount: 1,
        skippedCount: 2,
        failedCount: 1,
      }),
    });
  });

  it("finish rejects an invalid status at the application layer", async () => {
    const prisma = prismaMock();
    const repository = new MarketingKnowledgeIngestionRunRepository(
      prisma as never,
    );

    await expect(
      repository.finish("run-1", "done" as never),
    ).rejects.toThrow(/ingestion_run\.status/);
  });
});

function prismaMock(): PrismaService {
  return {
    marketingKnowledgeIngestionRun: {
      create: jest.fn().mockResolvedValue({ id: "run-1" }),
      update: jest.fn().mockResolvedValue({ id: "run-1" }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    marketingKnowledgeIngestionError: {
      create: jest.fn().mockResolvedValue({ id: "err-1" }),
    },
  } as unknown as PrismaService;
}
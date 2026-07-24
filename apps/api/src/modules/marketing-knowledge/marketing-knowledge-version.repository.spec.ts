import { PrismaService } from "../../common/persistence/prisma.service";
import {
  MarketingKnowledgeVersionRepository,
  validateVersionInput,
} from "./marketing-knowledge-version.repository";
import { CreateEntryVersionDto } from "./dto/create-entry-version.dto";

describe("MarketingKnowledgeVersionRepository", () => {
  describe("createNewVersion", () => {
    it("inserts a new version and bumps latestVersion in one transaction", async () => {
      const prisma = prismaMock({
        entryUpsert: { id: "entry-1", latestVersion: 3 },
        created: {
          id: "version-4",
          entryId: "entry-1",
          version: 4,
          reviewStatus: "draft",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
      const repository = new MarketingKnowledgeVersionRepository(
        prisma as never,
      );

      const result = await repository.createNewVersion(approved());

      expect(result.version).toBe(4);
      expect(prisma.marketingKnowledgeEntryVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryId: "entry-1",
            version: 4,
            reviewStatus: "approved",
          }),
        }),
      );
      expect(prisma.marketingKnowledgeEntry.update).toHaveBeenCalledWith({
        where: { id: "entry-1" },
        data: { latestVersion: 4 },
      });
    });

    it("retires prior approved versions when creating a new approved one", async () => {
      const prisma = prismaMock({
        entryUpsert: { id: "entry-1", latestVersion: 1 },
        created: { id: "v2", entryId: "entry-1", version: 2, reviewStatus: "approved" },
      });
      const repository = new MarketingKnowledgeVersionRepository(
        prisma as never,
      );

      await repository.createNewVersion(approved());

      expect(
        prisma.marketingKnowledgeEntryVersion.updateMany,
      ).toHaveBeenCalledWith({
        where: { entryId: "entry-1", reviewStatus: "approved" },
        data: { reviewStatus: "retired" },
      });
    });

    it("does not retire prior approved versions when creating a new draft", async () => {
      const prisma = prismaMock({
        entryUpsert: { id: "entry-1", latestVersion: 1 },
        created: { id: "v2", entryId: "entry-1", version: 2, reviewStatus: "draft" },
      });
      const repository = new MarketingKnowledgeVersionRepository(
        prisma as never,
      );

      await repository.createNewVersion(draft());

      expect(
        prisma.marketingKnowledgeEntryVersion.updateMany,
      ).not.toHaveBeenCalled();
    });

    it("links provided sources to the created version", async () => {
      const prisma = prismaMock({
        entryUpsert: { id: "entry-1", latestVersion: 0 },
        created: { id: "v1", entryId: "entry-1", version: 1, reviewStatus: "approved" },
      });
      const repository = new MarketingKnowledgeVersionRepository(
        prisma as never,
      );

      await repository.createNewVersion({
        ...approved(),
        sources: [{ reference: "https://example.com/report", note: "Q1" }],
      });

      expect(prisma.marketingKnowledgeEntryVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sources: {
              create: [{ reference: "https://example.com/report", note: "Q1" }],
            },
          }),
        }),
      );
    });
  });

  describe("retire / expireNow", () => {
    it("retire only touches review_status", async () => {
      const prisma = prismaMock();
      const repository = new MarketingKnowledgeVersionRepository(
        prisma as never,
      );

      await repository.retire("version-1");

      expect(prisma.marketingKnowledgeEntryVersion.update).toHaveBeenCalledWith({
        where: { id: "version-1" },
        data: { reviewStatus: "retired" },
      });
    });

    it("expireNow sets expires_at to now and review_status to expired", async () => {
      const prisma = prismaMock();
      const repository = new MarketingKnowledgeVersionRepository(
        prisma as never,
      );

      await repository.expireNow("version-1");

      expect(prisma.marketingKnowledgeEntryVersion.update).toHaveBeenCalledWith({
        where: { id: "version-1" },
        data: { expiresAt: expect.any(Date), reviewStatus: "expired" },
      });
    });
  });
});

describe("validateVersionInput", () => {
  it("rejects an invalid kind", () => {
    expect(() => validateVersionInput({ ...approved(), kind: "nope" })).toThrow(
      /kind/,
    );
  });

  it("rejects an invalid objective array element", () => {
    expect(() =>
      validateVersionInput({ ...approved(), objectives: ["growth"] }),
    ).toThrow(/objectives/);
  });

  it("rejects expires_at <= effective_at", () => {
    const same = "2026-01-01T00:00:00Z";
    expect(() =>
      validateVersionInput({ ...approved(), effectiveAt: same, expiresAt: same }),
    ).toThrow(/expires_at/);
  });

  it("rejects approved without reviewer", () => {
    expect(() =>
      validateVersionInput({ ...approved(), reviewer: undefined, reviewedAt: undefined }),
    ).toThrow(/reviewer/);
  });

  it("accepts a well-formed approved payload", () => {
    expect(() => validateVersionInput(approved())).not.toThrow();
  });
});

function approved(): CreateEntryVersionDto {
  return {
    slug: "benchmark/ramadan-cpc",
    kind: "benchmark_report",
    title: "Ramadan CPC benchmarks",
    summary: "Benchmarks",
    body: "Body",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["conversion"],
    funnelStages: ["conversion"],
    channels: ["facebook"],
    seasons: ["ramadan"],
    budgetModes: ["monthly_amount"],
    evidenceTier: "verified_benchmark",
    reviewStatus: "approved",
    effectiveAt: "2026-01-01T00:00:00Z",
    expiresAt: undefined,
    author: "tester",
    reviewer: "reviewer",
    reviewedAt: "2026-01-02T00:00:00Z",
    checksum: "abc",
    sources: undefined,
  };
}

function draft(): CreateEntryVersionDto {
  return { ...approved(), reviewStatus: "draft", reviewer: undefined, reviewedAt: undefined };
}

interface MockOverrides {
  entryUpsert?: { id: string; latestVersion: number };
  created?: {
    id: string;
    entryId: string;
    version: number;
    reviewStatus: string;
    createdAt?: Date;
  };
}

function prismaMock(overrides: MockOverrides = {}): PrismaService {
  const tx = {
    marketingKnowledgeEntry: {
      upsert: jest
        .fn()
        .mockResolvedValue(
          overrides.entryUpsert ?? { id: "entry-1", latestVersion: 0 },
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    marketingKnowledgeEntryVersion: {
      create: jest
        .fn()
        .mockResolvedValue(
          overrides.created ?? {
            id: "v1",
            entryId: "entry-1",
            version: 1,
            reviewStatus: "approved",
            createdAt: new Date(),
          },
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  return {
    ...tx,
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
}
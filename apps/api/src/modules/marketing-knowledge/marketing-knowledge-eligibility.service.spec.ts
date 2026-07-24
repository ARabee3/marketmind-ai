import { PrismaService } from "../../common/persistence/prisma.service";
import {
  MarketingKnowledgeEligibilityService,
  eligibilityPredicate,
  filterToWhere,
} from "./marketing-knowledge-eligibility.service";
import { KnowledgeFilterDto } from "./dto/knowledge-filter.dto";

describe("eligibilityPredicate", () => {
  it("requires approved + effective_at <= now + (null or future expires_at)", () => {
    const now = new Date("2026-07-21T00:00:00Z");
    const predicate = eligibilityPredicate(now);
    expect(predicate).toEqual({
      reviewStatus: "approved",
      effectiveAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    });
  });
});

describe("filterToWhere", () => {
  it("maps scalar filters", () => {
    const where = filterToWhere({
      kind: "benchmark_report",
      locale: "ar-EG",
      evidenceTier: "verified_benchmark",
    } as KnowledgeFilterDto);
    expect(where).toEqual({
      kind: "benchmark_report",
      locale: "ar-EG",
      evidenceTier: "verified_benchmark",
    });
  });

  it("maps array-overlap filters with hasSome", () => {
    const where = filterToWhere({
      channels: ["facebook", "instagram"],
      objectives: ["awareness"],
      markets: ["egypt"],
      industries: ["retail"],
      funnelStages: ["consideration"],
      seasons: ["ramadan"],
      budgetModes: ["organic_only"],
      businessModels: ["ecommerce"],
    } as KnowledgeFilterDto);
    expect(where.channels).toEqual({ hasSome: ["facebook", "instagram"] });
    expect(where.objectives).toEqual({ hasSome: ["awareness"] });
    expect(where.markets).toEqual({ hasSome: ["egypt"] });
    expect(where.businessModels).toEqual({ hasSome: ["ecommerce"] });
  });

  it("returns an empty where for an undefined filter", () => {
    expect(filterToWhere(undefined)).toEqual({});
  });
});

describe("MarketingKnowledgeEligibilityService", () => {
  it("findEligible combines the eligibility predicate with the filter", async () => {
    const prisma = prismaMock();
    const service = new MarketingKnowledgeEligibilityService(prisma as never);

    await service.findEligible({ channels: ["facebook"] } as KnowledgeFilterDto);

    expect(prisma.marketingKnowledgeEntryVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              reviewStatus: "approved",
              effectiveAt: expect.objectContaining({ lte: expect.any(Date) }),
              OR: [{ expiresAt: null }, { expiresAt: expect.objectContaining({ gt: expect.any(Date) }) }],
            },
            { channels: { hasSome: ["facebook"] } },
          ],
        },
      }),
    );
  });

  it("countEligible reuses the same predicate", async () => {
    const prisma = prismaMock();
    const service = new MarketingKnowledgeEligibilityService(prisma as never);

    await service.countEligible();

    expect(prisma.marketingKnowledgeEntryVersion.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({ reviewStatus: "approved" }),
        ]),
      }),
    });
  });
});

function prismaMock(): PrismaService {
  return {
    marketingKnowledgeEntryVersion: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
}
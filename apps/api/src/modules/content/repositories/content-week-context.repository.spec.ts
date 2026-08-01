import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  ContentWeekContextRepository,
  deriveSafeDefaultCta,
} from "./content-week-context.repository";
import type { ContentWeekContextOwnerInput } from "@marketmind/contracts";

const OWNER_INPUT: ContentWeekContextOwnerInput = {
  week_number: 3,
  week_start_date: "2026-01-19",
  promotion_mode: "owner_approved",
  promotion: {
    text: "20% off this week",
    terms: ["one per customer"],
    valid_from: "2026-01-19T00:00:00Z",
    valid_until: "2026-01-25T23:59:59Z",
  },
  must_include: ["include the café name"],
  must_avoid: ["no competitor mentions"],
  approved_asset_ids: ["asset-1"],
  cta_destination: { type: "whatsapp", value: "+201000000000" },
};

const WEEK_ROW = {
  id: "week-1",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weekNumber: 3,
  weekStartDate: new Date("2026-01-19"),
  promotionMode: "owner_approved",
  promotion: { text: "20% off this week" },
  mustInclude: ["include the café name"],
  mustAvoid: [],
  approvedAssetIds: ["asset-1"],
  ctaDestination: { type: "whatsapp", value: "+201000000000" },
  generationCutoffAt: new Date("2026-01-18T00:00:00Z"),
  weeklyClaimId: "claim-abc",
  contextSource: "owner_confirmed",
  confirmedByUserId: "owner-1",
  confirmedAt: new Date("2026-01-15T00:00:00Z"),
  systemDefaultedAt: null,
  createdAt: new Date("2026-01-15T00:00:00Z"),
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

describe("ContentWeekContextRepository", () => {
  describe("upsertOwnerContext", () => {
    it("upserts an owner-confirmed context computing weekly_claim_id and cutoff", async () => {
      const findFirst = jest.fn().mockResolvedValue({
        nextGenerationAt: new Date("2026-01-18T00:00:00Z"),
      });
      const upsert = jest.fn().mockResolvedValue(WEEK_ROW);
      const repo = new ContentWeekContextRepository({
        contentCycle: { findFirst },
        contentWeekContext: { upsert },
      } as unknown as PrismaService);

      const result = await repo.upsertOwnerContext(
        "cycle-1",
        OWNER_INPUT,
        "owner-1",
      );

      expect(result.contextSource).toBe("owner_confirmed");
      const callArgs = upsert.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        contentCycleId_weekNumber: { contentCycleId: "cycle-1", weekNumber: 3 },
      });
      expect(callArgs.create.generationCutoffAt).toEqual(
        new Date("2026-01-18T00:00:00Z"),
      );
      expect(callArgs.create.weeklyClaimId).toBeDefined();
      expect(callArgs.create.contextSource).toBe("owner_confirmed");
      expect(callArgs.create.confirmedByUserId).toBe("owner-1");
      expect(callArgs.update.generationCutoffAt).toEqual(
        new Date("2026-01-18T00:00:00Z"),
      );
    });

    it("throws 404 when the cycle has no generation cutoff", async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const repo = new ContentWeekContextRepository({
        contentCycle: { findFirst },
      } as unknown as PrismaService);

      await expect(
        repo.upsertOwnerContext("cycle-1", OWNER_INPUT, "owner-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("createSafeDefaultContext", () => {
    it("writes promotion_mode='none' and context_source='system_defaulted'", async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ profileVersion: { profile: null } });
      const contentAssetFindMany = jest.fn().mockResolvedValue([]);
      const create = jest.fn().mockResolvedValue(WEEK_ROW);
      const repo = new ContentWeekContextRepository({
        contentCycle: { findUnique },
        contentAsset: { findMany: contentAssetFindMany },
        contentWeekContext: { create },
      } as unknown as PrismaService);

      await repo.createSafeDefaultContext(
        "cycle-1",
        4,
        {
          weekStartDate: new Date("2026-01-26"),
          cutoffAt: new Date("2026-01-25T00:00:00Z"),
        },
      );

      const data = create.mock.calls[0][0].data;
      expect(data.promotionMode).toBe("none");
      expect(data.contextSource).toBe("system_defaulted");
      expect(data.systemDefaultedAt).toBeInstanceOf(Date);
      expect(data.mustInclude).toEqual([]);
      expect(data.mustAvoid).toEqual([]);
      expect(data.approvedAssetIds).toEqual([]);
    });

    it("carries only prior approved assets into the safe default", async () => {
      const findUnique = jest
        .fn()
        .mockResolvedValue({ profileVersion: { profile: null } });
      const contentAssetFindMany = jest
        .fn()
        .mockResolvedValue([{ id: "approved-1" }, { id: "approved-2" }]);
      const create = jest.fn().mockResolvedValue(WEEK_ROW);
      const repo = new ContentWeekContextRepository({
        contentCycle: { findUnique },
        contentAsset: { findMany: contentAssetFindMany },
        contentWeekContext: { create },
      } as unknown as PrismaService);

      await repo.createSafeDefaultContext(
        "cycle-1",
        4,
        {
          weekStartDate: new Date("2026-01-26"),
          cutoffAt: new Date("2026-01-25T00:00:00Z"),
        },
      );

      expect(contentAssetFindMany).toHaveBeenCalledWith({
        where: {
          contentItemVersion: {
            contentPack: {
              contentCycleId: "cycle-1",
              status: "approved",
            },
          },
        },
        select: { id: true },
      });
      const data = create.mock.calls[0][0].data;
      expect(data.approvedAssetIds).toEqual(["approved-1", "approved-2"]);
    });

    it("derives the CTA from confirmed business data", async () => {
      const findUnique = jest.fn().mockResolvedValue({
        profileVersion: {
          profile: {
            business_name: "Café Nile",
            address_text: "12 Tahrir St, Cairo",
          },
        },
      });
      const create = jest.fn().mockResolvedValue(WEEK_ROW);
      const repo = new ContentWeekContextRepository({
        contentCycle: { findUnique },
        contentAsset: { findMany: jest.fn().mockResolvedValue([]) },
        contentWeekContext: { create },
      } as unknown as PrismaService);

      await repo.createSafeDefaultContext(
        "cycle-1",
        4,
        {
          weekStartDate: new Date("2026-01-26"),
          cutoffAt: new Date("2026-01-25T00:00:00Z"),
        },
      );

      const data = create.mock.calls[0][0].data;
      expect(data.ctaDestination).toEqual({
        type: "address",
        value: "12 Tahrir St, Cairo",
      });
    });
  });

  describe("deriveSafeDefaultCta", () => {
    it("uses address when the confirmed profile has one", () => {
      expect(
        deriveSafeDefaultCta({
          address_text: "5 Nile Ave, Giza",
          business_name: "Café Nile",
        }),
      ).toEqual({ type: "address", value: "5 Nile Ave, Giza" });
    });

    it("falls back to none when no confirmed contact exists", () => {
      expect(deriveSafeDefaultCta(null)).toEqual({ type: "none", value: null });
      expect(deriveSafeDefaultCta({ business_name: "Café Nile" })).toEqual({
        type: "none",
        value: null,
      });
      expect(deriveSafeDefaultCta(undefined)).toEqual({
        type: "none",
        value: null,
      });
    });
  });

  describe("listWeeks", () => {
    it("returns weeks ordered by week number ascending", async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: "w2", weekNumber: 2 },
        { id: "w1", weekNumber: 1 },
      ]);
      const repo = new ContentWeekContextRepository({
        contentWeekContext: { findMany },
      } as unknown as PrismaService);

      await repo.listWeeks("cycle-1");

      expect(findMany).toHaveBeenCalledWith({
        where: { contentCycleId: "cycle-1" },
        orderBy: { weekNumber: "asc" },
      });
    });
  });

  describe("claimWeek", () => {
    it("wins the claim on first insert", async () => {
      const create = jest.fn().mockResolvedValue({ ...WEEK_ROW, weeklyClaimId: "claim-1" });
      const repo = new ContentWeekContextRepository({
        contentWeekContext: { create },
      } as unknown as PrismaService);

      const result = await repo.claimWeek("cycle-1", 5, "claim-1", {
        weekStartDate: new Date("2026-02-02"),
        promotionMode: "none",
        promotion: Prisma.JsonNull,
        mustInclude: [],
        mustAvoid: [],
        approvedAssetIds: [],
        ctaDestination: { type: "none", value: null },
        generationCutoffAt: new Date("2026-02-01T00:00:00Z"),
        contextSource: "system_defaulted",
      });

      expect(result.weeklyClaimId).toBe("claim-1");
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contentCycleId: "cycle-1",
          weekNumber: 5,
          weeklyClaimId: "claim-1",
        }),
      });
    });

    it("returns the existing week on a concurrent duplicate claim", async () => {
      const create = jest
        .fn()
        .mockRejectedValue(uniqueViolation());
      const findUnique = jest.fn().mockResolvedValue({
        ...WEEK_ROW,
        weeklyClaimId: "claim-winner",
      });
      const repo = new ContentWeekContextRepository({
        contentWeekContext: { create, findUnique },
      } as unknown as PrismaService);

      const result = await repo.claimWeek("cycle-1", 5, "claim-loser", {
        weekStartDate: new Date("2026-02-02"),
        promotionMode: "none",
        promotion: Prisma.JsonNull,
        mustInclude: [],
        mustAvoid: [],
        approvedAssetIds: [],
        ctaDestination: { type: "none", value: null },
        generationCutoffAt: new Date("2026-02-01T00:00:00Z"),
        contextSource: "system_defaulted",
      });

      expect(result.weeklyClaimId).toBe("claim-winner");
      expect(findUnique).toHaveBeenCalledWith({
        where: {
          contentCycleId_weekNumber: { contentCycleId: "cycle-1", weekNumber: 5 },
        },
      });
    });

    it("concurrent calls resolve to the same weekly_claim_id", async () => {
      let claimed = false;
      const create = jest.fn().mockImplementation(() => {
        if (claimed) {
          return Promise.reject(uniqueViolation());
        }
        claimed = true;
        return Promise.resolve({ ...WEEK_ROW, weeklyClaimId: "claim-winner" });
      });
      const findUnique = jest.fn().mockResolvedValue({
        ...WEEK_ROW,
        weeklyClaimId: "claim-winner",
      });
      const repo = new ContentWeekContextRepository({
        contentWeekContext: { create, findUnique },
      } as unknown as PrismaService);

      const data = {
        weekStartDate: new Date("2026-02-02"),
        promotionMode: "none",
        promotion: Prisma.JsonNull,
        mustInclude: [],
        mustAvoid: [],
        approvedAssetIds: [],
        ctaDestination: { type: "none", value: null },
        generationCutoffAt: new Date("2026-02-01T00:00:00Z"),
        contextSource: "system_defaulted",
      };

      const [first, second] = await Promise.all([
        repo.claimWeek("cycle-1", 5, "claim-a", data),
        repo.claimWeek("cycle-1", 5, "claim-b", data),
      ]);

      expect(first.weeklyClaimId).toBe("claim-winner");
      expect(second.weeklyClaimId).toBe("claim-winner");
      expect(first.weeklyClaimId).toBe(second.weeklyClaimId);
    });
  });
});

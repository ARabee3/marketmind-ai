import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { ContentWeekPlanRepository } from "./content-week-plan.repository";

const OWNER = "owner-1";
const CYCLE = "cycle-1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockPrisma(overrides: Record<string, unknown> = {}): any {
  return {
    contentWeekPlan: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
}

function mockTx(overrides: Record<string, unknown> = {}): any {
  return {
    contentCycle: {
      findFirst: jest.fn().mockResolvedValue({ id: CYCLE }),
    },
    contentWeekPlan: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "plan-1", status: "draft" }),
      update: jest.fn().mockResolvedValue({ id: "plan-1" }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: "plan-1", status: "draft", postPlans: [] }),
    },
    contentPostPlan: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 4 }),
    },
    ...overrides,
  };
}

function buildRepo(prisma: unknown) {
  return new ContentWeekPlanRepository(prisma as PrismaService);
}

function threePlans() {
  return [
    {
      position: 1,
      purpose: "a",
      channel: "instagram",
      format: "static_image_post",
      source: "planner" as const,
      intendedAudience: null,
      ctaLibraryEntryId: null,
      ownerInstructions: null,
      visualDirection: null,
      selectedMediaIds: [],
    },
    {
      position: 2,
      purpose: "b",
      channel: "facebook",
      format: "text_post",
      source: "planner" as const,
      intendedAudience: null,
      ctaLibraryEntryId: null,
      ownerInstructions: null,
      visualDirection: null,
      selectedMediaIds: [],
    },
    {
      position: 3,
      purpose: "c",
      channel: "tiktok",
      format: "short_video_script",
      source: "planner" as const,
      intendedAudience: null,
      ctaLibraryEntryId: null,
      ownerInstructions: null,
      visualDirection: null,
      selectedMediaIds: [],
    },
  ];
}

describe("ContentWeekPlanRepository", () => {
  it("creates a week plan with 3–5 ordered post plans", async () => {
    const tx = mockTx();
    const repo = buildRepo({
      $transaction: jest.fn(async (cb) => cb(tx)),
    });
    const plan = await repo.createOrReplaceWeekPlan(
      CYCLE,
      1,
      threePlans(),
      OWNER,
    );
    expect(plan.id).toBe("plan-1");
    expect(tx.contentCycle.findFirst).toHaveBeenCalledWith({
      where: { id: CYCLE, ownerUserId: OWNER },
      select: { id: true },
    });
  });

  it("rejects fewer than three post plans", async () => {
    const repo = buildRepo({ $transaction: jest.fn() });
    await expect(
      repo.createOrReplaceWeekPlan(CYCLE, 1, [], OWNER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a position gap", async () => {
    const repo = buildRepo({ $transaction: jest.fn() });
    await expect(
      repo.createOrReplaceWeekPlan(
        CYCLE,
        1,
        [
          {
            position: 1,
            purpose: "a",
            channel: "instagram",
            format: "static_image_post",
            source: "planner" as const,
            intendedAudience: null,
            ctaLibraryEntryId: null,
            ownerInstructions: null,
            visualDirection: null,
            selectedMediaIds: [],
          },
          {
            position: 3,
            purpose: "b",
            channel: "facebook",
            format: "text_post",
            source: "planner" as const,
            intendedAudience: null,
            ctaLibraryEntryId: null,
            ownerInstructions: null,
            visualDirection: null,
            selectedMediaIds: [],
          },
          {
            position: 4,
            purpose: "c",
            channel: "tiktok",
            format: "short_video_script",
            source: "planner" as const,
            intendedAudience: null,
            ctaLibraryEntryId: null,
            ownerInstructions: null,
            visualDirection: null,
            selectedMediaIds: [],
          },
        ],
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses to replace a frozen week plan", async () => {
    const tx = mockTx({
      contentWeekPlan: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: "plan-1", status: "frozen" }),
      },
    });
    const repo = buildRepo({
      $transaction: jest.fn(async (cb) => cb(tx)),
    });
    await expect(
      repo.createOrReplaceWeekPlan(CYCLE, 1, threePlans(), OWNER),
    ).rejects.toThrow("cannot be replaced");
  });

  it("freezes exactly one draft plan", async () => {
    const prisma = mockPrisma();
    const repo = new ContentWeekPlanRepository(prisma as PrismaService);
    const result = await repo.freezeWeekPlan(CYCLE, 1, {
      week_plan_id: "plan-1",
      content_cycle_id: CYCLE,
      week_number: 1,
      week_start_date: "2026-07-06",
      editorial_profile: {} as never,
      cta_entries: [],
      media_entries: [],
      post_plans: [],
      weekly_claim_id: "claim-1",
      frozen_at: new Date().toISOString(),
    });
    expect(result).toEqual({ frozen: true });
    expect(prisma.contentWeekPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contentCycleId: CYCLE, weekNumber: 1, status: "draft" },
      }),
    );
  });
});

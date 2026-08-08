import { BadRequestException } from "@nestjs/common";
import type { AiContentV2PlanResponse } from "@marketmind/contracts";
import { ContentV2Service, CONTENT_V2_REQUIRED } from "./content-v2.service";
import { ContentAiClient } from "../content.client";
import { ContentSetupRepository } from "./content-setup.repository";
import { ContentMediaLibraryRepository } from "./content-media.repository";
import { ContentWeekPlanRepository } from "./content-week-plan.repository";
import { ContentVersionEditRepository } from "./content-version-edit.repository";

const OWNER = "owner-1";
const CYCLE = "cycle-1";
const STRATEGY_VERSION = "strategy-version-1";

function buildService(overrides: Record<string, unknown> = {}) {
  const cycle = {
    id: CYCLE,
    contractVersion: "content-v2",
    businessId: "biz-1",
    strategyId: "strat-1",
    strategyVersion: 2,
    strategyDecisionId: "decision-1",
    profileVersionId: "prof-1",
    status: "active",
    currentWeekNumber: 1,
    nextGenerationAt: null,
    timezone: "Africa/Cairo",
    pauseReason: null,
    completedAt: null,
    ownerUserId: OWNER,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    contentCycle: { findFirst: jest.fn().mockResolvedValue(cycle) },
  };
  const strategyRepository = {
    getVersionByNumber: jest.fn().mockResolvedValue({
      planData: {
        contract_version: "strategy-v2",
        goal: { text: "جذب عملاء جدد" },
        plan_language: "ar-EG",
        content_handoff: {
          available: true,
          channels: ["instagram", "facebook"],
          language: "ar-EG",
          weeks: [{ week_number: 1, formats: ["static_image_post", "text_post"] }],
        },
      },
    }),
  };
  const setupRepository = {
    getEditorialProfile: jest.fn().mockResolvedValue({
      id: "ed-1",
      contentCycleId: CYCLE,
      audienceNuance: "n",
      voice: "v",
      language: "ar-EG",
      writingGuardrails: [],
      defaultVisualGuidance: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    listCtaEntries: jest.fn().mockResolvedValue([]),
  };
  const mediaRepository = {
    listCycleEntries: jest.fn().mockResolvedValue([]),
  };
  const weekPlanRepository = {
    createOrReplaceWeekPlan: jest.fn().mockResolvedValue({
      id: "week-plan-1",
      contentCycleId: CYCLE,
      weekNumber: 1,
      status: "draft",
      postPlans: [],
      frozenInput: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };
  const versionEditRepository = {};
  const contentAiClient = {
    plan: jest.fn(),
  };
  const assetStorage = { store: jest.fn() };

  const service = new ContentV2Service(
    prisma as never,
    strategyRepository as never,
    setupRepository as never,
    mediaRepository as never,
    { validateUpload: jest.fn(), checksum: jest.fn() } as never,
    weekPlanRepository as never,
    versionEditRepository as never,
    contentAiClient as never,
    assetStorage as never,
  );

  return {
    service,
    mocks: {
      setupRepository,
      mediaRepository,
      weekPlanRepository,
      contentAiClient,
      strategyRepository,
    },
  };
}

const PLAN_RESPONSE: AiContentV2PlanResponse = {
  contract_version: "content-v2",
  week_plan_id: CYCLE,
  post_plans: [
    {
      purpose: "Card 1",
      intended_audience: null,
      channel: "instagram",
      format: "static_image_post",
      cta_library_entry_id: null,
      owner_instructions: null,
      visual_direction: null,
      selected_media_ids: [],
    },
    {
      purpose: "Card 2",
      intended_audience: null,
      channel: "facebook",
      format: "text_post",
      cta_library_entry_id: null,
      owner_instructions: null,
      visual_direction: null,
      selected_media_ids: [],
    },
    {
      purpose: "Card 3",
      intended_audience: null,
      channel: "instagram",
      format: "static_image_post",
      cta_library_entry_id: null,
      owner_instructions: null,
      visual_direction: null,
      selected_media_ids: [],
    },
  ],
  validation: { valid: true, issues: [] },
};

describe("ContentV2Service.planWeek", () => {
  it("plans the current week and persists planner cards as a draft plan", async () => {
    const { service, mocks } = buildService();
    mocks.contentAiClient.plan.mockResolvedValue(PLAN_RESPONSE);

    const result = await service.planWeek(CYCLE, 1, OWNER);

    expect(mocks.contentAiClient.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        contract_version: "content-v2",
        week_number: 1,
        allowed_channels: ["instagram", "facebook"],
        allowed_formats: ["static_image_post", "text_post"],
        strategy_plan: expect.objectContaining({
          contract_version: "strategy-v2",
        }),
      }),
    );
    expect(mocks.weekPlanRepository.createOrReplaceWeekPlan).toHaveBeenCalledWith(
      CYCLE,
      1,
      [
        expect.objectContaining({ position: 1, source: "planner" }),
        expect.objectContaining({ position: 2, source: "planner" }),
        expect.objectContaining({ position: 3, source: "planner" }),
      ],
      OWNER,
    );
    expect(result.week_plan.id).toBe("week-plan-1");
  });

  it("rejects planning a non-current week", async () => {
    const { service } = buildService();
    await expect(service.planWeek(CYCLE, 2, OWNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("requires the editorial profile before planning", async () => {
    const { service, mocks } = buildService();
    mocks.setupRepository.getEditorialProfile.mockResolvedValue(null);
    await expect(service.planWeek(CYCLE, 1, OWNER)).rejects.toMatchObject({
      response: { code: CONTENT_V2_REQUIRED },
    });
  });

  it("requires a strategy-v2 plan with a usable handoff", async () => {
    const { service, mocks } = buildService();
    mocks.strategyRepository.getVersionByNumber.mockResolvedValue({
      planData: {
        contract_version: "strategy-v1",
        content_handoff: { available: false },
      },
    });
    await expect(service.planWeek(CYCLE, 1, OWNER)).rejects.toMatchObject({
      response: { code: CONTENT_V2_REQUIRED },
    });
  });

  it("rejects a week missing handoff formats", async () => {
    const { service, mocks } = buildService();
    mocks.strategyRepository.getVersionByNumber.mockResolvedValue({
      planData: {
        contract_version: "strategy-v2",
        content_handoff: {
          available: true,
          channels: ["instagram"],
          language: "ar-EG",
          weeks: [{ week_number: 2, formats: ["text_post"] }],
        },
      },
    });
    await expect(service.planWeek(CYCLE, 1, OWNER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

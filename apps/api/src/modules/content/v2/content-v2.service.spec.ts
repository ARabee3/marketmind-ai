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
          weeks: [
            { week_number: 1, formats: ["static_image_post", "text_post"] },
          ],
        },
      },
    }),
    getActiveConfirmedProfileVersion: jest.fn().mockResolvedValue(null),
    getProfileVersionById: jest.fn().mockResolvedValue({
      id: "prof-1",
      businessId: "biz-1",
      version: 1,
      profile: {
        business_name: "Test business",
        business_type: "service",
      },
      confirmedByUserId: OWNER,
      confirmedAt: new Date(),
      createdAt: new Date(),
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
    getWeekPlan: jest.fn(),
    listWeekPlans: jest.fn(),
  };
  const packRepository = {
    claimQueuedPackV2: jest.fn(),
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
    packRepository as never,
    { createIntent: jest.fn(), markDirectDispatched: jest.fn() } as never,
    { add: jest.fn() } as never,
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
    expect(
      mocks.weekPlanRepository.createOrReplaceWeekPlan,
    ).toHaveBeenCalledWith(
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

  it("plans with the deterministic fallback profile when none is configured", async () => {
    const { service, mocks } = buildService();
    mocks.setupRepository.getEditorialProfile.mockResolvedValue(null);
    mocks.contentAiClient.plan.mockResolvedValue(PLAN_RESPONSE);

    const result = await service.planWeek(CYCLE, 1, OWNER);

    expect(mocks.contentAiClient.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        editorial_profile: expect.objectContaining({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
          ),
          contract_version: "content-v2",
          language: "ar-EG",
          writing_guardrails: [],
        }),
      }),
    );
    expect(
      (
        mocks.contentAiClient.plan.mock.calls[0][0] as {
          editorial_profile: { voice: string };
        }
      ).editorial_profile.voice.length,
    ).toBeGreaterThan(0);
    expect(result.week_plan.id).toBe("week-plan-1");
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

  it("marks owner review complete independently from publication-candidate availability", () => {
    const { service } = buildService();
    const generationState = (
      service as unknown as {
        generationStateFor: (
          pack: { id: string; status: string },
          weekPlan: { status: string } | undefined,
          candidates: Array<{ contentPackId: string; state: string }>,
        ) => string;
      }
    ).generationStateFor;

    expect(
      generationState({ id: "pack-1", status: "approved" }, undefined, [
        { contentPackId: "pack-1", state: "active" },
      ]),
    ).toBe("completed");
    expect(
      generationState({ id: "pack-1", status: "approved" }, undefined, []),
    ).toBe("completed");
  });
});

describe("ContentV2Service.generateWeek", () => {
  function generateBuildService() {
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
      week1StartDate: new Date("2026-07-06T00:00:00.000Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      contentCycle: { findFirst: jest.fn().mockResolvedValue(cycle) },
      contentWeekContext: {
        findUnique: jest.fn().mockResolvedValue({
          id: "ctx-1",
          weeklyClaimId: "claim-1",
          weekStartDate: new Date("2026-07-06T00:00:00.000Z"),
        }),
      },
    };
    const weekPlanRepository = {
      getWeekPlan: jest.fn().mockResolvedValue({
        id: "week-plan-1",
        contentCycleId: CYCLE,
        weekNumber: 1,
        status: "draft",
        postPlans: [
          {
            id: "plan-1",
            contentWeekPlanId: "week-plan-1",
            position: 1,
            purpose: "a",
            intendedAudience: null,
            channel: "instagram",
            format: "static_image_post",
            ctaLibraryEntryId: null,
            ownerInstructions: null,
            visualDirection: null,
            selectedMediaIds: [],
            planState: "planned",
            source: "planner",
            contentItemId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "plan-2",
            contentWeekPlanId: "week-plan-1",
            position: 2,
            purpose: "b",
            intendedAudience: null,
            channel: "facebook",
            format: "static_image_post",
            ctaLibraryEntryId: null,
            ownerInstructions: null,
            visualDirection: null,
            selectedMediaIds: [],
            planState: "planned",
            source: "planner",
            contentItemId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "plan-3",
            contentWeekPlanId: "week-plan-1",
            position: 3,
            purpose: "c",
            intendedAudience: null,
            channel: "instagram",
            format: "short_video_script",
            ctaLibraryEntryId: null,
            ownerInstructions: null,
            visualDirection: null,
            selectedMediaIds: [],
            planState: "planned",
            source: "planner",
            contentItemId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
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
      listCtaEntries: jest.fn().mockResolvedValue([
        {
          id: "cta-1",
          contentCycleId: CYCLE,
          label: "اطلب",
          destination: { type: "whatsapp", value: "+201001234567" },
          campaignContext: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "cta-2",
          contentCycleId: CYCLE,
          label: "قديم",
          destination: { type: "none", value: null },
          campaignContext: null,
          active: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };
    const mediaRepository = {
      listCycleEntries: jest.fn().mockResolvedValue([]),
    };
    const packRepository = {
      claimQueuedPackV2: jest.fn().mockResolvedValue({
        pack: {
          id: "pack-1",
          contractVersion: "content-v2",
          contentCycleId: CYCLE,
          weeklyClaimId: "claim-1",
          weekNumber: 1,
          businessId: "biz-1",
          strategyId: "strat-1",
          strategyVersion: 2,
          strategyDecisionId: "decision-1",
          profileVersionId: "prof-1",
          weekContextId: "ctx-1",
          status: "queued",
          retryEligible: true,
          itemIds: [],
          weekPlanId: "week-plan-1",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        created: true,
      }),
    };
    const jobOutbox = {
      markDirectDispatched: jest.fn().mockResolvedValue(undefined),
    };
    const contentQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const service = new ContentV2Service(
      prisma as never,
      {
        getVersionByNumber: jest.fn().mockResolvedValue({
          planData: {
            contract_version: "strategy-v2",
            content_handoff: {
              available: true,
              channels: ["instagram", "facebook"],
              language: "ar-EG",
              weeks: [
                {
                  week_number: 1,
                  formats: ["static_image_post", "short_video_script"],
                },
              ],
            },
          },
        }),
        getActiveConfirmedProfileVersion: jest.fn().mockResolvedValue(null),
        getProfileVersionById: jest.fn().mockResolvedValue({
          id: "prof-1",
          businessId: "biz-1",
          version: 1,
          profile: {},
          confirmedByUserId: OWNER,
          confirmedAt: new Date(),
          createdAt: new Date(),
        }),
      } as never,
      setupRepository as never,
      mediaRepository as never,
      { validateUpload: jest.fn(), checksum: jest.fn() } as never,
      weekPlanRepository as never,
      {} as never,
      { plan: jest.fn() } as never,
      packRepository as never,
      jobOutbox as never,
      contentQueue as never,
      { store: jest.fn() } as never,
    );

    return {
      service,
      mocks: { packRepository, jobOutbox, contentQueue, weekPlanRepository },
    };
  }

  it("freezes the week plan and claims the week with a frozen snapshot", async () => {
    const { service, mocks } = generateBuildService();

    const result = await service.generateWeek(
      CYCLE,
      1,
      { content_cycle_id: CYCLE, week_number: 1, idempotency_key: "k-1" },
      OWNER,
    );

    expect(mocks.packRepository.claimQueuedPackV2).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: CYCLE,
        weekNumber: 1,
        weekContextId: "ctx-1",
        weekPlanId: "week-plan-1",
        frozenInput: expect.objectContaining({
          week_plan_id: "week-plan-1",
          content_cycle_id: CYCLE,
          week_number: 1,
          week_start_date: "2026-07-06",
          weekly_claim_id: "claim-1",
          post_plans: expect.arrayContaining([
            expect.objectContaining({ position: 1, channel: "instagram" }),
            expect.objectContaining({ position: 2, channel: "facebook" }),
          ]),
        }),
      }),
    );
    // Only active CTA entries are frozen into the snapshot.
    const frozenInput = (
      mocks.packRepository.claimQueuedPackV2.mock.calls[0][0] as {
        frozenInput: { cta_entries: unknown[] };
      }
    ).frozenInput;
    expect(frozenInput.cta_entries).toHaveLength(1);
    expect(mocks.contentQueue.add).toHaveBeenCalledWith(
      "generate-content-v2",
      expect.objectContaining({ contentPackId: "pack-1" }),
      expect.any(Object),
    );
    expect(mocks.jobOutbox.markDirectDispatched).toHaveBeenCalledWith(
      "generate-content-v2-pack-1",
    );
    expect(result.content_pack.week_plan_id).toBe("week-plan-1");
    expect(result.status).toBe("queued");
  });

  it("requires a draft week plan before generation", async () => {
    const { service, mocks } = generateBuildService();
    mocks.weekPlanRepository.getWeekPlan.mockResolvedValue(null);
    await expect(
      service.generateWeek(
        CYCLE,
        1,
        { content_cycle_id: CYCLE, week_number: 1, idempotency_key: "k-1" },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects generation for a non-current week", async () => {
    const { service } = generateBuildService();
    await expect(
      service.generateWeek(
        CYCLE,
        2,
        { content_cycle_id: CYCLE, week_number: 2, idempotency_key: "k-1" },
        OWNER,
      ),
    ).rejects.toMatchObject({
      response: { code: "CONTENT_WEEK_ALREADY_CLAIMED" },
    });
  });
});

describe("ContentV2Service.generateMediaForItem", () => {
  const baseVersion = {
    id: "base-version-1",
    contentItemId: "item-1",
    contentPackId: "pack-1",
    version: 1,
    channel: "instagram",
    format: "static_image_post",
    languageMode: "ar-EG",
    strategyTrace: {
      strategy_id: "strategy-1",
      strategy_version: 2,
      week_number: 1,
      pillar_ids: [],
      objective: "awareness",
      channel: "instagram",
      funnel_stage: "awareness",
      content_purpose: "announce",
    },
    captionVariants: [
      {
        locale: "ar",
        dialect: "masry",
        caption: "محتوى",
        cta: null,
        hashtags: [],
      },
    ],
    cta: null,
    hashtags: [],
    creativeBrief: "brief",
    altText: "صورة",
    shortVideoScript: null,
    recommendedPublishWindow: {
      starts_at: "2026-08-10T10:00:00.000Z",
      ends_at: "2026-08-10T12:00:00.000Z",
      timezone: "Africa/Cairo",
      day_preference: "weekday",
      time_of_day_hint: "morning",
      rationale: "",
    },
    claimSources: [],
    warnings: [],
    blockers: [],
    assetRequired: false,
    assetIds: [],
    generationProvenance: {
      generation_run_id: "run-1",
      provider_name: "mock",
      provider_model: "mock",
      generated_at: "2026-08-09T10:00:00.000Z",
    },
    versionChecksum: "b".repeat(64),
    editKind: "generated",
    baseVersionId: null,
    baseVersionChecksum: null,
    editedByUserId: null,
    editedAt: new Date("2026-08-09T10:00:00.000Z"),
    createdAt: new Date("2026-08-09T10:00:00.000Z"),
  };

  function buildMediaService() {
    const tx = {};
    const generatedVersion = {
      ...baseVersion,
      id: "new-version-1",
      version: 2,
      assetIds: ["generated-asset"],
      blockers: ["CONTENT_ASSET_REQUIRED"],
      editKind: "media_update",
      baseVersionId: baseVersion.id,
      baseVersionChecksum: baseVersion.versionChecksum,
      editedByUserId: OWNER,
      editedAt: new Date("2026-08-09T10:01:00.000Z"),
      createdAt: new Date("2026-08-09T10:01:00.000Z"),
    };
    const prisma = {
      contentPack: {
        findUnique: jest.fn().mockResolvedValue({
          id: "pack-1",
          contractVersion: "content-v2",
          contentCycleId: CYCLE,
          contentCycle: { ownerUserId: OWNER },
          weekContext: {},
          status: "draft",
        }),
      },
      contentItemVersion: {
        findFirst: jest.fn().mockResolvedValue(baseVersion),
      },
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
    };
    const versionEditRepository = {
      appendOwnerEditVersion: jest.fn().mockResolvedValue(generatedVersion),
    };
    const jobOutbox = {
      createIntent: jest.fn().mockResolvedValue({}),
      markDirectDispatched: jest.fn().mockResolvedValue(true),
    };
    const contentQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const packRepository = {
      getItemById: jest.fn().mockResolvedValue({
        id: "item-1",
        currentVersionId: baseVersion.id,
      }),
    };
    const service = new ContentV2Service(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      versionEditRepository as never,
      {} as never,
      packRepository as never,
      jobOutbox as never,
      contentQueue as never,
      {} as never,
    );
    return {
      service,
      mocks: {
        prisma,
        versionEditRepository,
        jobOutbox,
        contentQueue,
        packRepository,
        tx,
      },
    };
  }

  it("sanitizes the direct BullMQ id and commits the outbox intent with the version", async () => {
    const { service, mocks } = buildMediaService();

    await service.generateMediaForItem(
      "pack-1",
      "item-1",
      {
        base_version_id: baseVersion.id,
        base_version_checksum: baseVersion.versionChecksum,
        visual_instruction: "simple product photo",
        idempotency_key: "media-key-1",
      },
      OWNER,
    );

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(
      mocks.versionEditRepository.appendOwnerEditVersion,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        editKind: "media_update",
        assetIds: [expect.any(String)],
        blockers: [],
      }),
      mocks.tx,
    );
    const durableJobId = (
      mocks.jobOutbox.createIntent.mock.calls[0][0] as { jobId: string }
    ).jobId;
    expect(durableJobId).toContain(":");
    expect(mocks.jobOutbox.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: durableJobId }),
      mocks.tx,
    );
    expect(mocks.contentQueue.add.mock.calls[0][2].jobId).toBe(
      durableJobId.replace(/:/g, "-"),
    );
    expect(mocks.contentQueue.add.mock.calls[0][1]).toEqual(
      expect.objectContaining({ width: 1024, height: 1024 }),
    );
    expect(mocks.jobOutbox.markDirectDispatched).toHaveBeenCalledWith(
      durableJobId,
    );
  });

  it("blocks media changes after the post is approved", async () => {
    const { service, mocks } = buildMediaService();
    mocks.packRepository.getItemById.mockResolvedValue({
      id: "item-1",
      currentVersionId: baseVersion.id,
      status: "approved",
    });

    await expect(
      service.generateMediaForItem(
        "pack-1",
        "item-1",
        {
          base_version_id: baseVersion.id,
          base_version_checksum: baseVersion.versionChecksum,
          idempotency_key: "media-key-approved",
        },
        OWNER,
      ),
    ).rejects.toMatchObject({
      response: { code: "CONTENT_APPROVAL_BLOCKED" },
    });
    expect(
      mocks.versionEditRepository.appendOwnerEditVersion,
    ).not.toHaveBeenCalled();
    expect(mocks.contentQueue.add).not.toHaveBeenCalled();
  });

  it("blocks media changes after the pack is approved", async () => {
    const { service, mocks } = buildMediaService();
    mocks.prisma.contentPack.findUnique.mockResolvedValue({
      id: "pack-1",
      contractVersion: "content-v2",
      contentCycleId: CYCLE,
      contentCycle: { ownerUserId: OWNER },
      weekContext: {},
      status: "approved",
    });
    mocks.packRepository.getItemById.mockResolvedValue({
      id: "item-1",
      currentVersionId: baseVersion.id,
      status: "draft",
    });

    await expect(
      service.generateMediaForItem(
        "pack-1",
        "item-1",
        {
          base_version_id: baseVersion.id,
          base_version_checksum: baseVersion.versionChecksum,
          idempotency_key: "media-key-approved-pack",
        },
        OWNER,
      ),
    ).rejects.toMatchObject({
      response: { code: "CONTENT_APPROVAL_BLOCKED" },
    });
    expect(
      mocks.versionEditRepository.appendOwnerEditVersion,
    ).not.toHaveBeenCalled();
    expect(mocks.contentQueue.add).not.toHaveBeenCalled();
  });
});

describe("ContentV2Service.getPackWorkspace", () => {
  it("keeps a text-only post reviewable when optional media is absent or failed", async () => {
    const now = new Date("2026-08-09T10:00:00.000Z");
    const version = {
      id: "version-1",
      contractVersion: "content-v2",
      contentItemId: "item-1",
      contentPackId: "pack-1",
      version: 1,
      channel: "facebook",
      format: "text_post",
      languageMode: "ar-EG",
      strategyTrace: {},
      captionVariants: [],
      cta: null,
      hashtags: [],
      creativeBrief: "brief",
      altText: "alt",
      shortVideoScript: null,
      recommendedPublishWindow: {},
      claimSources: [],
      warnings: [],
      blockers: [],
      assetRequired: false,
      assetIds: ["asset-1"],
      generationProvenance: {},
      versionChecksum: "a".repeat(64),
      editKind: "generated",
      baseVersionId: null,
      baseVersionChecksum: null,
      editedByUserId: null,
      validationState: "validated",
      editedAt: now,
      createdAt: now,
      assetLinks: [
        {
          asset: {
            id: "asset-1",
            kind: "generated_static",
            status: "failed",
            mimeType: null,
            width: null,
            height: null,
            altText: "alt",
            failureCode: "CONTENT_PROVIDER_FAILURE",
            createdAt: now,
          },
        },
      ],
    };
    const pack = {
      id: "pack-1",
      contractVersion: "content-v2",
      contentCycleId: CYCLE,
      weeklyClaimId: "claim-1",
      weekNumber: 1,
      businessId: "biz-1",
      strategyId: "strategy-1",
      strategyVersion: 1,
      strategyDecisionId: "decision-1",
      profileVersionId: "profile-1",
      weekContextId: "context-1",
      status: "draft",
      retryEligible: false,
      itemIds: ["item-1"],
      weekPlanId: null,
      createdAt: now,
      updatedAt: now,
      contentCycle: { ownerUserId: OWNER },
      weekContext: { weekStartDate: now },
    };
    const prisma = {
      contentPack: { findUnique: jest.fn().mockResolvedValue(pack) },
      contentItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "item-1",
            currentVersionId: version.id,
            versions: [version],
            decisions: [],
          },
        ]),
      },
      publicationCandidate: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ContentV2Service(
      prisma as never,
      {} as never,
      { getEditorialProfile: jest.fn().mockResolvedValue(null) } as never,
      { listCycleEntries: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const workspace = await service.getPackWorkspace("pack-1", OWNER);

    expect(workspace.items[0].approval_state).toBe("ready");
  });
});

describe("ContentV2Service.rewriteItem", () => {
  function rewriteBuild() {
    const baseVersion = {
      id: "ver-1",
      contractVersion: "content-v2",
      contentItemId: "item-1",
      contentPackId: "pack-1",
      version: 1,
      channel: "instagram",
      format: "static_image_post",
      languageMode: "ar-EG",
      strategyTrace: { week_number: 1 },
      captionVariants: [],
      cta: null,
      hashtags: [],
      creativeBrief: "brief",
      altText: "alt",
      shortVideoScript: null,
      recommendedPublishWindow: {},
      claimSources: [],
      warnings: [],
      blockers: [],
      assetRequired: false,
      assetIds: [],
      generationProvenance: {},
      versionChecksum: "a".repeat(64),
      editKind: "generated",
      baseVersionId: null,
      baseVersionChecksum: null,
      editedByUserId: null,
      validationState: "validated",
      editedAt: new Date(),
      createdAt: new Date(),
    };
    const pack = {
      id: "pack-1",
      contractVersion: "content-v2",
      contentCycleId: CYCLE,
      weeklyClaimId: "claim-1",
      weekNumber: 1,
      businessId: "biz-1",
      strategyId: "strat-1",
      strategyVersion: 2,
      strategyDecisionId: "decision-1",
      profileVersionId: "prof-1",
      weekContextId: "ctx-1",
      status: "draft",
      retryEligible: false,
      itemIds: ["item-1"],
      weekPlanId: "week-plan-1",
      contentCycle: { ownerUserId: OWNER },
      weekContext: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      contentPack: { findUnique: jest.fn().mockResolvedValue(pack) },
      contentItemVersion: {
        findFirst: jest.fn().mockResolvedValue(baseVersion),
      },
      contentWeekPlan: {
        findUnique: jest.fn().mockResolvedValue({
          id: "week-plan-1",
          frozenInput: {
            week_plan_id: "week-plan-1",
            content_cycle_id: CYCLE,
            week_number: 1,
            week_start_date: "2026-07-06",
            editorial_profile: { language: "ar-EG" },
            cta_entries: [],
            media_entries: [],
            post_plans: [{ content_item_id: "item-1", position: 1 }],
            weekly_claim_id: "claim-1",
            frozen_at: "2026-08-02T12:00:00+03:00",
          },
        }),
      },
    };
    const strategyRepository = {
      getVersionByNumber: jest.fn().mockResolvedValue({
        planData: { contract_version: "strategy-v2" },
      }),
      getActiveConfirmedProfileVersion: jest.fn().mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
        version: 1,
        profile: {},
        confirmedByUserId: OWNER,
        confirmedAt: new Date(),
        createdAt: new Date(),
      }),
      getProfileVersionById: jest.fn().mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
        version: 1,
        profile: {},
        confirmedByUserId: OWNER,
        confirmedAt: new Date(),
        createdAt: new Date(),
      }),
    };
    const contentAiClient = {
      reviseV2: jest.fn().mockResolvedValue({
        contract_version: "content-v2",
        item_version: {
          id: "ver-2",
          contract_version: "content-v2",
          content_item_id: "item-1",
          content_pack_id: "pack-1",
          version: 2,
          channel: "instagram",
          format: "static_image_post",
          language_mode: "ar-EG",
          strategy_trace: { week_number: 1 },
          caption_variants: [],
          cta: null,
          hashtags: [],
          creative_brief: "rewritten",
          alt_text: "alt",
          short_video_script: null,
          recommended_publish_window: {},
          claim_sources: [],
          warnings: [],
          blockers: [],
          asset_required: false,
          asset_ids: [],
          generation_provenance: { provider_name: "mock" },
          version_checksum: "b".repeat(64),
          created_at: "2026-08-02T13:00:00+03:00",
          edit_metadata: {
            edit_kind: "ai_rewrite",
            base_version_id: "ver-1",
            base_version_checksum: "a".repeat(64),
            edited_by_user_id: null,
            validation_state: "validated",
            edited_at: "2026-08-02T13:00:00+03:00",
          },
        },
        validation: { valid: true, issues: [] },
      }),
    };
    const versionEditRepository = {
      appendAiRewriteVersion: jest.fn().mockResolvedValue({
        ...baseVersion,
        id: "ver-2",
        version: 2,
        editKind: "ai_rewrite",
      }),
    };
    const packRepository = {
      getItemById: jest.fn().mockResolvedValue({
        id: "item-1",
        currentVersionId: baseVersion.id,
        status: "draft",
      }),
    };
    const service = new ContentV2Service(
      prisma as never,
      strategyRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      versionEditRepository as never,
      contentAiClient as never,
      packRepository as never,
      {} as never,
      { add: jest.fn() } as never,
      {} as never,
    );
    return {
      service,
      mocks: { contentAiClient, versionEditRepository, packRepository },
    };
  }

  it("rewrites an item via the AI service and persists an ai_rewrite version", async () => {
    const { service, mocks } = rewriteBuild();

    const result = await service.rewriteItem(
      "pack-1",
      "item-1",
      {
        contract_version: "content-v2",
        base_version_id: "ver-1",
        base_version_checksum: "a".repeat(64),
        revision_notes: "اجعل العنوان أكثر جاذبية",
        idempotency_key: "rw-1",
      },
      OWNER,
    );

    expect(mocks.contentAiClient.reviseV2).toHaveBeenCalledWith(
      expect.objectContaining({
        content_pack_id: "pack-1",
        content_item_id: "item-1",
        revision_notes: "اجعل العنوان أكثر جاذبية",
        base_item_version: expect.objectContaining({ id: "ver-1" }),
        frozen_input: expect.objectContaining({ week_plan_id: "week-plan-1" }),
      }),
    );
    expect(
      mocks.versionEditRepository.appendAiRewriteVersion,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: "item-1",
        newVersionNumber: 2,
        versionChecksum: "b".repeat(64),
      }),
    );
    expect(result.item_version).toBeTruthy();
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { ProviderError } from "../../common/errors/provider-error";
import { ContentProcessor } from "./content.processor";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentWeekPlanRepository } from "./v2/content-week-plan.repository";
import { PrismaService } from "../../common/persistence/prisma.service";
import { StrategyRepository } from "../strategy/strategy.repository";
import { ContentAiClient } from "./content.client";
import { CONTENT_ASSET_STORAGE } from "./assets/asset-storage.port";

jest.mock("@marketmind/contracts", () => ({
  ...jest.requireActual("@marketmind/contracts"),
  validateContentPolicyFixture: jest
    .fn()
    .mockReturnValue({ valid: true, issues: [] }),
}));

import {
  computeContentItemVersionChecksum,
  deterministicGeneratedAssetId,
  validateContentPolicyFixture,
} from "@marketmind/contracts";

// ── Fixtures ──────────────────────────────────────────────────────────

const PACK = {
  id: "pack-1",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weeklyClaimId: "claim-1",
  weekNumber: 1,
  businessId: "business-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  strategyDecisionId: "decision-1",
  profileVersionId: "profile-1",
  weekContextId: "week-1",
  status: "queued",
  retryEligible: true,
  itemIds: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const CYCLE = {
  id: "cycle-1",
  contractVersion: "content-v1",
  businessId: "business-1",
  strategyId: "strategy-1",
  strategyVersion: 3,
  strategyDecisionId: "decision-1",
  profileVersionId: "profile-1",
  ownerUserId: "owner-1",
  status: "active",
  currentWeekNumber: 1,
  nextGenerationAt: new Date(),
  timezone: "Africa/Cairo",
  pauseReason: null,
  completedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const WEEK_CONTEXT = {
  id: "week-1",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weekNumber: 1,
  weekStartDate: new Date("2026-01-01"),
  promotionMode: "none",
  promotion: null,
  mustInclude: [],
  mustAvoid: [],
  approvedAssetIds: [],
  ctaDestination: { type: "none", value: null },
  generationCutoffAt: new Date("2026-01-02"),
  weeklyClaimId: "claim-1",
  contextSource: "owner_confirmed",
  confirmedByUserId: "owner-1",
  confirmedAt: new Date("2025-12-20"),
  systemDefaultedAt: null,
  frozenAt: null,
  createdAt: new Date("2025-12-20"),
};

const STRATEGY = {
  id: "strategy-1",
  businessId: "business-1",
  status: "approved",
  briefId: "brief-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  brief: null,
};

const STRATEGY_VERSION = {
  id: "ver-1",
  strategyId: "strategy-1",
  version: 3,
  planData: {
    plan_language: "ar-EG",
    content_strategy: {
      weeks: [
        {
          week_number: 1,
          theme: "التعريف",
          formats: ["reels", "photo", "poll"],
        },
      ],
    },
    selected_channels: [{ channel: "instagram" }, { channel: "facebook" }],
  },
  created_at: new Date("2026-01-01"),
};

const STRATEGY_DECISION = {
  id: "decision-1",
  strategyId: "strategy-1",
  strategyVersionId: "ver-1",
  action: "approve",
  decidedByUserId: "owner-1",
  decidedAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
};

const PROFILE_VERSION = {
  id: "profile-1",
  businessId: "business-1",
  draftId: "draft-1",
  version: 1,
  profile: {
    business_name: "Test Business",
    business_type: "retail",
    city: "Cairo",
    primary_locale: "ar-EG",
  },
  confirmedByUserId: "owner-1",
  confirmedAt: new Date("2026-01-01"),
  createdAt: new Date("2026-01-01"),
};

function makeItemVersion(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const item = {
    id,
    contract_version: "content-v1",
    content_item_id: `item-${id}`,
    content_pack_id: "pack-1",
    version: 1,
    channel: "instagram",
    format: "post",
    language_mode: "ar-EG",
    strategy_trace: {
      strategy_id: "strategy-1",
      strategy_version: 3,
      week_number: 1,
      channel: "instagram",
    },
    caption_variants: [{ locale: "ar-EG", caption: "نص تجريبي" }],
    cta: "رابط",
    hashtags: ["#cairo"],
    creative_brief: "إعلان تجريبي",
    alt_text: "وصف الصورة",
    short_video_script: null,
    recommended_publish_window: {
      starts_at: "2026-01-03",
      ends_at: "2026-01-04",
    },
    claim_sources: [],
    warnings: [],
    blockers: [],
    asset_required: false,
    asset_ids: [],
    generation_provenance: {
      generation_run_id: "run-1",
      provider_name: "mock",
      provider_model: "mock-v1",
      generated_at: "2026-01-01T00:00:00.000Z",
    },
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return {
    ...item,
    version_checksum: computeContentItemVersionChecksum(item),
  };
}

const AI_RESPONSE_3_ITEMS = {
  contract_version: "content-v1",
  content_pack: {
    id: "pack-1",
    contract_version: "content-v1",
    content_cycle_id: "cycle-1",
    weekly_claim_id: "claim-1",
    week_number: 1,
    business_id: "business-1",
    strategy_id: "strategy-1",
    strategy_version: 3,
    strategy_decision_id: "decision-1",
    profile_version_id: "profile-1",
    week_context_id: "week-1",
    status: "draft",
    retry_eligible: false,
    item_ids: ["item-1", "item-2", "item-3"],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  item_versions: [
    makeItemVersion("1"),
    makeItemVersion("2"),
    makeItemVersion("3"),
  ],
  validation: { valid: true, issues: [] },
};

const AI_RESPONSE_6_ITEMS = {
  ...AI_RESPONSE_3_ITEMS,
  content_pack: {
    ...AI_RESPONSE_3_ITEMS.content_pack,
    item_ids: ["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"],
  },
  item_versions: [
    makeItemVersion("1"),
    makeItemVersion("2"),
    makeItemVersion("3"),
    makeItemVersion("4"),
    makeItemVersion("5"),
    makeItemVersion("6"),
  ],
};

const AI_RESPONSE_WITH_GENERATED_ASSET = {
  ...AI_RESPONSE_3_ITEMS,
  item_versions: [
    makeItemVersion("1", {
      asset_required: true,
      format: "static_image_post",
    }),
    makeItemVersion("2"),
    makeItemVersion("3"),
  ],
};

const JOB_DATA = {
  contentCycleId: "cycle-1",
  weekNumber: 1,
  contentPackId: "pack-1",
  idempotencyKey: "idem-1",
  correlationId: "corr-1",
};

function makeJob(data = JOB_DATA) {
  return {
    id: "job-1",
    name: "generate-content",
    data,
  } as never;
}

// ── Test suite ────────────────────────────────────────────────────────

describe("ContentProcessor", () => {
  let processor: ContentProcessor;
  let packRepo: jest.Mocked<Partial<ContentPackRepository>>;
  let cycleRepo: jest.Mocked<Partial<ContentCycleRepository>>;
  let weekContextRepo: jest.Mocked<Partial<ContentWeekContextRepository>>;
  let weekPlanRepo: jest.Mocked<Partial<ContentWeekPlanRepository>>;
  let strategyRepo: jest.Mocked<Partial<StrategyRepository>>;
  let client: jest.Mocked<Partial<ContentAiClient>>;
  let assetStorage: { store: jest.Mock };
  let prisma: {
    contentWeekPlan: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    packRepo = {
      getPackById: jest.fn().mockResolvedValue(PACK),
      markPackStatus: jest.fn().mockResolvedValue({ changed: true }),
      appendProgressEvent: jest.fn().mockResolvedValue({}),
      persistGeneratedItems: jest.fn().mockResolvedValue(PACK),
      safeFail: jest.fn().mockResolvedValue(undefined),
    };
    cycleRepo = {
      getCycleById: jest.fn().mockResolvedValue(CYCLE),
    };
    weekContextRepo = {
      getWeekById: jest.fn().mockResolvedValue(WEEK_CONTEXT),
    };
    weekPlanRepo = {
      markPlansGenerating: jest.fn().mockResolvedValue(undefined),
      markPlansFailed: jest.fn().mockResolvedValue(undefined),
      attachGeneratedItem: jest.fn().mockResolvedValue(undefined),
    };
    strategyRepo = {
      readStrategy: jest.fn().mockResolvedValue(STRATEGY),
      getVersionByNumber: jest.fn().mockResolvedValue(STRATEGY_VERSION),
      getDecisionById: jest.fn().mockResolvedValue(STRATEGY_DECISION),
      getActiveConfirmedProfileVersion: jest
        .fn()
        .mockResolvedValue(PROFILE_VERSION),
    };
    client = {
      generate: jest.fn().mockResolvedValue(AI_RESPONSE_3_ITEMS),
    };
    assetStorage = {
      store: jest.fn(),
    };
    prisma = {
      contentWeekPlan: { findUnique: jest.fn() },
    };

    (validateContentPolicyFixture as jest.Mock).mockReturnValue({
      valid: true,
      issues: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentProcessor,
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekContextRepo },
        { provide: ContentWeekPlanRepository, useValue: weekPlanRepo },
        { provide: PrismaService, useValue: prisma },
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentAiClient, useValue: client },
        { provide: CONTENT_ASSET_STORAGE, useValue: assetStorage },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    processor = module.get<ContentProcessor>(ContentProcessor);
  });

  // ── Happy path ──────────────────────────────────────────────────────

  describe("generate-content — happy path", () => {
    it("claims queued→generating, calls AI, marks generating→validating, validates fixture, and persists 3 items", async () => {
      await processor.process(makeJob());

      expect(packRepo.getPackById).toHaveBeenCalledWith("pack-1");
      expect(packRepo.markPackStatus).toHaveBeenNthCalledWith(
        1,
        "pack-1",
        "queued",
        "generating",
      );
      expect(packRepo.appendProgressEvent).toHaveBeenCalledWith("pack-1", {
        stage: "generating",
        status: "started",
        messageKey: "content.generating",
        messageText: "Generating content items…",
        payload: { correlation_id: "corr-1" },
      });
      expect(client.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          contract_version: "content-v1",
          content_pack_id: "pack-1",
          business_id: "business-1",
          strategy_id: "strategy-1",
          strategy_version: 3,
          strategy_decision_id: "decision-1",
          language_mode: "ar-EG",
        }),
      );
      expect(packRepo.markPackStatus).toHaveBeenNthCalledWith(
        2,
        "pack-1",
        "generating",
        "validating",
      );
      expect(validateContentPolicyFixture).toHaveBeenCalledTimes(3);
      expect(packRepo.persistGeneratedItems).toHaveBeenCalledWith(
        expect.objectContaining({
          packId: "pack-1",
          cycleId: "cycle-1",
          weekNumber: 1,
          items: expect.arrayContaining([
            expect.objectContaining({ channel: "instagram", format: "post" }),
          ]),
        }),
      );
      expect(packRepo.safeFail).not.toHaveBeenCalled();
    });

    it("persists 3 items with correct mapping from AI response", async () => {
      await processor.process(makeJob());

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const persistCall = (packRepo.persistGeneratedItems as jest.Mock).mock
        .calls[0][0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(persistCall.items).toHaveLength(3);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(persistCall.items[0]).toEqual(
        expect.objectContaining({
          channel: "instagram",
          format: "post",
          languageMode: "ar-EG",
          assetRequired: false,
          assetIds: [],
          versionChecksum:
            AI_RESPONSE_3_ITEMS.item_versions[0].version_checksum,
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(persistCall.providerName).toBe("mock");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(persistCall.providerModel).toBe("mock-v1");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(persistCall.progressEvent).toEqual({
        stage: "ready",
        status: "complete",
        messageKey: "content.ready",
        messageText: "Content pack draft ready for review.",
      });
    });

    it("keeps a planned generated asset in the policy fixture until the asset worker runs", async () => {
      const assetVersionId = String(
        AI_RESPONSE_WITH_GENERATED_ASSET.item_versions[0].id,
      );
      const assetId = deterministicGeneratedAssetId(assetVersionId);
      client.generate.mockResolvedValue(
        AI_RESPONSE_WITH_GENERATED_ASSET as never,
      );
      packRepo.listReusableAssets = jest.fn().mockResolvedValue([]);
      packRepo.getAssetById = jest.fn().mockResolvedValue({
        id: assetId,
        contentItemVersionId: assetVersionId,
        status: "generating",
      });

      await processor.process(makeJob());

      const assetFixture = (
        validateContentPolicyFixture as jest.Mock
      ).mock.calls
        .map((call) => call[0])
        .reverse()
        .find((fixture) => fixture.item_version.asset_required);
      expect(assetFixture.assets).toEqual([
        expect.objectContaining({
          id: assetId,
          content_item_version_id: assetVersionId,
          kind: "generated_static",
          status: "generating",
          review_required: true,
        }),
      ]);
      expect(packRepo.persistGeneratedItems).toHaveBeenCalledWith(
        expect.objectContaining({
          assetJobs: [
            expect.objectContaining({
              assetId,
              contentItemVersionId: assetVersionId,
            }),
          ],
        }),
      );
    });

    it("exposes only explicitly approved reusable assets to policy validation", async () => {
      const assetId = "asset-approved";
      const response = {
        ...AI_RESPONSE_3_ITEMS,
        item_versions: [
          makeItemVersion("1", {
            asset_required: true,
            format: "static_image_post",
            asset_ids: [assetId],
          }),
          makeItemVersion("2"),
          makeItemVersion("3"),
        ],
      };
      client.generate.mockResolvedValue(response as never);
      weekContextRepo.getWeekById.mockResolvedValue({
        ...WEEK_CONTEXT,
        approvedAssetIds: [assetId],
      });
      packRepo.listReusableAssets = jest.fn().mockResolvedValue([
        {
          id: assetId,
          contentItemVersionId: "prior-version",
          kind: "owner_supplied",
          status: "ready",
          mimeType: "image/jpeg",
          storageKey: "asset/key",
          checksum: "a".repeat(64),
          width: 1024,
          height: 1024,
          altText: "وصف الصورة",
          providerName: null,
          providerModel: null,
          providerRequestId: null,
          failureCode: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]);
      packRepo.getAssetById = jest.fn().mockResolvedValue(null);

      await processor.process(makeJob());

      expect(packRepo.listReusableAssets).toHaveBeenCalledWith(
        [assetId],
        "business-1",
        "owner-1",
      );
      const assetFixture = (
        validateContentPolicyFixture as jest.Mock
      ).mock.calls
        .map((call) => call[0])
        .reverse()
        .find((fixture) => fixture.item_version.asset_required);
      expect(assetFixture.assets).toEqual([
        expect.objectContaining({
          id: assetId,
          content_item_version_id: "1",
          kind: "owner_supplied",
          status: "ready",
          review_required: false,
        }),
      ]);
    });

    it("does not put an unapproved reusable asset in the policy fixture", async () => {
      const assetId = "asset-not-approved";
      const response = {
        ...AI_RESPONSE_3_ITEMS,
        item_versions: [
          makeItemVersion("1", {
            asset_required: true,
            format: "static_image_post",
            asset_ids: [assetId],
          }),
          makeItemVersion("2"),
          makeItemVersion("3"),
        ],
      };
      client.generate.mockResolvedValue(response as never);
      packRepo.listReusableAssets = jest
        .fn()
        .mockResolvedValue([{ id: assetId, status: "ready" }]);
      packRepo.getAssetById = jest.fn().mockResolvedValue(null);

      await processor.process(makeJob());

      expect(packRepo.listReusableAssets).toHaveBeenCalledWith(
        [],
        "business-1",
        "owner-1",
      );
      const assetFixture = (
        validateContentPolicyFixture as jest.Mock
      ).mock.calls
        .map((call) => call[0])
        .reverse()
        .find((fixture) => fixture.item_version.asset_required);
      expect(assetFixture.assets).toEqual([]);
    });
  });

  describe("generate-content-v2", () => {
    it("omits null asset jobs when generated posts are text-only", async () => {
      const frozenPostPlans = [1, 2, 3].map((position) => ({
        content_week_plan_id: "week-plan-1",
        position,
      }));
      const itemVersions = [1, 2, 3].map((position) =>
        makeItemVersion(String(position), {
          contract_version: "content-v2",
          format: "text_post",
          asset_required: false,
          asset_ids: [],
        }),
      );
      packRepo.getPackById = jest.fn().mockResolvedValue({
        ...PACK,
        contractVersion: "content-v2",
        weekPlanId: "week-plan-1",
      });
      packRepo.claimPackForGeneration = jest
        .fn()
        .mockResolvedValue({ changed: true });
      packRepo.persistGeneratedItemsV2 = jest.fn().mockResolvedValue(PACK);
      strategyRepo.getProfileVersionById = jest
        .fn()
        .mockResolvedValue(PROFILE_VERSION);
      client.generateV2 = jest.fn().mockResolvedValue({
        contract_version: "content-v2",
        content_pack: {
          ...AI_RESPONSE_3_ITEMS.content_pack,
          contract_version: "content-v2",
        },
        item_versions: itemVersions,
        validation: { valid: true, issues: [] },
      });
      prisma.contentWeekPlan.findUnique.mockResolvedValue({
        id: "week-plan-1",
        frozenInput: {
          contract_version: "content-v2",
          editorial_profile: null,
          post_plans: frozenPostPlans,
        },
        postPlans: frozenPostPlans,
      });

      await processor.process({
        id: "job-v2-1",
        name: "generate-content-v2",
        data: {
          ...JOB_DATA,
          priorFailure: {
            error_code: "CONTENT_UNSUPPORTED_CLAIM",
            message: "Availability wording had no approved grounding source.",
          },
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as never);

      expect(client.generateV2).toHaveBeenCalledWith(
        expect.objectContaining({
          prior_failure: {
            error_code: "CONTENT_UNSUPPORTED_CLAIM",
            message: "Availability wording had no approved grounding source.",
          },
        }),
      );
      expect(packRepo.persistGeneratedItemsV2).toHaveBeenCalledWith(
        expect.objectContaining({ assetJobs: [] }),
      );
      expect(packRepo.safeFail).not.toHaveBeenCalled();
    });
  });

  // ── Already claimed (idempotent) ──────────────────────────────────

  describe("generate-content — already claimed", () => {
    it("returns early when markPackStatus reports unchanged", async () => {
      (packRepo.markPackStatus as jest.Mock).mockResolvedValue({
        changed: false,
      });

      await processor.process(makeJob());

      expect(client.generate).not.toHaveBeenCalled();
      expect(packRepo.persistGeneratedItems).not.toHaveBeenCalled();
      expect(packRepo.safeFail).not.toHaveBeenCalled();
    });
  });

  // ── Missing resources ──────────────────────────────────────────────

  describe("generate-content — missing resources", () => {
    it("safely fails when cycle is not found", async () => {
      (cycleRepo.getCycleById as jest.Mock).mockResolvedValue(null);

      await processor.process(makeJob());

      expect(packRepo.safeFail).toHaveBeenCalledWith(
        "pack-1",
        "content.generation_failed",
        expect.stringContaining("Missing required data"),
        expect.objectContaining({ error_code: "CONTENT_SCHEMA_FAILURE" }),
      );
      expect(packRepo.persistGeneratedItems).not.toHaveBeenCalled();
    });
  });

  // ── Schema failure: 6 items ────────────────────────────────────────

  describe("generate-content — schema failure", () => {
    it("marks pack failed without persisting garbage when AI returns 6 items", async () => {
      const failOnCount = jest.fn().mockReturnValue({
        valid: false,
        issues: [
          {
            code: "CONTENT_SCHEMA_FAILURE",
            field: "pack.item_ids",
            message: "Content pack must have between 3 and 5 items.",
            retryable: false,
          },
        ],
      });
      (validateContentPolicyFixture as jest.Mock).mockImplementation(
        failOnCount,
      );
      (client.generate as jest.Mock).mockResolvedValue(AI_RESPONSE_6_ITEMS);

      await processor.process(makeJob());

      expect(packRepo.safeFail).toHaveBeenCalledWith(
        "pack-1",
        "content.generation_failed",
        expect.stringContaining("3 and 5 items"),
        expect.objectContaining({
          error_code: "CONTENT_SCHEMA_FAILURE",
          retryable: false,
        }),
      );
      expect(packRepo.persistGeneratedItems).not.toHaveBeenCalled();
    });
  });

  // ── AI provider failure ────────────────────────────────────────────

  describe("generate-content — provider failure", () => {
    it("marks pack failed and rethrows for BullMQ retry", async () => {
      const providerError = new ProviderError(
        "CONTENT_PROVIDER_FAILURE",
        "AI service returned 502",
        true,
      );
      (client.generate as jest.Mock).mockRejectedValue(providerError);

      await expect(processor.process(makeJob())).rejects.toBeInstanceOf(
        ProviderError,
      );

      expect(packRepo.safeFail).toHaveBeenCalledWith(
        "pack-1",
        "content.generation_failed",
        "AI service returned 502",
        expect.objectContaining({
          error_code: "CONTENT_PROVIDER_FAILURE",
          retryable: true,
        }),
      );
      expect(packRepo.persistGeneratedItems).not.toHaveBeenCalled();
    });

    it("calls the provider again on retryable attempts and persists on the third", async () => {
      const providerError = new ProviderError(
        "CONTENT_PROVIDER_FAILURE",
        "AI service returned 502",
        true,
      );
      (client.generate as jest.Mock)
        .mockRejectedValueOnce(providerError)
        .mockRejectedValueOnce(providerError)
        .mockResolvedValueOnce(AI_RESPONSE_3_ITEMS);
      const attempt = (attemptsMade: number) =>
        ({
          id: "job-1",
          name: "generate-content",
          data: JOB_DATA,
          attemptsMade,
          opts: { attempts: 3 },
        }) as never;

      await expect(processor.process(attempt(0))).rejects.toBe(providerError);
      await expect(processor.process(attempt(1))).rejects.toBe(providerError);
      await expect(processor.process(attempt(2))).resolves.toBeUndefined();

      expect(client.generate).toHaveBeenCalledTimes(3);
      expect(packRepo.persistGeneratedItems).toHaveBeenCalledTimes(1);
      expect(packRepo.safeFail).toHaveBeenNthCalledWith(
        1,
        "pack-1",
        "content.generation_failed",
        "AI service returned 502",
        expect.objectContaining({ retryable: true }),
      );
      expect(packRepo.safeFail).toHaveBeenNthCalledWith(
        2,
        "pack-1",
        "content.generation_failed",
        "AI service returned 502",
        expect.objectContaining({ retryable: true }),
      );
    });
  });

  // ── Unknown job ────────────────────────────────────────────────────

  describe("process — unknown job", () => {
    it("returns without error for unknown job names", async () => {
      await expect(
        processor.process({
          id: "job-1",
          name: "unknown-job",
          data: {},
        } as never),
      ).resolves.toBeUndefined();
    });
  });
});

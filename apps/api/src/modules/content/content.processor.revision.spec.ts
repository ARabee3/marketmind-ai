import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { ContentProcessor } from "./content.processor";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { ContentAiClient } from "./content.client";
import { ProviderError } from "../../common/errors/provider-error";
import { randomUUID } from "crypto";
import { CONTENT_ASSET_STORAGE } from "./assets/asset-storage.port";
import { computeContentItemVersionChecksum } from "@marketmind/contracts";

jest.mock("@marketmind/contracts", () => {
  const actual = jest.requireActual("@marketmind/contracts");
  return {
    ...actual,
    validateContentPolicyFixture: jest.fn(() => ({ valid: true, issues: [] })),
  };
});

describe("ContentProcessor - Revision Flow", () => {
  let processor: ContentProcessor;
  let packRepo: jest.Mocked<ContentPackRepository>;
  let cycleRepo: jest.Mocked<ContentCycleRepository>;
  let weekContextRepo: jest.Mocked<ContentWeekContextRepository>;
  let strategyRepo: jest.Mocked<StrategyRepository>;
  let aiClient: jest.Mocked<ContentAiClient>;
  let assetStorage: { store: jest.Mock };

  const mockPack = {
    id: randomUUID(),
    contractVersion: "content-v1",
    contentCycleId: randomUUID(),
    weeklyClaimId: randomUUID(),
    weekNumber: 1,
    businessId: randomUUID(),
    strategyId: randomUUID(),
    strategyVersion: 1,
    strategyDecisionId: randomUUID(),
    profileVersionId: randomUUID(),
    weekContextId: randomUUID(),
    status: "draft",
    retryEligible: true,
    itemIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockItem = {
    id: randomUUID(),
    contentPackId: mockPack.id,
    currentVersionId: randomUUID(),
    status: "revision_requested",
    createdAt: new Date(),
  };

  const mockBaseVersion = {
    id: mockItem.currentVersionId!,
    contractVersion: "content-v1",
    contentItemId: mockItem.id,
    contentPackId: mockPack.id,
    version: 1,
    channel: "instagram",
    format: "post",
    languageMode: "ar-EG",
    strategyTrace: {},
    captionVariants: [],
    cta: null,
    hashtags: [],
    creativeBrief: "Test brief",
    altText: "Test alt",
    shortVideoScript: null,
    recommendedPublishWindow: {},
    claimSources: [],
    warnings: [],
    blockers: [],
    assetRequired: false,
    assetIds: [],
    generationProvenance: {},
    versionChecksum: "abc123",
    createdAt: new Date(),
  };

  const mockRevisedVersion = {
    ...mockBaseVersion,
    id: randomUUID(),
    version: 2,
    creativeBrief: "Revised brief",
    versionChecksum: "def456",
  };

  const mockContractItemVersion = {
    id: mockRevisedVersion.id,
    contract_version: "content-v1" as const,
    content_item_id: mockItem.id,
    content_pack_id: mockPack.id,
    version: 2,
    channel: "instagram" as const,
    format: "static_image_post" as const,
    language_mode: "ar-EG" as const,
    strategy_trace: {
      strategy_id: mockPack.strategyId,
      strategy_version: mockPack.strategyVersion,
      week_number: mockPack.weekNumber,
      pillar_ids: [],
      objective: "awareness",
      channel: "instagram" as const,
    },
    caption_variants: [],
    cta: null,
    hashtags: [],
    creative_brief: "Revised brief",
    alt_text: "Test alt",
    short_video_script: null,
    recommended_publish_window: {
      starts_at: "2026-01-01T10:00:00.000Z",
      ends_at: "2026-01-01T18:00:00.000Z",
      timezone: "Africa/Cairo" as const,
    },
    claim_sources: [],
    warnings: [],
    blockers: [],
    asset_required: false,
    asset_ids: [],
    generation_provenance: {
      generation_run_id: randomUUID(),
      provider_name: "test-provider",
      provider_model: "test-model",
      generated_at: new Date().toISOString(),
    },
    version_checksum: "def456",
    created_at: new Date().toISOString(),
  };
  mockContractItemVersion.version_checksum = computeContentItemVersionChecksum(
    mockContractItemVersion,
  );

  beforeEach(async () => {
    packRepo = {
      getPackById: jest.fn(),
      getItemById: jest.fn(),
      listItemVersions: jest.fn(),
      markItemStatus: jest.fn(),
      appendProgressEvent: jest.fn(),
      appendRevisedItemVersion: jest.fn(),
    } as any;

    cycleRepo = {
      getCycleById: jest.fn(),
    } as any;

    weekContextRepo = {
      getWeekById: jest.fn(),
    } as any;

    strategyRepo = {
      readStrategy: jest.fn(),
      getVersionByNumber: jest.fn(),
      getDecisionById: jest.fn(),
      getActiveConfirmedProfileVersion: jest.fn(),
    } as any;

    cycleRepo.getCycleById.mockResolvedValue({ status: "active" } as any);
    weekContextRepo.getWeekById.mockResolvedValue({
      id: "week-1",
      contractVersion: "content-v1",
      contentCycleId: mockPack.contentCycleId,
      weekNumber: mockPack.weekNumber,
      weekStartDate: new Date("2026-01-01"),
      promotionMode: "none",
      promotion: null,
      mustInclude: [],
      mustAvoid: [],
      approvedAssetIds: [],
      ctaDestination: { type: "none", value: null },
      generationCutoffAt: new Date("2026-01-08"),
      weeklyClaimId: "claim-1",
      contextSource: "system_defaulted",
      confirmedByUserId: null,
      confirmedAt: null,
      systemDefaultedAt: new Date("2026-01-01"),
    } as any);
    strategyRepo.readStrategy.mockResolvedValue({ status: "approved" } as any);
    strategyRepo.getVersionByNumber.mockResolvedValue({
      planData: {
        content_strategy: {
          weeks: [{ week_number: 1, formats: ["static_image_post"] }],
        },
        selected_channels: [{ channel: "facebook" }, { channel: "instagram" }],
        plan_language: "ar-EG",
      },
    } as any);
    strategyRepo.getDecisionById.mockResolvedValue({
      action: "approve",
    } as any);
    strategyRepo.getActiveConfirmedProfileVersion.mockResolvedValue({
      id: mockPack.profileVersionId,
      businessId: "biz-1",
      version: 1,
      profile: {},
      confirmedByUserId: "owner-1",
      confirmedAt: new Date(),
      createdAt: new Date(),
    } as any);

    aiClient = {
      revise: jest.fn(),
    } as any;

    assetStorage = {
      store: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentProcessor,
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekContextRepo },
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentAiClient, useValue: aiClient },
        { provide: CONTENT_ASSET_STORAGE, useValue: assetStorage },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    processor = module.get<ContentProcessor>(ContentProcessor);
  });

  describe("handleRevise", () => {
    const correlationId = randomUUID();
    const revisionNotes = "Please make it more engaging";
    const idempotencyKey = randomUUID();

    const createJob = (data: any) => ({
      name: "revise-content",
      data: {
        contentPackId: mockPack.id,
        contentItemId: mockItem.id,
        baseItemVersionId: mockBaseVersion.id,
        revisionNotes,
        idempotencyKey,
        correlationId,
        ...data,
      },
    });

    beforeEach(() => {
      packRepo.getPackById.mockResolvedValue(mockPack);
      packRepo.getItemById.mockResolvedValue(mockItem);
      packRepo.listItemVersions.mockResolvedValue([mockBaseVersion]);
      packRepo.markItemStatus.mockResolvedValue(undefined);
      packRepo.appendProgressEvent.mockResolvedValue(undefined);
      packRepo.appendRevisedItemVersion.mockResolvedValue(mockRevisedVersion);
    });

    it("should successfully revise an item and create a new version", async () => {
      aiClient.revise.mockResolvedValue({
        contract_version: "content-v1",
        item_version: mockContractItemVersion,
        validation: {
          valid: true,
          issues: [],
        },
      });

      await processor.process(createJob({}) as any);

      expect(aiClient.revise).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            contract_version: "content-v1",
            content_pack_id: mockPack.id,
            content_item_id: mockItem.id,
            base_item_version_id: mockBaseVersion.id,
            revision_notes: revisionNotes,
            idempotency_key: idempotencyKey,
          }),
        }),
      );

      expect(packRepo.appendRevisedItemVersion).toHaveBeenCalledWith({
        id: expect.any(String),
        packId: mockPack.id,
        itemId: mockItem.id,
        baseVersionId: mockBaseVersion.id,
        newVersionNumber: 2,
        channel: mockContractItemVersion.channel,
        format: mockContractItemVersion.format,
        languageMode: mockContractItemVersion.language_mode,
        strategyTrace: mockContractItemVersion.strategy_trace,
        captionVariants: mockContractItemVersion.caption_variants,
        cta: mockContractItemVersion.cta,
        hashtags: mockContractItemVersion.hashtags,
        creativeBrief: mockContractItemVersion.creative_brief,
        altText: mockContractItemVersion.alt_text,
        shortVideoScript: mockContractItemVersion.short_video_script,
        recommendedPublishWindow:
          mockContractItemVersion.recommended_publish_window,
        claimSources: mockContractItemVersion.claim_sources,
        warnings: mockContractItemVersion.warnings,
        blockers: mockContractItemVersion.blockers,
        assetRequired: mockContractItemVersion.asset_required,
        assetIds: mockContractItemVersion.asset_ids,
        generationProvenance: mockContractItemVersion.generation_provenance,
        versionChecksum: mockContractItemVersion.version_checksum,
        createdAt: new Date(mockContractItemVersion.created_at),
      });

      expect(packRepo.appendProgressEvent).toHaveBeenCalledWith(
        mockPack.id,
        expect.objectContaining({
          stage: "revision",
          status: "complete",
          messageKey: "content.revision.complete",
          payload: expect.objectContaining({
            item_id: mockItem.id,
            new_version_id: mockRevisedVersion.id,
            new_version_number: 2,
            prior_version_id: mockBaseVersion.id,
          }),
        }),
      );
    });

    it("should preserve prior version when AI client fails with retryable error", async () => {
      const providerError = new ProviderError(
        "CONTENT_PROVIDER_FAILURE",
        "AI service unavailable",
        true,
      );
      aiClient.revise.mockRejectedValue(providerError);

      await expect(processor.process(createJob({}) as any)).rejects.toThrow(
        providerError,
      );

      expect(packRepo.markItemStatus).toHaveBeenCalledWith(
        mockItem.id,
        "revision_requested",
      );

      expect(packRepo.appendProgressEvent).toHaveBeenCalledWith(
        mockPack.id,
        expect.objectContaining({
          stage: "revision",
          status: "failed",
          messageKey: "content.revision.failed",
          payload: expect.objectContaining({
            error_code: "CONTENT_PROVIDER_FAILURE",
            retryable: true,
            item_id: mockItem.id,
            prior_version_id: mockBaseVersion.id,
          }),
        }),
      );

      expect(packRepo.appendRevisedItemVersion).not.toHaveBeenCalled();

      // AC-5: the item's currentVersionId must still point to the pre-revision
      // version row while the retryable job remains claimable.
      const fetchedItem = await packRepo.getItemById(mockPack.id, mockItem.id);
      expect(fetchedItem?.currentVersionId).toBe(mockBaseVersion.id);
    });

    it("should preserve prior version when AI client fails with non-retryable error", async () => {
      const providerError = new ProviderError(
        "CONTENT_SCHEMA_FAILURE",
        "Invalid revision request",
        false,
      );
      aiClient.revise.mockRejectedValue(providerError);

      await processor.process(createJob({}) as any);

      expect(packRepo.markItemStatus).toHaveBeenCalledWith(
        mockItem.id,
        "revision_failed",
      );

      expect(packRepo.appendProgressEvent).toHaveBeenCalledWith(
        mockPack.id,
        expect.objectContaining({
          stage: "revision",
          status: "failed",
          messageKey: "content.revision.failed",
          payload: expect.objectContaining({
            error_code: "CONTENT_SCHEMA_FAILURE",
            retryable: false,
            item_id: mockItem.id,
            prior_version_id: mockBaseVersion.id,
          }),
        }),
      );

      expect(packRepo.appendRevisedItemVersion).not.toHaveBeenCalled();
    });

    it("should handle missing pack gracefully", async () => {
      packRepo.getPackById.mockResolvedValue(null);

      await processor.process(createJob({}) as any);

      expect(aiClient.revise).not.toHaveBeenCalled();
      expect(packRepo.appendRevisedItemVersion).not.toHaveBeenCalled();
    });

    it("should handle missing item gracefully", async () => {
      packRepo.getItemById.mockResolvedValue(null);

      await processor.process(createJob({}) as any);

      expect(aiClient.revise).not.toHaveBeenCalled();
      expect(packRepo.appendRevisedItemVersion).not.toHaveBeenCalled();
    });

    it("should calculate correct version number for subsequent revisions", async () => {
      const currentVersion = { ...mockBaseVersion, version: 2 };

      const mockVersion3Prisma = {
        ...mockBaseVersion,
        id: randomUUID(),
        version: 3,
      };

      const mockVersion3Contract = {
        ...mockContractItemVersion,
        id: mockVersion3Prisma.id,
        version: 3,
      };
      mockVersion3Contract.version_checksum =
        computeContentItemVersionChecksum(mockVersion3Contract);

      packRepo.listItemVersions.mockResolvedValue([
        mockVersion3Prisma,
        currentVersion,
      ]);
      aiClient.revise.mockResolvedValue({
        contract_version: "content-v1",
        item_version: mockVersion3Contract,
        validation: {
          valid: true,
          issues: [],
        },
      });

      await processor.process(
        createJob({ baseItemVersionId: currentVersion.id }) as any,
      );

      expect(packRepo.appendRevisedItemVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          newVersionNumber: 3,
        }),
      );
    });
  });
});

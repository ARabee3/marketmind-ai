import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger, Inject } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ProviderError } from "../../common/errors/provider-error";
import {
  ContentItemVersion,
  ContentPolicyFixture,
  validateContentPolicyFixture,
} from "@marketmind/contracts";
import type {
  StrategyPlan,
  BusinessProfileData,
} from "@marketmind/contracts";
import { ContentPackRepository, ContentItemVersionDraftInput } from "./repositories/content-pack.repository";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { ContentAiClient } from "./content.client";
import { AssetStorage, buildAssetStorageKey, CONTENT_ASSET_STORAGE } from "./assets/asset-storage.port";
import {
  toContentWeekContext,
  toContentPack,
  toContentItemVersion,
  normalizeStrategyDecision,
} from "./content.service";
import {
  adaptStrategyWeekFormats,
  adaptLanguageMode,
  adaptSelectedChannelsOrThrow,
} from "./content-strategy.adapter";

interface ContentGenerateJobData {
  contentCycleId: string;
  weekNumber: number;
  contentPackId: string;
  idempotencyKey: string;
  correlationId: string;
}

interface ContentReviseJobData {
  contentCycleId: string;
  contentPackId: string;
  contentItemId: string;
  baseItemVersionId: string;
  revisionNotes: string;
  idempotencyKey: string;
  correlationId: string;
}

interface ContentGenerateStaticAssetJobData {
  contentItemVersionId: string;
  creativeBrief: string;
  altText: string;
  width: number;
  height: number;
  idempotencyKey: string;
  correlationId: string;
}

@Processor("content-generation")
@Injectable()
export class ContentProcessor extends WorkerHost {
  private readonly logger = new Logger(ContentProcessor.name);

  constructor(
    private readonly packRepo: ContentPackRepository,
    private readonly cycleRepo: ContentCycleRepository,
    private readonly weekContextRepo: ContentWeekContextRepository,
    private readonly strategyRepo: StrategyRepository,
    private readonly contentAiClient: ContentAiClient,
    @Inject(CONTENT_ASSET_STORAGE) private readonly assetStorage: AssetStorage,
  ) {
    super();
  }

  async process(job: Job<unknown, unknown, string>): Promise<unknown> {
    switch (job.name) {
      case "generate-content":
        return this.handleGenerate(job as unknown as Job<ContentGenerateJobData>);
      case "revise-content":
        return this.handleRevise(job as unknown as Job<ContentReviseJobData>);
      case "generate-static-asset":
        return this.handleGenerateStaticAsset(
          job as unknown as Job<ContentGenerateStaticAssetJobData>,
        );
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
        return;
    }
  }

  private async handleGenerate(job: Job<ContentGenerateJobData>): Promise<void> {
    const { contentCycleId, weekNumber, contentPackId, correlationId } =
      job.data;
    const startedAt = new Date();

    const pack = await this.packRepo.getPackById(contentPackId);
    if (!pack) {
      this.logger.error(`Pack ${contentPackId} not found`);
      return;
    }

    const claimed = await this.packRepo.markPackStatus(
      pack.id,
      "queued",
      "generating",
    );
    if (!claimed.changed) {
      this.logger.warn(`Pack ${pack.id} already claimed by another worker`);
      return;
    }

    await this.packRepo.appendProgressEvent(pack.id, {
      stage: "generating",
      status: "started",
      messageKey: "content.generating",
      messageText: "Generating content items…",
      payload: { correlation_id: correlationId },
    });

    try {
      const cycle = await this.cycleRepo.getCycleById(contentCycleId);
      const weekContext = await this.weekContextRepo.getWeekById(
        pack.weekContextId,
      );
      const strategy = await this.strategyRepo.readStrategy(pack.strategyId);
      const strategyVersion = await this.strategyRepo.getVersionByNumber(
        pack.strategyId,
        pack.strategyVersion,
      );
      const strategyDecision = await this.strategyRepo.getDecisionById(
        pack.strategyDecisionId,
      );
      const profileVersion =
        await this.strategyRepo.getActiveConfirmedProfileVersion(
          pack.businessId,
        );

      if (
        !cycle ||
        !weekContext ||
        !strategy ||
        !strategyVersion ||
        !profileVersion
      ) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          `Missing required data for pack ${pack.id}`,
          false,
        );
      }

      const selectedChannels = adaptSelectedChannelsOrThrow(
        strategyVersion.planData,
      );

      const request = {
        contract_version: "content-v1" as const,
        content_pack_id: pack.id,
        business_id: pack.businessId,
        strategy_id: pack.strategyId,
        strategy_version: pack.strategyVersion,
        strategy_decision_id: pack.strategyDecisionId,
        strategy_plan: strategyVersion.planData as unknown as StrategyPlan,
        business_profile: {
          id: profileVersion.id,
          business_id: profileVersion.businessId,
          draft_id: profileVersion.id,
          version: profileVersion.version,
          profile: profileVersion.profile as unknown as BusinessProfileData,
          confirmed_by_user_id: profileVersion.confirmedByUserId ?? undefined,
          confirmed_at: profileVersion.confirmedAt?.toISOString() ?? undefined,
          created_at: profileVersion.createdAt.toISOString(),
        },
        week_context: toContentWeekContext(weekContext),
        selected_channels: selectedChannels,
        allowed_formats: adaptStrategyWeekFormats(
          strategyVersion.planData,
          pack.weekNumber,
        ),
        language_mode: adaptLanguageMode(strategyVersion.planData),
      };

      const response = await this.contentAiClient.generate(request);

      await this.packRepo.markPackStatus(pack.id, "generating", "validating");

      const fixturePack = {
        ...toContentPack(pack),
        item_ids: response.content_pack.item_ids,
      };

      for (const itemVersion of response.item_versions) {
        const fixture: ContentPolicyFixture = {
          strategy_id: pack.strategyId,
          strategy_version: pack.strategyVersion,
          strategy_status: strategy.status as ContentPolicyFixture["strategy_status"],
          strategy_decision: {
            id: pack.strategyDecisionId,
            strategy_id: pack.strategyId,
            strategy_version: pack.strategyVersion,
            decision: normalizeStrategyDecision(
              strategyDecision?.action,
            ),
          },
          cycle_status: cycle.status as ContentPolicyFixture["cycle_status"],
          profile_version_id: pack.profileVersionId,
          current_profile_version_id: profileVersion.id,
          selected_channels: selectedChannels,
          existing_weekly_claims: [],
          week_context: toContentWeekContext(weekContext),
          pack: fixturePack,
          item_version: itemVersion,
          assets: [],
        };

        const result = validateContentPolicyFixture(fixture);
        const blocking = result.issues.filter(
          (issue) => issue.code !== "CONTENT_ASSET_REQUIRED",
        );
        if (blocking.length > 0) {
          throw new ProviderError(
            blocking[0].code,
            blocking[0].message,
            false,
          );
        }
      }

      const generationRunId = randomUUID();
      const finishedAt = new Date();

      await this.packRepo.persistGeneratedItems({
        packId: pack.id,
        cycleId: contentCycleId,
        weekNumber,
        generationRunId,
        items: response.item_versions.map(toDraftInput),
        progressEvent: {
          stage: "ready",
          status: "complete",
          messageKey: "content.ready",
          messageText: "Content pack draft ready for review.",
        },
        providerName:
          response.item_versions[0]?.generation_provenance?.provider_name,
        providerModel:
          response.item_versions[0]?.generation_provenance?.provider_model,
        latencyMs: finishedAt.getTime() - startedAt.getTime(),
        startedAt,
        finishedAt,
      });

      this.logger.log(
        `Pack ${pack.id} generated successfully (${response.item_versions.length} items)`,
      );
    } catch (error) {
      const retryable =
        error instanceof ProviderError ? error.retryable : true;

      await this.packRepo.safeFail(
        pack.id,
        "content.generation_failed",
        error instanceof Error ? error.message : "Unknown error",
        {
          error_code:
            error instanceof ProviderError
              ? error.code
              : "CONTENT_GENERATION_FAILED",
          retryable,
          correlation_id: correlationId,
        },
      );

      if (retryable) {
        throw error;
      }
    }
  }

  private async handleRevise(job: Job<ContentReviseJobData>): Promise<void> {
    const {
      contentPackId,
      contentItemId,
      baseItemVersionId,
      revisionNotes,
      idempotencyKey,
      correlationId,
    } = job.data;

    const pack = await this.packRepo.getPackById(contentPackId);
    if (!pack) {
      this.logger.error(`Pack ${contentPackId} not found for revision`);
      return;
    }

    const item = await this.packRepo.getItemById(contentPackId, contentItemId);
    if (!item) {
      this.logger.error(`Item ${contentItemId} not found in pack ${contentPackId}`);
      return;
    }

    if (item.currentVersionId !== baseItemVersionId) {
      this.logger.warn(
        `Item ${contentItemId} current version ${item.currentVersionId} does not match base ${baseItemVersionId}`,
      );
      return;
    }

    // `recordDecision` already set item.status to "revision_requested". Gate the
    // processor on that persisted status so duplicate/orphaned jobs (failed
    // enqueue, client retry, Redis blip) are no-ops, not double-writes.
    if (item.status !== "revision_requested") {
      this.logger.warn(
        `Item ${contentItemId} status is "${item.status}", not "revision_requested"; revision job ${job.id} is a no-op`,
      );
      return;
    }

    await this.packRepo.appendProgressEvent(pack.id, {
      stage: "revision",
      status: "started",
      messageKey: "content.revision.started",
      messageText: "Revising content item…",
      payload: {
        correlation_id: correlationId,
        item_id: contentItemId,
        base_version_id: baseItemVersionId,
      },
    });

    try {
      const versions = await this.packRepo.listItemVersions(
        contentPackId,
        contentItemId,
      );
      const baseVersion = versions.find((v) => v.id === baseItemVersionId);
      if (!baseVersion) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          `Base version ${baseItemVersionId} not found`,
          false,
        );
      }

      const [cycle, weekContext, strategy, strategyVersion, strategyDecision, profileVersion] =
        await Promise.all([
          this.cycleRepo.getCycleById(pack.contentCycleId),
          this.weekContextRepo.getWeekById(pack.weekContextId),
          this.strategyRepo.readStrategy(pack.strategyId),
          this.strategyRepo.getVersionByNumber(pack.strategyId, pack.strategyVersion),
          this.strategyRepo.getDecisionById(pack.strategyDecisionId),
          this.strategyRepo.getActiveConfirmedProfileVersion(pack.businessId),
        ]);

      if (!cycle || !weekContext || !strategy || !strategyVersion || !profileVersion) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          `Missing required data for revision of pack ${pack.id}`,
          false,
        );
      }

      const selectedChannels = adaptSelectedChannelsOrThrow(strategyVersion.planData);

      const generationRequest = {
        contract_version: "content-v1" as const,
        content_pack_id: contentPackId,
        business_id: pack.businessId,
        strategy_id: pack.strategyId,
        strategy_version: pack.strategyVersion,
        strategy_decision_id: pack.strategyDecisionId,
        strategy_plan: strategyVersion.planData as unknown as StrategyPlan,
        business_profile: {
          id: profileVersion.id,
          business_id: profileVersion.businessId,
          draft_id: profileVersion.id,
          version: profileVersion.version,
          profile: profileVersion.profile as unknown as BusinessProfileData,
          confirmed_by_user_id: profileVersion.confirmedByUserId ?? undefined,
          confirmed_at: profileVersion.confirmedAt?.toISOString() ?? undefined,
          created_at: profileVersion.createdAt.toISOString(),
        },
        week_context: toContentWeekContext(weekContext),
        selected_channels: selectedChannels,
        allowed_formats: adaptStrategyWeekFormats(
          strategyVersion.planData,
          pack.weekNumber,
        ),
        language_mode: adaptLanguageMode(strategyVersion.planData),
      };

      const reviseRequest = {
        contract_version: "content-v1" as const,
        content_pack_id: contentPackId,
        content_item_id: contentItemId,
        base_item_version_id: baseItemVersionId,
        revision_notes: revisionNotes,
        idempotency_key: idempotencyKey,
      };

      const response = await this.contentAiClient.revise({
        request: reviseRequest,
        previous_item_version: toContentItemVersion(baseVersion),
        generation_request: generationRequest,
      });

      const newVersion = response.item_version;
      const newVersionNumber = baseVersion.version + 1;

      // AC-4: validate revised output. Use the persisted pack identity (item_ids)
      // and skip CONTENT_ASSET_REQUIRED at the draft gate — assets are generated
      // by the static-asset worker and enforced at approval time.
      {
        const fixture: ContentPolicyFixture = {
          strategy_id: pack.strategyId,
          strategy_version: pack.strategyVersion,
          strategy_status: strategy.status as ContentPolicyFixture["strategy_status"],
          strategy_decision: {
            id: pack.strategyDecisionId,
            strategy_id: pack.strategyId,
            strategy_version: pack.strategyVersion,
            decision: normalizeStrategyDecision(strategyDecision?.action),
          },
          cycle_status: cycle.status as ContentPolicyFixture["cycle_status"],
          profile_version_id: pack.profileVersionId,
          current_profile_version_id: profileVersion.id,
          selected_channels: selectedChannels,
          existing_weekly_claims: [],
          week_context: toContentWeekContext(weekContext),
          pack: toContentPack(pack),
          item_version: newVersion,
          assets: [],
        };

        const result = validateContentPolicyFixture(fixture);
        const blocking = result.issues.filter(
          (issue) => issue.code !== "CONTENT_ASSET_REQUIRED",
        );
        if (blocking.length > 0) {
          throw new ProviderError(
            blocking[0].code,
            `Revision policy validation failed: ${blocking[0].message}`,
            false,
          );
        }
      }

      const persisted = await this.packRepo.appendRevisedItemVersion({
        id: newVersion.id,
        packId: contentPackId,
        itemId: contentItemId,
        baseVersionId: baseItemVersionId,
        newVersionNumber,
        channel: newVersion.channel,
        format: newVersion.format,
        languageMode: newVersion.language_mode,
        strategyTrace: newVersion.strategy_trace as Prisma.InputJsonValue,
        captionVariants: newVersion.caption_variants as Prisma.InputJsonValue,
        cta: newVersion.cta,
        hashtags: newVersion.hashtags as Prisma.InputJsonValue,
        creativeBrief: newVersion.creative_brief,
        altText: newVersion.alt_text,
        shortVideoScript:
          newVersion.short_video_script === null
            ? null
            : (newVersion.short_video_script as Prisma.InputJsonValue),
        recommendedPublishWindow:
          newVersion.recommended_publish_window as Prisma.InputJsonValue,
        claimSources: newVersion.claim_sources as Prisma.InputJsonValue,
        warnings: newVersion.warnings as Prisma.InputJsonValue,
        blockers: newVersion.blockers as Prisma.InputJsonValue,
        assetRequired: newVersion.asset_required,
        assetIds: newVersion.asset_ids as Prisma.InputJsonValue,
        generationProvenance:
          newVersion.generation_provenance as Prisma.InputJsonValue,
        versionChecksum: newVersion.version_checksum,
      });

      await this.packRepo.appendProgressEvent(pack.id, {
        stage: "revision",
        status: "complete",
        messageKey: "content.revision.complete",
        messageText: `Revised item ${contentItemId} to version ${newVersionNumber}.`,
        payload: {
          correlation_id: correlationId,
          item_id: contentItemId,
          new_version_id: persisted.id,
          new_version_number: newVersionNumber,
          prior_version_id: baseItemVersionId,
        },
      });

      this.logger.log(
        `Item ${contentItemId} revised to version ${newVersionNumber} (prior: ${baseItemVersionId})`,
      );
    } catch (error) {
      const retryable =
        error instanceof ProviderError ? error.retryable : true;

      await this.packRepo.markItemStatus(contentItemId, "revision_failed");
      await this.packRepo.appendProgressEvent(pack.id, {
        stage: "revision",
        status: "failed",
        messageKey: "content.revision.failed",
        messageText: error instanceof Error ? error.message : "Unknown error",
        payload: {
          error_code:
            error instanceof ProviderError
              ? error.code
              : "CONTENT_REVISION_FAILED",
          retryable,
          correlation_id: correlationId,
          item_id: contentItemId,
          prior_version_id: baseItemVersionId,
        },
      });

      if (retryable) {
        throw error;
      }
    }
  }

  private async handleGenerateStaticAsset(
    job: Job<ContentGenerateStaticAssetJobData>,
  ): Promise<void> {
    const {
      contentItemVersionId,
      creativeBrief,
      altText,
      width,
      height,
      idempotencyKey,
      correlationId,
    } = job.data;

    this.logger.log(
      `[Corr: ${correlationId}] Generating static asset for version ${contentItemVersionId}`,
    );

    try {
      const request = {
        contract_version: "content-v1" as const,
        content_item_version_id: contentItemVersionId,
        creative_brief: creativeBrief,
        alt_text: altText,
        width,
        height,
        idempotency_key: idempotencyKey,
      };

      const response = await this.contentAiClient.generateStaticAsset(request);
      const asset = response.asset;

      if (asset.status === "ready" && asset.storage_key && asset.checksum) {
        await this.packRepo.createAsset({
          contentItemVersionId,
          kind: asset.kind,
          status: "ready",
          mimeType: asset.mime_type,
          width: asset.width,
          height: asset.height,
          storageKey: asset.storage_key,
          checksum: asset.checksum,
          altText: asset.alt_text,
          providerName: asset.provider_name,
          providerModel: asset.provider_model,
          providerRequestId: asset.provider_request_id,
          failureCode: null,
        });

        this.logger.log(
          `[Corr: ${correlationId}] Static asset ${asset.id} stored with checksum ${asset.checksum}`,
        );
      } else {
        await this.packRepo.createAsset({
          contentItemVersionId,
          kind: asset.kind,
          status: asset.status,
          mimeType: asset.mime_type,
          width: asset.width,
          height: asset.height,
          storageKey: null,
          checksum: null,
          altText: asset.alt_text,
          providerName: asset.provider_name,
          providerModel: asset.provider_model,
          providerRequestId: asset.provider_request_id,
          failureCode: asset.failure_code,
        });

        this.logger.warn(
          `[Corr: ${correlationId}] Static asset ${asset.id} generated with status ${asset.status}`,
        );
      }
    } catch (error) {
      const retryable =
        error instanceof ProviderError ? error.retryable : true;

      const failureCode =
        error instanceof ProviderError
          ? error.code
          : "CONTENT_ASSET_GENERATION_FAILED";

      await this.packRepo.createAsset({
        contentItemVersionId,
        kind: "generated_static",
        status: "failed",
        mimeType: null,
        width: null,
        height: null,
        storageKey: null,
        checksum: null,
        altText: altText,
        providerName: null,
        providerModel: null,
        providerRequestId: null,
        failureCode,
      });

      this.logger.error(
        `[Corr: ${correlationId}] Static asset generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      if (retryable) {
        throw error;
      }
    }
  }
}

function toDraftInput(iv: ContentItemVersion): ContentItemVersionDraftInput {
  return {
    id: iv.id,
    contentItemId: iv.content_item_id,
    channel: iv.channel,
    format: iv.format,
    languageMode: iv.language_mode,
    strategyTrace: iv.strategy_trace as Prisma.InputJsonValue,
    captionVariants: iv.caption_variants as Prisma.InputJsonValue,
    cta: iv.cta,
    hashtags: iv.hashtags as Prisma.InputJsonValue,
    creativeBrief: iv.creative_brief,
    altText: iv.alt_text,
    shortVideoScript:
      iv.short_video_script === null
        ? null
        : (iv.short_video_script as Prisma.InputJsonValue),
    recommendedPublishWindow:
      iv.recommended_publish_window as Prisma.InputJsonValue,
    claimSources: iv.claim_sources as Prisma.InputJsonValue,
    warnings: iv.warnings as Prisma.InputJsonValue,
    blockers: iv.blockers as Prisma.InputJsonValue,
    assetRequired: iv.asset_required,
    assetIds: iv.asset_ids as Prisma.InputJsonValue,
    generationProvenance: iv.generation_provenance as Prisma.InputJsonValue,
    versionChecksum: iv.version_checksum,
  };
}

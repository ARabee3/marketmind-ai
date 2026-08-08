import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Queue } from "bullmq";
import { Injectable, Logger, Inject, Optional } from "@nestjs/common";
import { Prisma, type ContentAsset as PrismaContentAsset } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { ProviderError } from "../../common/errors/provider-error";
import {
  ContentAsset,
  ContentItemVersion,
  ContentPolicyFixture,
  deterministicGeneratedAssetId,
  validateContentPolicyFixture,
} from "@marketmind/contracts";
import type { StrategyPlan, BusinessProfileData } from "@marketmind/contracts";
import {
  ContentPackRepository,
  ContentItemVersionDraftInput,
  type ContentAssetJobIntent,
} from "./repositories/content-pack.repository";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { ContentAiClient } from "./content.client";
import {
  AssetStorage,
  CONTENT_ASSET_STORAGE,
} from "./assets/asset-storage.port";
import {
  toContentWeekContext,
  toContentPack,
  toContentItemVersion,
  toContentAsset,
  normalizeStrategyDecision,
} from "./content.service";
import {
  adaptStrategyWeekFormats,
  adaptLanguageMode,
  adaptSelectedChannelsOrThrow,
} from "./content-strategy.adapter";
import {
  assertGeneratedContentPackIdentity,
  normalizeAiContentItemVersion,
  normalizeGeneratedContentItemVersions,
} from "./content-item-version-normalizer";
import { ContentJobOutboxRepository } from "./content-job-outbox.repository";
import { toBullMqJobId } from "../../common/queues/bullmq-job-id";
import { BillingEntitlementsService } from "../billing/billing-entitlements.service";
import { BillingDomainException } from "../billing/billing.service";

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
  assetId: string;
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
    @InjectQueue("content-generation") private readonly contentQueue: Queue,
    @Optional() private readonly jobOutbox?: ContentJobOutboxRepository,
    @Optional() private readonly billingEntitlements?: BillingEntitlementsService,
  ) {
    super();
  }

  async process(job: Job<unknown, unknown, string>): Promise<unknown> {
    switch (job.name) {
      case "generate-content":
        return this.handleGenerate(
          job as unknown as Job<ContentGenerateJobData>,
        );
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

  private async handleGenerate(
    job: Job<ContentGenerateJobData>,
  ): Promise<void> {
    const { contentCycleId, weekNumber, contentPackId, correlationId } =
      job.data;
    const startedAt = new Date();

    const pack = await this.packRepo.getPackById(contentPackId);
    if (!pack) {
      this.logger.error(`Pack ${contentPackId} not found`);
      return;
    }

    const claimed = this.packRepo.claimPackForGeneration
      ? await this.packRepo.claimPackForGeneration(pack.id)
      : await this.packRepo.markPackStatus(pack.id, "queued", "generating");
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

      await this.billingEntitlements?.assertAllowed(
        cycle.ownerUserId,
        "content_item",
        3,
      );

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

      assertGeneratedContentPackIdentity(response.content_pack, {
        contentPackId: pack.id,
        contentCycleId: contentCycleId,
        weekNumber,
        strategyId: pack.strategyId,
        strategyVersion: pack.strategyVersion,
        strategyDecisionId: pack.strategyDecisionId,
        profileVersionId: pack.profileVersionId,
      });
      const normalizedItemVersions = normalizeGeneratedContentItemVersions(
        response.item_versions,
        {
          contentPackId: pack.id,
          strategyId: pack.strategyId,
          strategyVersion: pack.strategyVersion,
          weekNumber,
          itemIds: response.content_pack.item_ids,
        },
      );

      const fixturePack = {
        ...toContentPack(pack),
        item_ids: normalizedItemVersions.map((item) => item.content_item_id),
      };

      for (const itemVersion of normalizedItemVersions) {
        const fixtureAssets = await this.buildPolicyAssets(
          itemVersion,
          pack,
          cycle.ownerUserId,
          toContentWeekContext(weekContext).approved_asset_ids,
        );
        const fixture: ContentPolicyFixture = {
          strategy_id: pack.strategyId,
          strategy_version: pack.strategyVersion,
          strategy_status:
            strategy.status as ContentPolicyFixture["strategy_status"],
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
          pack: fixturePack,
          item_version: itemVersion,
          assets: fixtureAssets,
        };

        const result = validateContentPolicyFixture(fixture);
        const blocking = result.issues.filter(
          (issue) => issue.code !== "CONTENT_ASSET_REQUIRED",
        );
        if (blocking.length > 0) {
          throw new ProviderError(blocking[0].code, blocking[0].message, false);
        }
      }

      const generationRunId = randomUUID();
      const finishedAt = new Date();

      await this.packRepo.persistGeneratedItems({
        packId: pack.id,
        cycleId: contentCycleId,
        weekNumber,
        generationRunId,
        items: normalizedItemVersions.map(toDraftInput),
        progressEvent: {
          stage: "ready",
          status: "complete",
          messageKey: "content.ready",
          messageText: "Content pack draft ready for review.",
        },
        providerName:
          normalizedItemVersions[0]?.generation_provenance?.provider_name,
        providerModel:
          normalizedItemVersions[0]?.generation_provenance?.provider_model,
        latencyMs: finishedAt.getTime() - startedAt.getTime(),
        startedAt,
        finishedAt,
        assetJobs: assetJobsForVersions(normalizedItemVersions),
      });
      try {
        await this.queuePlannedAssetJobs(normalizedItemVersions, correlationId);
      } catch (error) {
        // PostgreSQL already contains the planned asset rows. The durable job
        // outbox/reconciler repairs delivery; a transient queue failure must
        // not roll a successfully persisted content draft back to failed.
        this.logger.error(
          `Asset work for pack ${pack.id} could not be enqueued: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }

      await this.billingEntitlements?.record(
        cycle.ownerUserId,
        "content_item",
        normalizedItemVersions.length,
        `content-pack:${pack.id}`,
        pack.businessId,
      );

      this.logger.log(
        `Pack ${pack.id} generated successfully (${response.item_versions.length} items)`,
      );
    } catch (error) {
      const retryable =
        error instanceof BillingDomainException
          ? false
          : error instanceof ProviderError
            ? error.retryable
            : true;
      const attemptsMade = job.attemptsMade ?? 0;
      const maxAttempts = Number(job.opts?.attempts ?? 3);
      const retryEligible = retryable && attemptsMade + 1 < maxAttempts;

      await this.packRepo.safeFail(
        pack.id,
        "content.generation_failed",
        error instanceof Error ? error.message : "Unknown error",
        {
          error_code:
            error instanceof BillingDomainException
              ? error.code
              : error instanceof ProviderError
              ? error.code
              : "CONTENT_GENERATION_FAILED",
          retryable: retryEligible,
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
      this.logger.error(
        `Item ${contentItemId} not found in pack ${contentPackId}`,
      );
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

      const [
        cycle,
        weekContext,
        strategy,
        strategyVersion,
        strategyDecision,
        profileVersion,
      ] = await Promise.all([
        this.cycleRepo.getCycleById(pack.contentCycleId),
        this.weekContextRepo.getWeekById(pack.weekContextId),
        this.strategyRepo.readStrategy(pack.strategyId),
        this.strategyRepo.getVersionByNumber(
          pack.strategyId,
          pack.strategyVersion,
        ),
        this.strategyRepo.getDecisionById(pack.strategyDecisionId),
        this.strategyRepo.getActiveConfirmedProfileVersion(pack.businessId),
      ]);

      if (
        !cycle ||
        !weekContext ||
        !strategy ||
        !strategyVersion ||
        !profileVersion
      ) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          `Missing required data for revision of pack ${pack.id}`,
          false,
        );
      }

      await this.billingEntitlements?.assertAllowed(
        cycle.ownerUserId,
        "content_revision",
        1,
      );

      const selectedChannels = adaptSelectedChannelsOrThrow(
        strategyVersion.planData,
      );

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
      const normalizedNewVersion = normalizeAiContentItemVersion(newVersion, {
        contentPackId: contentPackId,
        contentItemId,
        version: newVersionNumber,
        strategyId: pack.strategyId,
        strategyVersion: pack.strategyVersion,
        weekNumber: pack.weekNumber,
      });

      // AC-4: validate revised output. Use the persisted pack identity (item_ids)
      // and skip CONTENT_ASSET_REQUIRED at the draft gate — assets are generated
      // by the static-asset worker and enforced at approval time.
      {
        const fixtureAssets = await this.buildPolicyAssets(
          normalizedNewVersion,
          pack,
          cycle.ownerUserId,
          toContentWeekContext(weekContext).approved_asset_ids,
        );
        const fixture: ContentPolicyFixture = {
          strategy_id: pack.strategyId,
          strategy_version: pack.strategyVersion,
          strategy_status:
            strategy.status as ContentPolicyFixture["strategy_status"],
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
          item_version: normalizedNewVersion,
          assets: fixtureAssets,
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
        id: normalizedNewVersion.id,
        packId: contentPackId,
        itemId: contentItemId,
        baseVersionId: baseItemVersionId,
        newVersionNumber,
        channel: normalizedNewVersion.channel,
        format: normalizedNewVersion.format,
        languageMode: normalizedNewVersion.language_mode,
        strategyTrace:
          normalizedNewVersion.strategy_trace as Prisma.InputJsonValue,
        captionVariants:
          normalizedNewVersion.caption_variants as Prisma.InputJsonValue,
        cta: normalizedNewVersion.cta,
        hashtags: normalizedNewVersion.hashtags as Prisma.InputJsonValue,
        creativeBrief: normalizedNewVersion.creative_brief,
        altText: normalizedNewVersion.alt_text,
        shortVideoScript:
          normalizedNewVersion.short_video_script === null
            ? null
            : (normalizedNewVersion.short_video_script as Prisma.InputJsonValue),
        recommendedPublishWindow:
          normalizedNewVersion.recommended_publish_window as Prisma.InputJsonValue,
        claimSources:
          normalizedNewVersion.claim_sources as Prisma.InputJsonValue,
        warnings: normalizedNewVersion.warnings as Prisma.InputJsonValue,
        blockers: normalizedNewVersion.blockers as Prisma.InputJsonValue,
        assetRequired: normalizedNewVersion.asset_required,
        assetIds: normalizedNewVersion.asset_ids as Prisma.InputJsonValue,
        generationProvenance:
          normalizedNewVersion.generation_provenance as Prisma.InputJsonValue,
        versionChecksum: normalizedNewVersion.version_checksum,
        createdAt: new Date(normalizedNewVersion.created_at),
        assetJob: assetJobForVersion(normalizedNewVersion) ?? undefined,
      });
      try {
        await this.queuePlannedAssetJobs([normalizedNewVersion], correlationId);
      } catch (error) {
        this.logger.error(
          `Asset work for revised item ${contentItemId} could not be enqueued: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }

      await this.billingEntitlements?.record(
        cycle.ownerUserId,
        "content_revision",
        1,
        `content-revision:${contentItemId}:${baseItemVersionId}`,
        pack.businessId,
      );

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
        error instanceof BillingDomainException
          ? false
          : error instanceof ProviderError
            ? error.retryable
            : true;
      const attemptsMade = job.attemptsMade ?? 0;
      const maxAttempts = Number(job.opts?.attempts ?? 3);
      const retryEligible = retryable && attemptsMade + 1 < maxAttempts;

      await this.packRepo.markItemStatus(
        contentItemId,
        retryEligible ? "revision_requested" : "revision_failed",
      );
      await this.packRepo.appendProgressEvent(pack.id, {
        stage: "revision",
        status: "failed",
        messageKey: "content.revision.failed",
        messageText: error instanceof Error ? error.message : "Unknown error",
        payload: {
          error_code:
            error instanceof BillingDomainException
              ? error.code
              : error instanceof ProviderError
              ? error.code
              : "CONTENT_REVISION_FAILED",
          retryable: retryEligible,
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
      assetId,
      contentItemVersionId,
      creativeBrief,
      altText,
      width,
      height,
      idempotencyKey,
      correlationId,
    } = job.data;

    this.logger.log(
      `[Corr: ${correlationId}] Generating static asset ${assetId} for version ${contentItemVersionId}`,
    );

    try {
      const existing = await this.packRepo.getAssetById(assetId);
      if (!existing) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          `Planned asset ${assetId} does not exist.`,
          false,
        );
      }
      if (existing.contentItemVersionId !== contentItemVersionId) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          `Planned asset ${assetId} belongs to a different item version.`,
          false,
        );
      }
      if (existing.status === "ready") return;

      const billingContext = await this.packRepo.getAssetBillingContext?.(assetId);
      if (billingContext) {
        await this.billingEntitlements?.assertAllowed(
          billingContext.ownerUserId,
          "static_image",
          1,
        );
      }

      const request = {
        contract_version: "content-v1" as const,
        asset_id: assetId,
        content_item_version_id: contentItemVersionId,
        creative_brief: creativeBrief,
        alt_text: altText,
        width,
        height,
        idempotency_key: idempotencyKey,
      };

      const response = await this.contentAiClient.generateStaticAsset(request);
      const asset = response.asset;

      if (
        asset.id !== assetId ||
        asset.content_item_version_id !== contentItemVersionId
      ) {
        throw new ProviderError(
          "CONTENT_SCHEMA_FAILURE",
          "Static asset provider returned a different planned asset identity.",
          false,
        );
      }

      if (asset.status === "ready" && asset.storage_key && asset.checksum) {
        if (!(await this.assetStorage.exists(asset.storage_key))) {
          throw new ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            `Static asset ${assetId} storage bytes are missing.`,
            true,
          );
        }
        const bytes = await this.assetStorage.retrieve(asset.storage_key);
        const checksum = createHash("sha256").update(bytes).digest("hex");
        if (checksum !== asset.checksum) {
          throw new ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            `Static asset ${assetId} failed storage checksum verification.`,
            false,
          );
        }
        await this.packRepo.markAssetReady({
          assetId,
          contentItemVersionId,
          mimeType: asset.mime_type,
          width: asset.width,
          height: asset.height,
          storageKey: asset.storage_key,
          checksum: asset.checksum,
          providerName: asset.provider_name,
          providerModel: asset.provider_model,
          providerRequestId: asset.provider_request_id,
        });

        if (billingContext) {
          await this.billingEntitlements?.record(
            billingContext.ownerUserId,
            "static_image",
            1,
            `static-image:${assetId}`,
            billingContext.businessId,
          );
        }

        this.logger.log(
          `[Corr: ${correlationId}] Static asset ${asset.id} stored with checksum ${asset.checksum}`,
        );
      } else {
        await this.packRepo.markAssetFailed({
          assetId,
          contentItemVersionId,
          failureCode: asset.failure_code ?? "CONTENT_ASSET_REQUIRED",
        });

        this.logger.warn(
          `[Corr: ${correlationId}] Static asset ${asset.id} generated with status ${asset.status}`,
        );
      }
    } catch (error) {
      const retryable =
        error instanceof BillingDomainException
          ? false
          : error instanceof ProviderError
            ? error.retryable
            : true;

      const failureCode =
        error instanceof BillingDomainException
          ? error.code
          : error instanceof ProviderError
          ? error.code
          : "CONTENT_ASSET_GENERATION_FAILED";

      await this.packRepo.markAssetFailed({
        assetId,
        contentItemVersionId,
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

  private async buildPolicyAssets(
    item: ContentItemVersion,
    pack: { readonly businessId: string },
    ownerUserId: string,
    approvedAssetIds: readonly string[],
  ): Promise<ContentAsset[]> {
    const approved = new Set(approvedAssetIds);
    const reusableAssetIds = item.asset_ids.filter((assetId) =>
      approved.has(assetId),
    );
    const reusable = this.packRepo.listReusableAssets
      ? await this.packRepo.listReusableAssets(
          reusableAssetIds,
          pack.businessId,
          ownerUserId,
        )
      : [];
    const reusableById = new Map(reusable.map((asset) => [asset.id, asset]));

    return item.asset_ids.flatMap((assetId) => {
      const existing = approved.has(assetId)
        ? reusableById.get(assetId)
        : undefined;
      if (existing) {
        return [
          toContentAsset({
            ...existing,
            contentItemVersionId: item.id,
          } as PrismaContentAsset),
        ];
      }

      if (
        item.asset_required &&
        assetId === deterministicGeneratedAssetId(item.id)
      ) {
        return [plannedGeneratedAsset(item, assetId)];
      }

      // Unknown IDs remain absent from the fixture so the deterministic
      // policy validator fails closed instead of treating an unapproved or
      // cross-business reference as a planned generated asset.
      return [];
    });
  }

  private async queuePlannedAssetJobs(
    itemVersions: readonly ContentItemVersion[],
    correlationId: string,
  ): Promise<void> {
    for (const item of itemVersions) {
      if (!item.asset_required) continue;
      for (const assetId of item.asset_ids) {
        const asset = await this.packRepo.getAssetById(assetId);
        if (
          !asset ||
          asset.contentItemVersionId !== item.id ||
          asset.status !== "generating"
        ) {
          continue;
        }
        const jobId = `generate-static-asset:${assetId}`;
        const payload = {
          assetId,
          contentItemVersionId: item.id,
          creativeBrief: item.creative_brief,
          altText: item.alt_text,
          width: 1080,
          height: 1080,
          idempotencyKey: `asset:${assetId}`,
          correlationId: `asset:${assetId}`,
        };
        await this.contentQueue.add(
          "generate-static-asset",
          this.jobOutbox ? payload : { ...payload, correlationId },
          this.jobOutbox
            ? {
                jobId: toBullMqJobId(jobId),
                attempts: 3,
                backoff: { type: "exponential", delay: 2000 },
              }
            : { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
        );
        await this.jobOutbox?.markDirectDispatched(jobId);
      }
    }
  }
}

function plannedGeneratedAsset(
  item: ContentItemVersion,
  assetId: string,
): ContentAsset {
  return {
    id: assetId,
    content_item_version_id: item.id,
    kind: "generated_static",
    status: "generating",
    mime_type: null,
    storage_key: null,
    checksum: null,
    width: null,
    height: null,
    alt_text: item.alt_text,
    provider_name: null,
    provider_model: null,
    provider_request_id: null,
    failure_code: null,
    review_required: true,
    created_at: item.created_at,
  };
}

function assetJobsForVersions(
  itemVersions: readonly ContentItemVersion[],
): ContentAssetJobIntent[] {
  return itemVersions.flatMap((item) => {
    const job = assetJobForVersion(item);
    return job ? [job] : [];
  });
}

function assetJobForVersion(
  item: ContentItemVersion,
): ContentAssetJobIntent | null {
  if (!item.asset_required) return null;
  const generatedAssetId = deterministicGeneratedAssetId(item.id);
  if (!item.asset_ids.includes(generatedAssetId)) return null;
  return {
    assetId: generatedAssetId,
    contentItemVersionId: item.id,
    creativeBrief: item.creative_brief,
    altText: item.alt_text,
    width: 1080,
    height: 1080,
  };
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
    createdAt: new Date(iv.created_at),
  };
}

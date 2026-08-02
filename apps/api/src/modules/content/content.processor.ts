import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
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
  ContentFormat,
  BusinessProfileData,
  LanguageMode,
} from "@marketmind/contracts";
import { ContentPackRepository, ContentItemVersionDraftInput } from "./repositories/content-pack.repository";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { ContentAiClient } from "./content.client";
import {
  toContentWeekContext,
  toContentPack,
  toPayload,
  planSelectedChannels,
  normalizeStrategyDecision,
} from "./content.service";

interface ContentGenerateJobData {
  contentCycleId: string;
  weekNumber: number;
  contentPackId: string;
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
  ) {
    super();
  }

  async process(job: Job<unknown, unknown, string>): Promise<unknown> {
    switch (job.name) {
      case "generate-content":
        return this.handleGenerate(job as unknown as Job<ContentGenerateJobData>);
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

      const selectedChannels = planSelectedChannels(
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
        allowed_formats: extractAllowedFormats(strategyVersion.planData),
        language_mode: extractLanguageMode(strategyVersion.planData),
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
        if (result.issues.length > 0) {
          throw new ProviderError(
            result.issues[0].code,
            result.issues[0].message,
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
}

function toDraftInput(iv: ContentItemVersion): ContentItemVersionDraftInput {
  return {
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

function extractAllowedFormats(planData: unknown): ContentFormat[] {
  const plan = toPayload(planData);
  const formats = plan["allowed_formats"];
  if (!Array.isArray(formats)) return [];
  return formats.filter(
    (f): f is ContentFormat =>
      typeof f === "string" && ["post", "story", "reel"].includes(f),
  );
}

function extractLanguageMode(planData: unknown): LanguageMode {
  const plan = toPayload(planData);
  const lang = plan["plan_language"];
  if (lang === "ar-EG" || lang === "en" || lang === "mixed") return lang;
  return "ar-EG";
}

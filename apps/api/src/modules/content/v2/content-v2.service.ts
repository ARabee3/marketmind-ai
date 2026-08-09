import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type {
  AiContentV2PlanRequest,
  AiContentV2ReviseRequest,
  ContentClaimSource,
  ContentCycleWorkspaceV2,
  ContentEditorialProfileV2,
  ContentMediaLibraryEntryV2,
  ContentPackV2,
  ContentPackWorkspaceV2,
  ContentV2FrozenInput,
  ContentWeekPlanV2,
  OwnerContentDirectEditRequest,
} from "@marketmind/contracts";
import {
  deterministicGeneratedAssetId,
  StrategyPlanV2,
} from "@marketmind/contracts";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { GenerateContentPackRequest } from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { StrategyRepository } from "../../strategy/strategy.repository";
import { ContentAiClient } from "../content.client";
import { ContentPackRepository } from "../repositories/content-pack.repository";
import { ContentJobOutboxRepository } from "../content-job-outbox.repository";
import {
  CONTENT_ASSET_STORAGE,
  type AssetStorage,
} from "../assets/asset-storage.port";
import {
  ContentSetupRepository,
  type UpsertEditorialProfileInput,
  type CreateCtaEntryInput,
} from "./content-setup.repository";
import {
  ContentMediaLibraryRepository,
  ContentMediaValidator,
  buildMediaStorageKey,
  normalizeDeclaredMime,
} from "./content-media.repository";
import {
  ContentWeekPlanRepository,
  type PostPlanInput,
} from "./content-week-plan.repository";
import { ContentVersionEditRepository } from "./content-version-edit.repository";
import { toBullMqJobId } from "../../../common/queues/bullmq-job-id";
import {
  toContentPackV2,
  toCtaLibraryEntryV2,
  toEditorialProfileV2,
  toItemVersionV2,
  toMediaLibraryEntryV2,
  toPayloadJson,
  toWeekPlanV2,
} from "./content-v2-mappers";

export const CONTENT_V2_REQUIRED = "CONTENT_V2_REQUIRED";
const STATIC_IMAGE_SIZE_PX = 1024;

export type UploadMediaResult = {
  readonly media: ContentMediaLibraryEntryV2;
  readonly created: boolean;
};

export type ContentV2RewriteRequest = {
  readonly contract_version: "content-v2";
  readonly base_version_id: string;
  readonly base_version_checksum: string;
  readonly revision_notes: string;
  readonly idempotency_key: string;
};

/**
 * Content v2 service (issue #187) — owner-first weekly studio read/write
 * side. Every read re-verifies cycle ownership server-side (404 for
 * cross-owner access). No path schedules or publishes anything; approval
 * keeps flowing through the existing PublicationCandidateV1 boundary.
 */
@Injectable()
export class ContentV2Service {
  private readonly logger = new Logger(ContentV2Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyRepository: StrategyRepository,
    private readonly setupRepository: ContentSetupRepository,
    private readonly mediaRepository: ContentMediaLibraryRepository,
    private readonly mediaValidator: ContentMediaValidator,
    private readonly weekPlanRepository: ContentWeekPlanRepository,
    private readonly versionEditRepository: ContentVersionEditRepository,
    private readonly contentAiClient: ContentAiClient,
    private readonly packRepository: ContentPackRepository,
    private readonly jobOutbox: ContentJobOutboxRepository,
    @InjectQueue("content-generation") private readonly contentQueue: Queue,
    @Inject(CONTENT_ASSET_STORAGE) private readonly assetStorage: AssetStorage,
  ) {}

  // -------------------------------------------------------------------------
  // Ownership helpers
  // -------------------------------------------------------------------------

  private async getCycleOrThrow(
    cycleId: string,
    ownerUserId: string,
    requireV2 = true,
  ): Promise<Prisma.ContentCycleGetPayload<Record<string, never>>> {
    const cycle = await this.prisma.contentCycle.findFirst({
      where: { id: cycleId, ownerUserId },
    });
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
    if (requireV2 && cycle.contractVersion !== "content-v2") {
      throw new BadRequestException({
        code: CONTENT_V2_REQUIRED,
        message:
          "This legacy Content v1 cycle is quarantined from the active workflow. Start a new content-v2 cycle.",
      });
    }
    return cycle;
  }

  private async getPackOrThrow(
    packId: string,
    ownerUserId: string,
  ): Promise<
    Prisma.ContentPackGetPayload<{
      include: { contentCycle: true; weekContext: true };
    }>
  > {
    const pack = await this.prisma.contentPack.findUnique({
      where: { id: packId },
      include: { contentCycle: true, weekContext: true },
    });
    if (!pack || pack.contentCycle.ownerUserId !== ownerUserId) {
      throw new NotFoundException("Content pack not found");
    }
    if (pack.contractVersion !== "content-v2") {
      throw new BadRequestException({
        code: CONTENT_V2_REQUIRED,
        message:
          "This legacy Content v1 pack is quarantined from the active V2 workflow. Start a new content-v2 cycle.",
      });
    }
    return pack;
  }

  // -------------------------------------------------------------------------
  // Editorial profile + CTA library
  // -------------------------------------------------------------------------

  async upsertEditorialProfile(
    cycleId: string,
    input: UpsertEditorialProfileInput,
    ownerUserId: string,
  ) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.setupRepository.upsertEditorialProfile(
      input,
      ownerUserId,
    );
    return { editorial_profile: toEditorialProfileV2(row) };
  }

  async getEditorialProfile(cycleId: string, ownerUserId: string) {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.setupRepository.getEditorialProfile(
      cycleId,
      ownerUserId,
    );
    if (row) {
      return {
        editorial_profile: toEditorialProfileV2(row),
        editorial_suggestion: null,
      };
    }
    const [strategyVersion, profileVersion] = await Promise.all([
      this.strategyRepository.getVersionByNumber(
        cycle.strategyId,
        cycle.strategyVersion,
      ),
      this.getPinnedProfileVersion(cycle.profileVersionId, cycle.businessId),
    ]);
    return {
      editorial_profile: null,
      editorial_suggestion: this.buildFallbackEditorialProfile(
        cycle,
        profileVersion,
        toPayloadJson(strategyVersion?.planData ?? {}),
      ),
    };
  }

  async resetEditorialProfile(cycleId: string, ownerUserId: string) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    return this.setupRepository.deleteEditorialProfile(cycleId, ownerUserId);
  }

  async createCtaEntry(
    cycleId: string,
    input: CreateCtaEntryInput,
    ownerUserId: string,
  ) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.setupRepository.createCtaEntry(input, ownerUserId);
    return { entry: toCtaLibraryEntryV2(row) };
  }

  async listCtaEntries(cycleId: string, ownerUserId: string) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const rows = await this.setupRepository.listCtaEntries(
      cycleId,
      ownerUserId,
    );
    return { entries: rows.map(toCtaLibraryEntryV2) };
  }

  async updateCtaEntry(
    cycleId: string,
    entryId: string,
    ownerUserId: string,
    changes: Parameters<ContentSetupRepository["updateCtaEntry"]>[3],
  ) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.setupRepository.updateCtaEntry(
      cycleId,
      entryId,
      ownerUserId,
      changes,
    );
    return { entry: toCtaLibraryEntryV2(row) };
  }

  async deactivateCtaEntry(
    cycleId: string,
    entryId: string,
    ownerUserId: string,
  ) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.setupRepository.deactivateCtaEntry(
      cycleId,
      entryId,
      ownerUserId,
    );
    return { entry: toCtaLibraryEntryV2(row) };
  }

  // -------------------------------------------------------------------------
  // Media library
  // -------------------------------------------------------------------------

  /**
   * Validates, stores, and records an owner upload. The record starts in
   * `queued`; byte storage happens in this call and the record moves to
   * `ready` or `failed` with a machine-readable failure code.
   */
  async uploadMedia(
    cycleId: string,
    ownerUserId: string,
    buffer: Buffer,
    declaredType: string,
    filename: string,
  ): Promise<UploadMediaResult> {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    const declaredMime = normalizeDeclaredMime(declaredType);
    const validation = this.mediaValidator.validateUpload(buffer, declaredType);
    if (validation.valid === false) {
      const failed = await this.mediaRepository.createEntry({
        id: randomUUID(),
        businessId: cycle.businessId,
        contentCycleId: cycleId,
        ownerUserId,
        kind: "owner_uploaded",
        status: "failed",
        mimeType: declaredMime || null,
        sizeBytes: buffer.length,
        width: null,
        height: null,
        checksum: null,
        storageKey: null,
        failureCode: validation.failureCode,
      });
      return { media: toMediaLibraryEntryV2(failed), created: true };
    }

    const mediaId = randomUUID();
    const storageKey = buildMediaStorageKey(cycleId, mediaId, declaredMime);
    const checksum = this.mediaValidator.checksum(buffer);
    await this.mediaRepository.createEntry({
      id: mediaId,
      businessId: cycle.businessId,
      contentCycleId: cycleId,
      ownerUserId,
      kind: "owner_uploaded",
      status: "queued",
      mimeType: declaredMime,
      sizeBytes: buffer.length,
      width: validation.width,
      height: validation.height,
      checksum,
      storageKey,
      failureCode: null,
    });

    try {
      await this.assetStorage.store(buffer, storageKey);
      const row = await this.mediaRepository.updateStatus(mediaId, "ready", {});
      return { media: toMediaLibraryEntryV2(row), created: true };
    } catch (error) {
      const row = await this.mediaRepository.updateStatus(mediaId, "failed", {
        failureCode: "CONTENT_MEDIA_STORAGE_FAILURE",
      });
      return { media: toMediaLibraryEntryV2(row), created: true };
    }
  }

  async listMedia(cycleId: string, ownerUserId: string) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const rows = await this.mediaRepository.listCycleEntries(
      cycleId,
      ownerUserId,
    );
    return { entries: rows.map(toMediaLibraryEntryV2) };
  }

  async getMedia(cycleId: string, mediaId: string, ownerUserId: string) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.mediaRepository.getEntryByIdAndCycle(
      cycleId,
      mediaId,
      ownerUserId,
    );
    if (!row) {
      throw new NotFoundException("Media library entry not found");
    }
    return { media: toMediaLibraryEntryV2(row) };
  }

  async getMediaFile(
    cycleId: string,
    mediaId: string,
    ownerUserId: string,
  ): Promise<{ buffer: Buffer; mimeType: string; checksum: string }> {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.mediaRepository.getEntryByIdAndCycle(
      cycleId,
      mediaId,
      ownerUserId,
    );
    if (!row) throw new NotFoundException("Media library entry not found");
    if (
      row.status !== "ready" ||
      !row.storageKey ||
      !row.checksum ||
      !row.mimeType
    ) {
      throw new ConflictException({
        code: "CONTENT_ASSET_REQUIRED",
        message: "This visual is not ready yet.",
      });
    }
    const buffer = await this.assetStorage.retrieve(row.storageKey);
    const checksum = createHash("sha256").update(buffer).digest("hex");
    if (checksum !== row.checksum) {
      throw new ConflictException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: "The stored visual failed checksum verification.",
      });
    }
    return { buffer, mimeType: row.mimeType, checksum };
  }

  async revokeMedia(cycleId: string, mediaId: string, ownerUserId: string) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    return this.mediaRepository.revokeEntry(cycleId, mediaId, ownerUserId);
  }

  // -------------------------------------------------------------------------
  // Week plans
  // -------------------------------------------------------------------------

  async getWeekPlan(
    cycleId: string,
    weekNumber: number,
    ownerUserId: string,
  ): Promise<{ week_plan: ContentWeekPlanV2 | null }> {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.weekPlanRepository.getWeekPlan(
      cycleId,
      weekNumber,
      ownerUserId,
    );
    return { week_plan: row ? toWeekPlanV2(row) : null };
  }

  async createOrReplaceWeekPlan(
    cycleId: string,
    weekNumber: number,
    postPlans: readonly PostPlanInput[],
    ownerUserId: string,
  ): Promise<{ week_plan: ContentWeekPlanV2 }> {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    if (weekNumber !== cycle.currentWeekNumber) {
      throw new BadRequestException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Only the current week (${cycle.currentWeekNumber}) can be planned.`,
      });
    }
    const [strategyVersion, ctaRows, mediaRows] = await Promise.all([
      this.strategyRepository.getVersionByNumber(
        cycle.strategyId,
        cycle.strategyVersion,
      ),
      this.setupRepository.listCtaEntries(cycleId, ownerUserId),
      this.mediaRepository.listCycleEntries(cycleId, ownerUserId),
    ]);
    const { channels, formats } = this.allowedHandoffForWeek(
      toPayloadJson(strategyVersion?.planData ?? {}),
      weekNumber,
    );
    this.validatePostPlans(postPlans, channels, formats, ctaRows, mediaRows);
    const existingPlan = await this.weekPlanRepository.getWeekPlan(
      cycleId,
      weekNumber,
      ownerUserId,
    );
    const sourceAwarePostPlans = postPlans.map((postPlan) => {
      const previous = existingPlan?.postPlans.find(
        (candidate) => candidate.position === postPlan.position,
      );
      return {
        ...postPlan,
        // A card becomes owner-authored only when its editable fields change.
        // This keeps untouched planner suggestions truthfully labelled after a
        // single-card edit, without trusting a client-supplied source flag.
        source:
          previous && this.samePostPlanFields(previous, postPlan)
            ? (previous.source as "planner" | "owner")
            : ("owner" as const),
      };
    });
    const row = await this.weekPlanRepository.createOrReplaceWeekPlan(
      cycleId,
      weekNumber,
      sourceAwarePostPlans,
      ownerUserId,
    );
    return { week_plan: toWeekPlanV2(row) };
  }

  async listWeekPlans(cycleId: string, ownerUserId: string) {
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const rows = await this.weekPlanRepository.listWeekPlans(
      cycleId,
      ownerUserId,
    );
    return { week_plans: rows.map(toWeekPlanV2) };
  }

  /**
   * Planner stage (issue #187): asks the AI planner for 3–5 high-level post
   * cards and persists them as a draft week plan. The planner receives only
   * the approved Strategy v2 handoff, the cycle editorial settings, and
   * permitted owner inputs; it never returns publishable copy.
   */
  async planWeek(
    cycleId: string,
    weekNumber: number,
    ownerUserId: string,
  ): Promise<{ week_plan: ContentWeekPlanV2 }> {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    if (weekNumber !== cycle.currentWeekNumber) {
      throw new BadRequestException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Only the current week (${cycle.currentWeekNumber}) can be planned.`,
      });
    }
    const [editorialRow, ctaRows, mediaRows, strategyVersion] =
      await Promise.all([
        this.setupRepository.getEditorialProfile(cycleId, ownerUserId),
        this.setupRepository.listCtaEntries(cycleId, ownerUserId),
        this.mediaRepository.listCycleEntries(cycleId, ownerUserId),
        this.strategyRepository.getVersionByNumber(
          cycle.strategyId,
          cycle.strategyVersion,
        ),
      ]);
    const profileVersion = editorialRow
      ? null
      : await this.getPinnedProfileVersion(
          cycle.profileVersionId,
          cycle.businessId,
        );
    const planData = toPayloadJson(strategyVersion?.planData ?? {});
    if (planData["contract_version"] !== "strategy-v2") {
      throw new BadRequestException({
        code: CONTENT_V2_REQUIRED,
        message: "The approved Strategy plan is not content-v2 compatible.",
      });
    }
    const handoff = planData["content_handoff"] as
      | {
          available: true;
          channels: string[];
          language: string;
          weeks: Array<{ week_number: number; formats: string[] }>;
        }
      | {
          available: false;
          reason: string;
          message: string;
        };
    if (handoff.available !== true) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: "The approved Strategy has no usable content handoff.",
      });
    }
    const weekFormats = handoff.weeks.find(
      (week) => week.week_number === weekNumber,
    )?.formats;
    if (!weekFormats || weekFormats.length === 0) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: `The approved Strategy handoff has no formats for week ${weekNumber}.`,
      });
    }

    const planRequest: AiContentV2PlanRequest = {
      contract_version: "content-v2",
      week_plan_id: cycleId,
      business_id: cycle.businessId,
      strategy_id: cycle.strategyId,
      strategy_version: cycle.strategyVersion,
      strategy_decision_id: cycle.strategyDecisionId,
      strategy_plan: planData as unknown as StrategyPlanV2,
      week_number: weekNumber,
      editorial_profile: editorialRow
        ? toEditorialProfileV2(editorialRow)
        : this.buildFallbackEditorialProfile(cycle, profileVersion, planData),
      cta_library: ctaRows
        .filter((entry) => entry.active)
        .map(toCtaLibraryEntryV2),
      media_library: mediaRows
        .filter((entry) => entry.status === "ready")
        .map(toMediaLibraryEntryV2),
      allowed_channels:
        handoff.channels as AiContentV2PlanRequest["allowed_channels"],
      allowed_formats: weekFormats as AiContentV2PlanRequest["allowed_formats"],
      language_mode:
        (handoff.language as AiContentV2PlanRequest["language_mode"]) ??
        "ar-EG",
      idempotency_key: `plan:${cycleId}:week:${weekNumber}`,
    };

    const response = await this.contentAiClient.plan(planRequest);

    const postPlans = response.post_plans.map((plan, index) => ({
      position: index + 1,
      purpose: plan.purpose,
      intendedAudience: plan.intended_audience ?? null,
      channel: plan.channel,
      format: plan.format,
      ctaLibraryEntryId: plan.cta_library_entry_id,
      ownerInstructions: plan.owner_instructions ?? null,
      visualDirection: plan.visual_direction ?? null,
      selectedMediaIds: plan.selected_media_ids,
      source: "planner" as const,
    }));
    this.validatePostPlans(
      postPlans,
      handoff.channels,
      weekFormats,
      ctaRows,
      mediaRows,
    );

    const row = await this.weekPlanRepository.createOrReplaceWeekPlan(
      cycleId,
      weekNumber,
      postPlans,
      ownerUserId,
    );
    return { week_plan: toWeekPlanV2(row) };
  }

  /**
   * Explicit generation (issue #187): freezes the week plan with its
   * transactionally frozen plan/profile/CTA/media snapshot, claims the week,
   * and queues the `generate-content-v2` worker job. Idempotency and
   * cutoff-safe behavior mirror the v1 claim path; the cursor only advances
   * via the shared scheduler for v1 semantics.
   */
  async generateWeek(
    cycleId: string,
    weekNumber: number,
    dto: GenerateContentPackRequest,
    ownerUserId: string,
  ): Promise<{
    content_pack: ContentPackV2;
    status: "queued";
    correlation_id: string;
  }> {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    if (cycle.status === "paused") {
      throw new BadRequestException({
        code: "CONTENT_CYCLE_PAUSED",
        message: "Content cycle is paused; cannot generate.",
      });
    }
    if (cycle.status === "completed") {
      throw new BadRequestException({
        code: "CONTENT_CYCLE_COMPLETED",
        message: "Content cycle is completed; cannot generate.",
      });
    }
    if (weekNumber !== cycle.currentWeekNumber) {
      throw new ConflictException({
        code: "CONTENT_WEEK_ALREADY_CLAIMED",
        message: `Week ${weekNumber} is not the current actionable Content week.`,
      });
    }

    const [
      weekPlan,
      editorialRow,
      ctaRows,
      mediaRows,
      weekContextRow,
      strategyVersion,
    ] = await Promise.all([
      this.weekPlanRepository.getWeekPlan(cycleId, weekNumber, ownerUserId),
      this.setupRepository.getEditorialProfile(cycleId, ownerUserId),
      this.setupRepository.listCtaEntries(cycleId, ownerUserId),
      this.mediaRepository.listCycleEntries(cycleId, ownerUserId),
      this.prisma.contentWeekContext.findUnique({
        where: {
          contentCycleId_weekNumber: { contentCycleId: cycleId, weekNumber },
        },
      }),
      this.strategyRepository.getVersionByNumber(
        cycle.strategyId,
        cycle.strategyVersion,
      ),
    ]);
    const profileVersion = editorialRow
      ? null
      : await this.getPinnedProfileVersion(
          cycle.profileVersionId,
          cycle.businessId,
        );
    const planData = toPayloadJson(strategyVersion?.planData ?? {});
    if (!weekPlan || weekPlan.status !== "draft") {
      throw new BadRequestException({
        code: CONTENT_V2_REQUIRED,
        message: `Plan week ${weekNumber} before requesting generation.`,
      });
    }
    if (weekPlan.postPlans.length < 3) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: `Week ${weekNumber} has fewer than three planned posts.`,
      });
    }
    if (!weekContextRow) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: `Week ${weekNumber} context is missing.`,
      });
    }

    const planInputs = weekPlan.postPlans.map((plan) => ({
      position: plan.position,
      purpose: plan.purpose,
      intendedAudience: plan.intendedAudience,
      channel: plan.channel,
      format: plan.format,
      ctaLibraryEntryId: plan.ctaLibraryEntryId,
      ownerInstructions: plan.ownerInstructions,
      visualDirection: plan.visualDirection,
      selectedMediaIds: Array.isArray(plan.selectedMediaIds)
        ? plan.selectedMediaIds.map(String)
        : [],
      source: plan.source as "planner" | "owner",
    }));
    const { channels, formats } = this.allowedHandoffForWeek(
      planData,
      weekNumber,
    );
    this.validatePostPlans(planInputs, channels, formats, ctaRows, mediaRows);

    const referencedMediaIds = new Set(
      weekPlan.postPlans.flatMap((plan) => {
        const ids = Array.isArray(plan.selectedMediaIds)
          ? plan.selectedMediaIds.map(String)
          : [];
        return ids;
      }),
    );
    const frozenInput = {
      week_plan_id: weekPlan.id,
      content_cycle_id: cycleId,
      week_number: weekNumber,
      week_start_date: weekContextRow.weekStartDate.toISOString().slice(0, 10),
      editorial_profile: editorialRow
        ? toEditorialProfileV2(editorialRow)
        : this.buildFallbackEditorialProfile(cycle, profileVersion, planData),
      cta_entries: ctaRows
        .filter((entry) => entry.active)
        .map(toCtaLibraryEntryV2),
      media_entries: mediaRows
        .filter(
          (entry) =>
            entry.status === "ready" && referencedMediaIds.has(entry.id),
        )
        .map(toMediaLibraryEntryV2),
      post_plans: weekPlan.postPlans
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((plan) => ({
          id: plan.id,
          contract_version: "content-v2",
          content_week_plan_id: plan.contentWeekPlanId,
          position: plan.position,
          purpose: plan.purpose,
          intended_audience: plan.intendedAudience,
          channel: plan.channel as never,
          format: plan.format as never,
          cta_library_entry_id: plan.ctaLibraryEntryId,
          owner_instructions: plan.ownerInstructions,
          visual_direction: plan.visualDirection,
          selected_media_ids: Array.isArray(plan.selectedMediaIds)
            ? plan.selectedMediaIds.map(String)
            : [],
          plan_state: plan.planState as never,
          source: plan.source as never,
          content_item_id: plan.contentItemId,
          created_at: plan.createdAt.toISOString(),
          updated_at: plan.updatedAt.toISOString(),
        })),
      weekly_claim_id: weekContextRow.weeklyClaimId,
      frozen_at: new Date().toISOString(),
    };

    const { pack, created } = await this.packRepository.claimQueuedPackV2({
      cycleId,
      weekNumber,
      weekContextId: weekContextRow.id,
      weekPlanId: weekPlan.id,
      frozenInput,
      jobIntent: { idempotencyKey: dto.idempotency_key },
    });

    const correlationId = randomUUID();
    const jobId = `generate-content-v2-${pack.id}`;
    const durableJobPayload = {
      contentCycleId: cycleId,
      weekNumber,
      contentPackId: pack.id,
      idempotencyKey: `pack:${pack.id}`,
      correlationId: `pack:${pack.id}`,
    };
    const queuePayload = created
      ? durableJobPayload
      : {
          contentCycleId: cycleId,
          weekNumber,
          contentPackId: pack.id,
          idempotencyKey: dto.idempotency_key,
          correlationId,
        };
    const queueOptions = {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    };
    if (!created) {
      if (
        pack.status === "queued" &&
        (!Array.isArray(pack.itemIds) || pack.itemIds.length === 0)
      ) {
        await this.contentQueue.add(
          "generate-content-v2",
          queuePayload,
          queueOptions,
        );
      }
      return {
        content_pack: toContentPackV2(pack),
        status: "queued",
        correlation_id: `pack:${pack.id}`,
      };
    }

    await this.contentQueue.add(
      "generate-content-v2",
      queuePayload,
      queueOptions,
    );
    await this.jobOutbox.markDirectDispatched(jobId);

    return {
      content_pack: toContentPackV2(pack),
      status: "queued",
      correlation_id: correlationId,
    };
  }

  // -------------------------------------------------------------------------
  // Owner direct edit (immutable new version)
  // -------------------------------------------------------------------------

  async directEdit(
    packId: string,
    itemId: string,
    dto: OwnerContentDirectEditRequest,
    ownerUserId: string,
  ) {
    const pack = await this.getPackOrThrow(packId, ownerUserId);
    this.assertPackEditable(pack);
    const baseVersion = await this.prisma.contentItemVersion.findFirst({
      where: { id: dto.base_version_id, contentPackId: packId },
    });
    if (!baseVersion) {
      throw new NotFoundException("Base content item version not found");
    }
    await this.assertItemEditable(packId, itemId);
    if (baseVersion.versionChecksum !== dto.base_version_checksum) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "The base version checksum does not match. Refresh and retry.",
      });
    }
    const normalizedCta = dto.cta?.trim() || null;
    const normalizedHashtags =
      baseVersion.channel === "google_business_profile"
        ? []
        : normalizeEditableHashtags(dto.hashtags);
    const normalizedCaptionVariants = dto.caption_variants.map((variant) => ({
      ...variant,
      // The immutable item contract has one canonical CTA mirrored on every
      // locale variant. Keep owner edits truthful even when the form changes
      // only the top-level CTA field.
      cta: normalizedCta,
      hashtags: normalizedHashtags,
    }));
    const version = await this.versionEditRepository.appendOwnerEditVersion({
      contentItemId: itemId,
      contentPackId: packId,
      baseVersionId: dto.base_version_id,
      baseVersionChecksum: dto.base_version_checksum,
      editedByUserId: ownerUserId,
      newVersionNumber: baseVersion.version + 1,
      channel: baseVersion.channel,
      format: baseVersion.format,
      languageMode: baseVersion.languageMode,
      strategyTrace: baseVersion.strategyTrace,
      captionVariants: normalizedCaptionVariants,
      cta: normalizedCta,
      hashtags: normalizedHashtags,
      creativeBrief: dto.creative_brief,
      altText: dto.alt_text,
      shortVideoScript: baseVersion.shortVideoScript,
      recommendedPublishWindow: baseVersion.recommendedPublishWindow,
      claimSources:
        baseVersion.claimSources as unknown as readonly ContentClaimSource[],
      warnings: baseVersion.warnings as readonly string[],
      blockers: baseVersion.blockers as readonly string[],
      assetRequired: baseVersion.assetRequired,
      assetIds: baseVersion.assetIds as readonly string[],
      versionChecksum: dto.base_version_checksum,
    });
    return { item_version: toItemVersionV2(version) };
  }

  /**
   * AI rewrite (issue #187): sends the owner's revision notes plus the frozen
   * plan/profile/CTA/media snapshot and the confirmed profile to the AI
   * service, then persists the returned immutable `ai_rewrite` version gated
   * on the base id + checksum.
   */
  async rewriteItem(
    packId: string,
    itemId: string,
    dto: ContentV2RewriteRequest,
    ownerUserId: string,
  ) {
    const pack = await this.getPackOrThrow(packId, ownerUserId);
    this.assertPackEditable(pack);
    if (pack.contractVersion !== "content-v2" || !pack.weekPlanId) {
      throw new BadRequestException({
        code: CONTENT_V2_REQUIRED,
        message: "AI rewrite is only available on content-v2 packs.",
      });
    }
    const baseVersion = await this.prisma.contentItemVersion.findFirst({
      where: { id: dto.base_version_id, contentPackId: packId },
    });
    if (!baseVersion) {
      throw new NotFoundException("Base content item version not found");
    }
    await this.assertItemEditable(packId, itemId);
    if (baseVersion.versionChecksum !== dto.base_version_checksum) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "The base version checksum does not match. Refresh and retry.",
      });
    }

    const [weekPlanRow, strategyVersion] = await Promise.all([
      this.prisma.contentWeekPlan.findUnique({
        where: { id: pack.weekPlanId },
        include: { postPlans: true },
      }),
      this.strategyRepository.getVersionByNumber(
        pack.strategyId,
        pack.strategyVersion,
      ),
    ]);
    const profileVersion = await this.getPinnedProfileVersion(
      pack.profileVersionId,
      pack.businessId,
    );
    const frozenInput =
      weekPlanRow?.frozenInput as unknown as ContentV2FrozenInput | null;
    if (!frozenInput || !strategyVersion || !profileVersion) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message:
          "The frozen plan snapshot or profile is missing for this pack.",
      });
    }
    const plan = this.frozenPlanForItem(frozenInput, pack, itemId);
    if (!plan) {
      throw new NotFoundException("Post plan for the content item not found");
    }

    const aiRequest: AiContentV2ReviseRequest = {
      contract_version: "content-v2",
      content_pack_id: packId,
      content_item_id: itemId,
      business_id: pack.businessId,
      strategy_id: pack.strategyId,
      strategy_version: pack.strategyVersion,
      strategy_decision_id: pack.strategyDecisionId,
      strategy_plan: toPayloadJson(
        strategyVersion.planData,
      ) as unknown as StrategyPlanV2,
      business_profile: {
        id: profileVersion.id,
        business_id: profileVersion.businessId,
        draft_id: profileVersion.id,
        version: profileVersion.version,
        profile:
          profileVersion.profile as unknown as AiContentV2ReviseRequest["business_profile"]["profile"],
        confirmed_by_user_id: profileVersion.confirmedByUserId ?? undefined,
        confirmed_at: profileVersion.confirmedAt?.toISOString() ?? undefined,
        created_at: profileVersion.createdAt.toISOString(),
      },
      frozen_input: frozenInput,
      language_mode: (frozenInput.editorial_profile?.language ??
        "ar-EG") as AiContentV2ReviseRequest["language_mode"],
      idempotency_key: dto.idempotency_key,
      base_item_version: toItemVersionV2(baseVersion),
      revision_notes: dto.revision_notes,
    };

    const response = await this.contentAiClient.reviseV2(aiRequest);

    const version = await this.versionEditRepository.appendAiRewriteVersion({
      contentItemId: itemId,
      contentPackId: packId,
      baseVersionId: dto.base_version_id,
      baseVersionChecksum: dto.base_version_checksum,
      editedByUserId: ownerUserId,
      newVersionNumber: baseVersion.version + 1,
      channel: response.item_version.channel,
      format: response.item_version.format,
      languageMode: response.item_version.language_mode,
      strategyTrace: response.item_version
        .strategy_trace as Prisma.InputJsonValue,
      captionVariants: response.item_version.caption_variants,
      cta: response.item_version.cta,
      hashtags: response.item_version.hashtags,
      creativeBrief: response.item_version.creative_brief,
      altText: response.item_version.alt_text,
      shortVideoScript:
        response.item_version.short_video_script === null
          ? null
          : (response.item_version.short_video_script as Prisma.InputJsonValue),
      recommendedPublishWindow: response.item_version
        .recommended_publish_window as Prisma.InputJsonValue,
      claimSources: response.item_version
        .claim_sources as unknown as readonly ContentClaimSource[],
      warnings: response.item_version.warnings,
      blockers: response.item_version.blockers,
      assetRequired: baseVersion.assetRequired,
      // Rewrites may change copy, never the immutable media identity. The
      // repository links the existing assets to the new version.
      assetIds: baseVersion.assetIds as readonly string[],
      versionChecksum: response.item_version.version_checksum,
      generationProvenance: response.item_version
        .generation_provenance as Prisma.InputJsonValue,
    });
    return { item_version: toItemVersionV2(version) };
  }

  async attachMediaToItem(
    packId: string,
    itemId: string,
    dto: {
      readonly base_version_id: string;
      readonly base_version_checksum: string;
      readonly media_id: string;
    },
    ownerUserId: string,
  ) {
    const pack = await this.getPackOrThrow(packId, ownerUserId);
    this.assertPackEditable(pack);
    const baseVersion = await this.getEditableBaseVersion(
      packId,
      itemId,
      dto.base_version_id,
      dto.base_version_checksum,
    );
    const media = await this.mediaRepository.getEntryByIdAndCycle(
      pack.contentCycleId,
      dto.media_id,
      ownerUserId,
    );
    if (
      !media ||
      media.status !== "ready" ||
      !media.storageKey ||
      !media.checksum
    ) {
      throw new ConflictException({
        code: "CONTENT_ASSET_REQUIRED",
        message: "Choose a ready visual before attaching it to this post.",
      });
    }
    const versionId = randomUUID();
    const version = await this.versionEditRepository.appendOwnerEditVersion({
      ...this.mediaVersionInput(baseVersion, packId, itemId, ownerUserId),
      versionId,
      editKind: "media_update",
      baseVersionId: dto.base_version_id,
      baseVersionChecksum: dto.base_version_checksum,
      assetIds: [dto.media_id],
      versionChecksum: dto.base_version_checksum,
    });
    return { item_version: toItemVersionV2(version) };
  }

  async generateMediaForItem(
    packId: string,
    itemId: string,
    dto: {
      readonly base_version_id: string;
      readonly base_version_checksum: string;
      readonly visual_instruction?: string;
      readonly idempotency_key: string;
    },
    ownerUserId: string,
  ) {
    const pack = await this.getPackOrThrow(packId, ownerUserId);
    this.assertPackEditable(pack);
    const baseVersion = await this.getEditableBaseVersion(
      packId,
      itemId,
      dto.base_version_id,
      dto.base_version_checksum,
    );
    const versionId = randomUUID();
    const assetId = deterministicGeneratedAssetId(versionId);
    const creativeBrief =
      dto.visual_instruction?.trim() || baseVersion.creativeBrief;
    const currentBlockers = Array.isArray(baseVersion.blockers)
      ? (baseVersion.blockers as string[])
      : [];
    const blockers = baseVersion.assetRequired
      ? Array.from(new Set([...currentBlockers, "CONTENT_ASSET_REQUIRED"]))
      : currentBlockers.filter(
          (blocker) => blocker !== "CONTENT_ASSET_REQUIRED",
        );
    const jobId = `generate-static-asset:${assetId}`;
    const { version, payload } = await this.prisma.$transaction(async (tx) => {
      const version = await this.versionEditRepository.appendOwnerEditVersion(
        {
          ...this.mediaVersionInput(baseVersion, packId, itemId, ownerUserId),
          versionId,
          editKind: "media_update",
          baseVersionId: dto.base_version_id,
          baseVersionChecksum: dto.base_version_checksum,
          creativeBrief,
          blockers,
          assetIds: [assetId],
          versionChecksum: dto.base_version_checksum,
        },
        tx,
      );
      const payload = {
        assetId,
        contentItemVersionId: version.id,
        creativeBrief,
        altText: version.altText,
        width: STATIC_IMAGE_SIZE_PX,
        height: STATIC_IMAGE_SIZE_PX,
        idempotencyKey: dto.idempotency_key,
        correlationId: `asset:${assetId}`,
      };
      await this.jobOutbox.createIntent(
        {
          jobId,
          queueName: "content-generation",
          jobName: "generate-static-asset",
          payload,
        },
        tx,
      );
      return { version, payload };
    });
    try {
      await this.contentQueue.add("generate-static-asset", payload, {
        jobId: toBullMqJobId(jobId),
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });
      await this.jobOutbox.markDirectDispatched(jobId);
    } catch (error) {
      this.logger.warn(
        `Media job ${jobId} remains durable for reconciliation: ${
          error instanceof Error ? error.message : "unknown queue error"
        }`,
      );
    }
    return {
      item_version: toItemVersionV2(version),
      status: "queued" as const,
    };
  }

  private async getEditableBaseVersion(
    packId: string,
    itemId: string,
    versionId: string,
    checksum: string,
  ) {
    const item = await this.packRepository.getItemById(packId, itemId);
    if (!item || item.currentVersionId !== versionId) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "Refresh this post before changing its visual.",
        latest_version_id: item?.currentVersionId ?? null,
      });
    }
    await this.assertItemEditable(packId, itemId);
    const baseVersion = await this.prisma.contentItemVersion.findFirst({
      where: { id: versionId, contentPackId: packId, contentItemId: itemId },
    });
    if (!baseVersion)
      throw new NotFoundException("Base content item version not found");
    if (baseVersion.versionChecksum !== checksum) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "Refresh this post before changing its visual.",
        latest_version_id: versionId,
      });
    }
    return baseVersion;
  }

  private mediaVersionInput(
    baseVersion: Prisma.ContentItemVersionGetPayload<Record<string, never>>,
    packId: string,
    itemId: string,
    ownerUserId: string,
  ) {
    return {
      contentItemId: itemId,
      contentPackId: packId,
      editedByUserId: ownerUserId,
      newVersionNumber: baseVersion.version + 1,
      channel: baseVersion.channel,
      format: baseVersion.format,
      languageMode: baseVersion.languageMode,
      strategyTrace: baseVersion.strategyTrace,
      captionVariants: baseVersion.captionVariants as never,
      cta: baseVersion.cta,
      hashtags: baseVersion.hashtags as never,
      creativeBrief: baseVersion.creativeBrief,
      altText: baseVersion.altText,
      shortVideoScript: baseVersion.shortVideoScript,
      recommendedPublishWindow: baseVersion.recommendedPublishWindow,
      claimSources: baseVersion.claimSources as never,
      warnings: baseVersion.warnings as never,
      blockers: baseVersion.blockers as never,
      assetRequired: baseVersion.assetRequired,
      assetIds: baseVersion.assetIds as readonly string[],
      versionChecksum: baseVersion.versionChecksum,
    };
  }

  private frozenPlanForItem(
    frozenInput: ContentV2FrozenInput,
    pack: { itemIds: unknown },
    itemId: string,
  ): ContentV2FrozenInput["post_plans"][number] | undefined {
    const ordered = [...frozenInput.post_plans].sort(
      (a, b) => a.position - b.position,
    );
    const itemIndex = Array.isArray(pack.itemIds)
      ? pack.itemIds.map(String).indexOf(itemId)
      : -1;
    if (itemIndex >= 0 && itemIndex < ordered.length) {
      return ordered[itemIndex];
    }
    return frozenInput.post_plans.find(
      (entry) => entry.content_item_id === itemId,
    );
  }

  private async assertItemEditable(
    packId: string,
    itemId: string,
  ): Promise<void> {
    // Approved items have an immutable PublicationCandidateV1 boundary. The
    // review UI hides edit controls for them, and the API repeats the guard so
    // a stale client cannot create a new version that the pack cannot approve.
    const item = await this.packRepository.getItemById(packId, itemId);
    if (item?.status === "approved") {
      throw new ConflictException({
        code: "CONTENT_APPROVAL_BLOCKED",
        message:
          "Approved content is frozen and cannot be edited in this review.",
      });
    }
  }

  private assertPackEditable(pack: { status: string }): void {
    if (pack.status === "approved") {
      throw new ConflictException({
        code: "CONTENT_APPROVAL_BLOCKED",
        message:
          "Approved content is frozen and cannot be edited in this review.",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Aggregates
  // -------------------------------------------------------------------------

  async getCycleWorkspace(
    cycleId: string,
    ownerUserId: string,
  ): Promise<ContentCycleWorkspaceV2> {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    const [
      editorialRow,
      ctaRows,
      mediaRows,
      weekPlanRows,
      packRows,
      weekContextRows,
      candidateRows,
    ] = await Promise.all([
      this.setupRepository.getEditorialProfile(cycleId, ownerUserId),
      this.setupRepository.listCtaEntries(cycleId, ownerUserId),
      this.mediaRepository.listCycleEntries(cycleId, ownerUserId),
      this.weekPlanRepository.listWeekPlans(cycleId, ownerUserId),
      this.prisma.contentPack.findMany({
        where: { contentCycleId: cycleId },
        orderBy: { weekNumber: "asc" },
      }),
      this.prisma.contentWeekContext.findMany({
        where: { contentCycleId: cycleId },
        select: { weekNumber: true, weekStartDate: true },
        orderBy: { weekNumber: "asc" },
      }),
      this.prisma.publicationCandidate.findMany({
        where: { contentCycleId: cycleId },
        select: { contentPackId: true, state: true },
      }),
    ]);

    const strategyVersion = await this.strategyRepository.getVersionByNumber(
      cycle.strategyId,
      cycle.strategyVersion,
    );
    const planData = toPayloadJson(strategyVersion?.planData ?? {});
    const editorialSuggestion = editorialRow
      ? null
      : this.buildFallbackEditorialProfile(
          cycle,
          await this.getPinnedProfileVersion(
            cycle.profileVersionId,
            cycle.businessId,
          ),
          planData,
        );
    const whyThisWeek = this.buildWhyThisWeek(
      planData,
      cycle.currentWeekNumber,
    );

    const summaries = this.buildWeekSummaries(
      packRows,
      weekPlanRows,
      weekContextRows,
      candidateRows,
      cycle.currentWeekNumber,
    );

    const currentWeekPlan = weekPlanRows.find(
      (plan) => plan.weekNumber === cycle.currentWeekNumber,
    );
    const currentPack = packRows.find(
      (pack) => pack.weekNumber === cycle.currentWeekNumber,
    );

    return {
      contract_version: "content-v2",
      cycle: {
        id: cycle.id,
        contract_version: "content-v2",
        business_id: cycle.businessId,
        strategy_id: cycle.strategyId,
        strategy_version: cycle.strategyVersion,
        strategy_decision_id: cycle.strategyDecisionId,
        profile_version_id: cycle.profileVersionId,
        status: cycle.status as "active" | "paused" | "completed",
        current_week_number: cycle.currentWeekNumber,
        next_generation_at: cycle.nextGenerationAt?.toISOString() ?? null,
        timezone: cycle.timezone as "Africa/Cairo",
        pause_reason: cycle.pauseReason,
        completed_at: cycle.completedAt?.toISOString() ?? null,
        created_at: cycle.createdAt.toISOString(),
        updated_at: cycle.updatedAt.toISOString(),
      },
      editorial_profile: editorialRow
        ? toEditorialProfileV2(editorialRow)
        : null,
      editorial_suggestion: editorialSuggestion,
      cta_library: ctaRows.map(toCtaLibraryEntryV2),
      media_library: mediaRows.map(toMediaLibraryEntryV2),
      current_week: {
        week_number: cycle.currentWeekNumber,
        week_start_date:
          weekContextRows
            .find((context) => context.weekNumber === cycle.currentWeekNumber)
            ?.weekStartDate.toISOString()
            .slice(0, 10) ?? "",
        goal: whyThisWeek.focus,
        generation_state: this.generationStateFor(
          currentPack,
          currentWeekPlan,
          candidateRows,
        ),
        week_plan: currentWeekPlan
          ? {
              id: currentWeekPlan.id,
              status: currentWeekPlan.status as "draft" | "frozen",
              post_plans: currentWeekPlan.postPlans
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((plan) => ({
                  id: plan.id,
                  contract_version: "content-v2",
                  content_week_plan_id: plan.contentWeekPlanId,
                  position: plan.position,
                  purpose: plan.purpose,
                  intended_audience: plan.intendedAudience,
                  channel: plan.channel as never,
                  format: plan.format as never,
                  cta_library_entry_id: plan.ctaLibraryEntryId,
                  owner_instructions: plan.ownerInstructions,
                  visual_direction: plan.visualDirection,
                  selected_media_ids: Array.isArray(plan.selectedMediaIds)
                    ? plan.selectedMediaIds.map(String)
                    : [],
                  plan_state: plan.planState as never,
                  source: plan.source as never,
                  content_item_id: plan.contentItemId,
                  created_at: plan.createdAt.toISOString(),
                  updated_at: plan.updatedAt.toISOString(),
                })),
            }
          : null,
        pack: currentPack ? this.toPackV2(currentPack) : null,
        next_generation_at: cycle.nextGenerationAt?.toISOString() ?? null,
        primary_action: this.primaryActionFor(
          cycle,
          currentPack,
          currentWeekPlan,
        ),
      },
      previous_weeks: summaries.previous,
      next_week: summaries.next,
      why_this_week: whyThisWeek,
      strategy: {
        strategy_id: cycle.strategyId,
        strategy_version: cycle.strategyVersion,
        strategy_decision_id: cycle.strategyDecisionId,
        plan_goal: String(planData["goal"]?.["text"] ?? planData["goal"] ?? ""),
        plan_language: String(planData["plan_language"] ?? ""),
      },
      view_full_strategy_route: `/strategy/${cycle.strategyId}/review`,
    };
  }

  async getPackWorkspace(
    packId: string,
    ownerUserId: string,
  ): Promise<ContentPackWorkspaceV2> {
    const pack = await this.getPackOrThrow(packId, ownerUserId);
    const [itemRows, editorialRow, candidate, mediaRows] = await Promise.all([
      this.prisma.contentItem.findMany({
        where: { contentPackId: packId },
        include: {
          versions: {
            orderBy: { version: "asc" },
            include: { assetLinks: { include: { asset: true } } },
          },
          decisions: {
            where: {
              decision: { in: ["approved", "rejected", "revision_requested"] },
            },
            orderBy: { decidedAt: "desc" },
          },
        },
      }),
      this.setupRepository.getEditorialProfile(
        pack.contentCycleId,
        ownerUserId,
      ),
      this.prisma.publicationCandidate.findFirst({
        where: { contentPackId: packId },
        orderBy: { createdAt: "desc" },
      }),
      this.mediaRepository.listCycleEntries(pack.contentCycleId, ownerUserId),
    ]);

    const weekPlan = pack.weekPlanId
      ? await this.prisma.contentWeekPlan.findUnique({
          where: { id: pack.weekPlanId },
          include: { postPlans: true },
        })
      : null;

    return {
      contract_version: "content-v2",
      pack: this.toPackV2(pack),
      week_number: pack.weekNumber,
      week_start_date: pack.weekContext.weekStartDate.toISOString(),
      editorial_profile: editorialRow
        ? toEditorialProfileV2(editorialRow)
        : null,
      media_library: mediaRows.map(toMediaLibraryEntryV2),
      items: itemRows.map((item) => {
        const plan = weekPlan?.postPlans.find(
          (p) => p.contentItemId === item.id,
        );
        const versions = item.versions
          .filter((version) => version.editKind !== null)
          .map(toItemVersionV2);
        const currentDecision = item.decisions.find(
          (decision) => decision.contentItemVersionId === item.currentVersionId,
        );
        const currentVersion =
          item.versions.find(
            (version) => version.id === item.currentVersionId,
          ) ?? item.versions[item.versions.length - 1];
        const linkedAssets = currentVersion?.assetLinks ?? [];
        const assets = linkedAssets.map(({ asset }) => ({
          id: asset.id,
          kind:
            asset.kind === "generated_static"
              ? "generated_static"
              : ("owner_supplied" as "owner_supplied" | "generated_static"),
          status: (asset.status === "generating"
            ? "generating"
            : asset.status === "ready"
              ? "ready"
              : asset.status === "failed"
                ? "failed"
                : "missing") as
            | "generating"
            | "ready"
            | "failed"
            | "missing"
            | "blocked",
          mime_type: asset.mimeType,
          width: asset.width,
          height: asset.height,
          alt_text: asset.altText,
          failure_code: asset.failureCode,
          review_required: asset.kind === "generated_static",
          created_at: asset.createdAt.toISOString(),
        }));
        const assetById = new Map(assets.map((asset) => [asset.id, asset]));
        const hasReadyAsset = currentVersion?.assetIds
          ? (Array.isArray(currentVersion.assetIds)
              ? currentVersion.assetIds.map(String)
              : []
            ).some((assetId) => assetById.get(assetId)?.status === "ready")
          : false;
        const hasGeneratingAsset = assets.some(
          (asset) => asset.status === "generating",
        );
        const hasFailedAsset = assets.some(
          (asset) => asset.status === "failed" || asset.status === "missing",
        );
        const nonMediaBlockers = Array.isArray(currentVersion?.blockers)
          ? currentVersion.blockers.filter(
              (blocker) => blocker !== "CONTENT_ASSET_REQUIRED",
            )
          : [];
        const mediaRequired = currentVersion?.assetRequired === true;
        const approvalState = currentDecision
          ? currentDecision.decision === "approved"
            ? "approved"
            : "blocked"
          : nonMediaBlockers.length > 0
            ? "blocked"
            : !mediaRequired
              ? "ready"
              : hasReadyAsset
                ? "ready"
                : hasGeneratingAsset
                  ? "media_generating"
                  : hasFailedAsset
                    ? "media_failed"
                    : "needs_media";

        return {
          content_item_id: item.id,
          plan: plan
            ? {
                id: plan.id,
                contract_version: "content-v2",
                content_week_plan_id: plan.contentWeekPlanId,
                position: plan.position,
                purpose: plan.purpose,
                intended_audience: plan.intendedAudience,
                channel: plan.channel as never,
                format: plan.format as never,
                cta_library_entry_id: plan.ctaLibraryEntryId,
                owner_instructions: plan.ownerInstructions,
                visual_direction: plan.visualDirection,
                selected_media_ids: Array.isArray(plan.selectedMediaIds)
                  ? plan.selectedMediaIds.map(String)
                  : [],
                plan_state: plan.planState as never,
                source: plan.source as never,
                content_item_id: plan.contentItemId,
                created_at: plan.createdAt.toISOString(),
                updated_at: plan.updatedAt.toISOString(),
              }
            : null,
          current_version: toItemVersionV2(currentVersion),
          versions,
          decision: currentDecision
            ? {
                id: currentDecision.id,
                content_item_id: currentDecision.contentItemId,
                content_item_version_id: currentDecision.contentItemVersionId,
                content_item_version: currentDecision.contentItemVersion,
                content_item_version_checksum:
                  currentDecision.contentItemVersionChecksum,
                decision: currentDecision.decision as never,
                revision_notes: currentDecision.revisionNotes,
                decided_by_user_id: currentDecision.decidedByUserId,
                decided_at: currentDecision.decidedAt.toISOString(),
              }
            : null,
          assets,
          approval_state: approvalState,
        };
      }),
      publication_candidate: candidate
        ? (toPayloadJson(candidate.payload) as never)
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Aggregate helpers
  // -------------------------------------------------------------------------

  private async getPinnedProfileVersion(
    profileVersionId: string,
    businessId: string,
  ) {
    const profileVersion =
      await this.strategyRepository.getProfileVersionById(profileVersionId);
    if (
      !profileVersion ||
      profileVersion.businessId !== businessId ||
      !profileVersion.confirmedAt ||
      !profileVersion.confirmedByUserId
    ) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: "The cycle's confirmed business profile snapshot is missing.",
      });
    }
    return profileVersion;
  }

  private allowedHandoffForWeek(
    planData: Record<string, unknown>,
    weekNumber: number,
  ): { channels: readonly string[]; formats: readonly string[] } {
    const handoff = planData["content_handoff"] as
      | {
          available?: boolean;
          channels?: string[];
          weeks?: Array<{ week_number: number; formats: string[] }>;
        }
      | undefined;
    if (
      handoff?.available !== true ||
      !Array.isArray(handoff.channels) ||
      handoff.channels.length === 0
    ) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: "The approved Strategy has no usable content handoff.",
      });
    }
    const formats = handoff.weeks?.find(
      (week) => week.week_number === weekNumber,
    )?.formats;
    if (!formats || formats.length === 0) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: `The approved Strategy handoff has no formats for week ${weekNumber}.`,
      });
    }
    return { channels: handoff.channels, formats };
  }

  private validatePostPlans(
    postPlans: readonly PostPlanInput[],
    allowedChannels: readonly string[],
    allowedFormats: readonly string[],
    ctaRows: ReadonlyArray<{
      id: string;
      active: boolean;
    }>,
    mediaRows: ReadonlyArray<{
      id: string;
      status: string;
    }>,
  ): void {
    const activeCtaIds = new Set(
      ctaRows.filter((entry) => entry.active).map((entry) => entry.id),
    );
    const readyMediaIds = new Set(
      mediaRows
        .filter((entry) => entry.status === "ready")
        .map((entry) => entry.id),
    );
    for (const plan of postPlans) {
      if (!allowedChannels.includes(plan.channel)) {
        throw new BadRequestException({
          code: "CONTENT_SCHEMA_FAILURE",
          message: `Channel ${plan.channel} is not in the approved Strategy handoff.`,
        });
      }
      if (!allowedFormats.includes(plan.format)) {
        throw new BadRequestException({
          code: "CONTENT_SCHEMA_FAILURE",
          message: `Format ${plan.format} is not approved for this week.`,
        });
      }
      if (plan.ctaLibraryEntryId && !activeCtaIds.has(plan.ctaLibraryEntryId)) {
        throw new BadRequestException({
          code: "CONTENT_SCHEMA_FAILURE",
          message: "A post plan references a missing or inactive CTA.",
        });
      }
      const selectedMediaIds = Array.isArray(plan.selectedMediaIds)
        ? plan.selectedMediaIds
        : [];
      if (selectedMediaIds.some((id) => !readyMediaIds.has(String(id)))) {
        throw new BadRequestException({
          code: "CONTENT_SCHEMA_FAILURE",
          message: "A post plan references missing, revoked, or unready media.",
        });
      }
    }
  }

  private samePostPlanFields(
    previous: {
      purpose: string;
      intendedAudience: string | null;
      channel: string;
      format: string;
      ctaLibraryEntryId: string | null;
      ownerInstructions: string | null;
      visualDirection: string | null;
      selectedMediaIds: Prisma.JsonValue;
    },
    next: PostPlanInput,
  ): boolean {
    const previousMedia = Array.isArray(previous.selectedMediaIds)
      ? previous.selectedMediaIds.map(String)
      : [];
    return (
      previous.purpose === next.purpose &&
      previous.intendedAudience === next.intendedAudience &&
      previous.channel === next.channel &&
      previous.format === next.format &&
      previous.ctaLibraryEntryId === next.ctaLibraryEntryId &&
      previous.ownerInstructions === next.ownerInstructions &&
      previous.visualDirection === next.visualDirection &&
      previousMedia.length === next.selectedMediaIds.length &&
      previousMedia.every((id, index) => id === next.selectedMediaIds[index])
    );
  }

  private buildWhyThisWeek(
    planData: Record<string, unknown>,
    weekNumber: number,
  ): ContentCycleWorkspaceV2["why_this_week"] {
    const fallback: ContentCycleWorkspaceV2["why_this_week"] = {
      focus: "",
      expected_outcome: "",
      measurement_check: "",
      owner_advice: [],
      committed_channels: [],
      formats: [],
    };
    if (planData["contract_version"] !== "strategy-v2") {
      return fallback;
    }
    const calendarWeeks = planData["calendar_weeks"];
    const week =
      Array.isArray(calendarWeeks) &&
      calendarWeeks.find(
        (entry) =>
          (entry as { week_number: number }).week_number === weekNumber,
      );
    const advice = planData["owner_advice"] as {
      weeks?: Array<{ week_number: number; items: Array<{ action: string }> }>;
    } | null;
    const commitments = Array.isArray(planData["channel_commitments"])
      ? (planData["channel_commitments"] as Array<{ channel: string }>)
      : [];
    const handoff = planData["content_handoff"] as {
      available?: boolean;
      channels?: string[];
      weeks?: Array<{ week_number: number; formats: string[] }>;
    } | null;
    const handoffWeek =
      handoff?.available === true && Array.isArray(handoff.weeks)
        ? handoff.weeks.find((entry) => entry.week_number === weekNumber)
        : null;
    return {
      focus: String((week as { focus?: string } | undefined)?.focus ?? ""),
      expected_outcome: String(
        (week as { expected_outcome?: string } | undefined)?.expected_outcome ??
          "",
      ),
      measurement_check: String(
        (week as { measurement_check?: string } | undefined)
          ?.measurement_check ?? "",
      ),
      owner_advice:
        advice?.weeks
          ?.find((entry) => entry.week_number === weekNumber)
          ?.items.map((item) => item.action) ?? [],
      committed_channels:
        commitments.length > 0
          ? commitments.map((commitment) => commitment.channel as never)
          : (handoff?.channels?.map((channel) => channel as never) ?? []),
      formats: handoffWeek?.formats.map((format) => format as never) ?? [],
    };
  }

  private buildWeekSummaries(
    packs: Array<Prisma.ContentPackGetPayload<Record<string, never>>>,
    weekPlans: Array<{
      weekNumber: number;
      id: string;
    }>,
    weekContexts: Array<{ weekNumber: number; weekStartDate: Date }>,
    candidates: Array<{
      contentPackId: string;
      state: string;
    }>,
    currentWeekNumber: number,
  ): {
    previous: ContentCycleWorkspaceV2["previous_weeks"];
    next: ContentCycleWorkspaceV2["next_week"];
  } {
    const summaryFor = (weekNumber: number) => {
      const pack = packs.find((entry) => entry.weekNumber === weekNumber);
      const plan = weekPlans.find((entry) => entry.weekNumber === weekNumber);
      let status:
        | "not_started"
        | "planned"
        | "generating"
        | "failed"
        | "ready"
        | "completed" = "not_started";
      if (pack) {
        if (["queued", "generating", "validating"].includes(pack.status)) {
          status = "generating";
        } else if (pack.status === "failed") {
          status = "failed";
        } else if (
          ["draft", "partially_approved", "approved"].includes(pack.status)
        ) {
          // `completed` describes the owner's review of this week's pack.
          // Candidate availability remains a separate truthful field because
          // a text-only approval cannot cross the frozen asset-bearing
          // PublicationCandidateV1 boundary without fabricated media.
          status = pack.status === "approved" ? "completed" : "ready";
        }
      } else if (plan) {
        status = "planned";
      }
      return {
        week_number: weekNumber,
        week_start_date:
          weekContexts
            .find((context) => context.weekNumber === weekNumber)
            ?.weekStartDate.toISOString()
            .slice(0, 10) ?? "",
        status,
        plan_id: plan?.id ?? null,
        pack_id: pack?.id ?? null,
        publication_candidate_created: candidates.some(
          (candidate) =>
            candidate.contentPackId === pack?.id &&
            candidate.state === "active",
        ),
      };
    };
    const previous = Array.from({ length: currentWeekNumber - 1 }, (_, i) =>
      summaryFor(i + 1),
    );
    const next =
      currentWeekNumber < 12 ? summaryFor(currentWeekNumber + 1) : null;
    return { previous, next };
  }

  private generationStateFor(
    pack: Prisma.ContentPackGetPayload<Record<string, never>> | undefined,
    weekPlan: { status: string } | undefined,
    _candidates: Array<{ contentPackId: string; state: string }>,
  ): ContentCycleWorkspaceV2["current_week"]["generation_state"] {
    if (!pack) {
      return weekPlan ? "planned" : "not_started";
    }
    if (["queued", "generating", "validating"].includes(pack.status)) {
      return pack.status === "queued" ? "queued" : "generating";
    }
    if (pack.status === "failed") {
      return "failed";
    }
    if (pack.status === "approved") {
      return "completed";
    }
    return "ready";
  }

  private primaryActionFor(
    cycle: Prisma.ContentCycleGetPayload<Record<string, never>>,
    pack: Prisma.ContentPackGetPayload<Record<string, never>> | undefined,
    weekPlan: { status: string } | undefined,
  ): ContentCycleWorkspaceV2["current_week"]["primary_action"] {
    // Suggest-first: the editorial profile is an optional refinement, never a
    // precondition. A fresh cycle always surfaces the planner action so the
    // owner gets content suggestions before configuring anything.
    // A ready pack remains reviewable even if the cycle is later paused or
    // completed; the owner must not lose the single path back to review.
    if (
      pack &&
      ["draft", "partially_approved", "approved"].includes(pack.status)
    ) {
      return "review_pack";
    }
    if (cycle.status === "paused" || cycle.status === "completed") {
      return "none";
    }
    if (!pack && !weekPlan) {
      return "plan_week";
    }
    // A draft plan is reviewable and refinable, but the dominant owner
    // action is explicit generation (which freezes the plan snapshot).
    if (weekPlan?.status === "draft") {
      return "generate";
    }
    if (pack?.status === "failed" && pack.retryEligible) {
      return "retry";
    }
    if (["queued", "generating", "validating"].includes(pack?.status ?? "")) {
      return "none";
    }
    return "none";
  }

  /**
   * Deterministic fallback editorial profile used when the owner has not
   * configured one yet. Grounded only in the confirmed business profile and
   * the approved Strategy v2 handoff — never invents brand voice or facts.
   * Not persisted; the workspace keeps `editorial_profile: null` until the
   * owner configures it, so the UI can truthfully show "using defaults".
   */
  private buildFallbackEditorialProfile(
    cycle: Prisma.ContentCycleGetPayload<Record<string, never>>,
    profileVersion: Awaited<
      ReturnType<StrategyRepository["getActiveConfirmedProfileVersion"]>
    > | null,
    planData: Record<string, unknown>,
  ): ContentEditorialProfileV2 {
    const handoff = planData["content_handoff"] as
      | { available: true; language?: string }
      | { available: false }
      | undefined;
    const language =
      (handoff?.available === true && handoff.language) || "ar-EG";
    const profile = profileVersion?.profile as
      | {
          confirmed_facts?: {
            customers?: {
              primary_segments?: string[];
              customer_needs?: string[];
              visit_or_order_occasions?: string[];
            };
          };
        }
      | undefined;
    const customerFacts = profile?.confirmed_facts?.customers;
    const confirmedAudienceFacts = [
      ...(customerFacts?.primary_segments ?? []),
      ...(customerFacts?.customer_needs ?? []),
      ...(customerFacts?.visit_or_order_occasions ?? []),
    ]
      .map((fact) => fact.trim())
      .filter(Boolean);
    const languageLabel =
      language === "ar-EG"
        ? "Egyptian Arabic"
        : language === "en"
          ? "English"
          : "the owner's selected Arabic and English mix";

    return {
      // The fallback is not persisted, but it still crosses the typed API/AI
      // boundary. Keep its identity deterministic while satisfying the UUID
      // contract (a human-readable `default:<cycle>` value would be rejected
      // by the FastAPI Pydantic model before planning starts).
      id: deterministicFallbackEditorialProfileId(cycle.id),
      contract_version: "content-v2",
      content_cycle_id: cycle.id,
      audience_nuance: confirmedAudienceFacts.length
        ? `Confirmed customer facts: ${confirmedAudienceFacts.join("; ")}.`
        : "No additional audience details were confirmed in the business profile.",
      voice: `Use a practical, clear, and trustworthy ${languageLabel} voice. Do not infer facts, offers, locations, or audience details beyond the confirmed profile and approved Strategy handoff.`,
      language: language as ContentEditorialProfileV2["language"],
      writing_guardrails: [],
      default_visual_guidance: null,
      tone_preset: "recommended",
      length_preset: "balanced",
      created_at: cycle.createdAt.toISOString(),
      updated_at: cycle.createdAt.toISOString(),
    };
  }

  private toPackV2(
    pack: Prisma.ContentPackGetPayload<Record<string, never>>,
  ): ContentPackV2 {
    return {
      ...toContentPackV2(pack),
      contract_version: "content-v2" as const,
      week_plan_id: pack.weekPlanId,
    };
  }
}

function deterministicFallbackEditorialProfileId(
  contentCycleId: string,
): string {
  const digest = createHash("sha1")
    .update(`content-editorial-profile:${contentCycleId}`)
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeEditableHashtags(values: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    for (const fragment of value.split(/[\s,،;؛]+/)) {
      for (const token of fragment.split("#")) {
        const trimmed = token.trim();
        if (!trimmed) continue;
        const hashtag = `#${trimmed}`;
        if (!normalized.includes(hashtag)) normalized.push(hashtag);
      }
    }
  }
  return normalized;
}

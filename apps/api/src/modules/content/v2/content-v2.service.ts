import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  ContentClaimSource,
  ContentCycleWorkspaceV2,
  ContentMediaLibraryEntryV2,
  ContentPackV2,
  ContentPackWorkspaceV2,
  ContentWeekPlanV2,
  OwnerContentDirectEditRequest,
} from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { StrategyRepository } from "../../strategy/strategy.repository";
import {
  toContentPack,
  toContentWeekContext,
  toPayload,
} from "../content.service";
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
import {
  toCtaLibraryEntryV2,
  toEditorialProfileV2,
  toItemVersionV2,
  toMediaLibraryEntryV2,
  toWeekPlanV2,
} from "./content-v2-mappers";

export const CONTENT_V2_REQUIRED = "CONTENT_V2_REQUIRED";

export type UploadMediaResult = {
  readonly media: ContentMediaLibraryEntryV2;
  readonly created: boolean;
};

/**
 * Content v2 service (issue #187) — owner-first weekly studio read/write
 * side. Every read re-verifies cycle ownership server-side (404 for
 * cross-owner access). No path schedules or publishes anything; approval
 * keeps flowing through the existing PublicationCandidateV1 boundary.
 */
@Injectable()
export class ContentV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyRepository: StrategyRepository,
    private readonly setupRepository: ContentSetupRepository,
    private readonly mediaRepository: ContentMediaLibraryRepository,
    private readonly mediaValidator: ContentMediaValidator,
    private readonly weekPlanRepository: ContentWeekPlanRepository,
    private readonly versionEditRepository: ContentVersionEditRepository,
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
          "This Content cycle is content-v1 and keeps the legacy experience.",
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
    await this.getCycleOrThrow(cycleId, ownerUserId);
    const row = await this.setupRepository.getEditorialProfile(
      cycleId,
      ownerUserId,
    );
    return { editorial_profile: row ? toEditorialProfileV2(row) : null };
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
    const row = await this.weekPlanRepository.createOrReplaceWeekPlan(
      cycleId,
      weekNumber,
      postPlans,
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
    const baseVersion = await this.prisma.contentItemVersion.findFirst({
      where: { id: dto.base_version_id, contentPackId: packId },
    });
    if (!baseVersion) {
      throw new NotFoundException("Base content item version not found");
    }
    if (baseVersion.versionChecksum !== dto.base_version_checksum) {
      throw new ConflictException({
        code: "CONTENT_VERSION_CONFLICT",
        message: "The base version checksum does not match. Refresh and retry.",
      });
    }
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
      captionVariants: dto.caption_variants,
      cta: dto.cta,
      hashtags: dto.hashtags,
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

  // -------------------------------------------------------------------------
  // Aggregates
  // -------------------------------------------------------------------------

  async getCycleWorkspace(
    cycleId: string,
    ownerUserId: string,
  ): Promise<ContentCycleWorkspaceV2> {
    const cycle = await this.getCycleOrThrow(cycleId, ownerUserId);
    const [editorialRow, ctaRows, mediaRows, weekPlanRows, packRows] =
      await Promise.all([
        this.setupRepository.getEditorialProfile(cycleId, ownerUserId),
        this.setupRepository.listCtaEntries(cycleId, ownerUserId),
        this.mediaRepository.listCycleEntries(cycleId, ownerUserId),
        this.weekPlanRepository.listWeekPlans(cycleId, ownerUserId),
        this.prisma.contentPack.findMany({
          where: { contentCycleId: cycleId },
          orderBy: { weekNumber: "asc" },
        }),
      ]);

    const strategyVersion = await this.strategyRepository.getVersionByNumber(
      cycle.strategyId,
      cycle.strategyVersion,
    );
    const planData = toPayload(strategyVersion?.planData ?? {});
    const whyThisWeek = this.buildWhyThisWeek(
      planData,
      cycle.currentWeekNumber,
    );

    const summaries = this.buildWeekSummaries(
      packRows,
      weekPlanRows,
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
      cta_library: ctaRows.map(toCtaLibraryEntryV2),
      media_library: mediaRows.map(toMediaLibraryEntryV2),
      current_week: {
        week_number: cycle.currentWeekNumber,
        goal: whyThisWeek.focus,
        generation_state: this.generationStateFor(currentPack, currentWeekPlan),
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
          editorialRow,
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
    if (pack.contractVersion !== "content-v2") {
      throw new BadRequestException({
        code: CONTENT_V2_REQUIRED,
        message: "This Content pack is content-v1 and keeps the legacy review.",
      });
    }
    const [itemRows, editorialRow, candidate] = await Promise.all([
      this.prisma.contentItem.findMany({
        where: { contentPackId: packId },
        include: {
          versions: { orderBy: { version: "asc" } },
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
      items: itemRows.map((item) => {
        const plan = weekPlan?.postPlans.find(
          (p) => p.contentItemId === item.id,
        );
        const versions = item.versions
          .filter((version) => version.editKind !== null)
          .map(toItemVersionV2);
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
          current_version: toItemVersionV2(
            item.versions.find(
              (version) => version.id === item.currentVersionId,
            ) ?? item.versions[item.versions.length - 1],
          ),
          versions,
          decision: item.decisions[0]
            ? {
                id: item.decisions[0].id,
                content_item_id: item.decisions[0].contentItemId,
                content_item_version_id: item.decisions[0].contentItemVersionId,
                content_item_version: item.decisions[0].contentItemVersion,
                content_item_version_checksum:
                  item.decisions[0].contentItemVersionChecksum,
                decision: item.decisions[0].decision as never,
                revision_notes: item.decisions[0].revisionNotes,
                decided_by_user_id: item.decisions[0].decidedByUserId,
                decided_at: item.decisions[0].decidedAt.toISOString(),
              }
            : null,
        };
      }),
      publication_candidate: candidate
        ? (toPayload(candidate.payload) as never)
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Aggregate helpers
  // -------------------------------------------------------------------------

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
      committed_channels: commitments.map(
        (commitment) => commitment.channel as never,
      ),
      formats: handoffWeek?.formats.map((format) => format as never) ?? [],
    };
  }

  private buildWeekSummaries(
    packs: Array<Prisma.ContentPackGetPayload<Record<string, never>>>,
    weekPlans: Array<{
      weekNumber: number;
      id: string;
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
        | "ready"
        | "completed" = "not_started";
      if (pack) {
        if (["queued", "generating", "validating"].includes(pack.status)) {
          status = "generating";
        } else if (
          ["draft", "partially_approved", "approved"].includes(pack.status)
        ) {
          status = "ready";
        }
      } else if (plan) {
        status = "planned";
      }
      return {
        week_number: weekNumber,
        week_start_date: "",
        status,
        plan_id: plan?.id ?? null,
        pack_id: pack?.id ?? null,
        publication_candidate_created: false,
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
    return "ready";
  }

  private primaryActionFor(
    cycle: Prisma.ContentCycleGetPayload<Record<string, never>>,
    pack: Prisma.ContentPackGetPayload<Record<string, never>> | undefined,
    weekPlan: { status: string } | undefined,
    editorialRow: unknown,
  ): ContentCycleWorkspaceV2["current_week"]["primary_action"] {
    if (cycle.status === "paused" || cycle.status === "completed") {
      return "none";
    }
    if (!pack && !weekPlan) {
      return "plan_week";
    }
    if (weekPlan?.status === "draft") {
      return "refine_plan";
    }
    if (pack?.status === "failed") {
      return "retry";
    }
    if (["queued", "generating", "validating"].includes(pack?.status ?? "")) {
      return "none";
    }
    if (
      pack &&
      ["draft", "partially_approved", "approved"].includes(pack.status)
    ) {
      return "review_pack";
    }
    return editorialRow ? "generate" : "configure_editorial_profile";
  }

  private toPackV2(
    pack: Prisma.ContentPackGetPayload<Record<string, never>>,
  ): ContentPackV2 {
    return {
      ...toContentPack(pack),
      contract_version: "content-v2" as const,
      week_plan_id: pack.weekPlanId,
    };
  }
}

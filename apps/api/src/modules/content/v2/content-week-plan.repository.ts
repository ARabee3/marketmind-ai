import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import type { ContentV2FrozenInput } from "@marketmind/contracts";
import type {
  ContentPostPlanV2,
  ContentWeekPlanV2,
} from "@marketmind/contracts";

export type PostPlanInput = {
  readonly position: number;
  readonly purpose: string;
  readonly intendedAudience: string | null;
  readonly channel: string;
  readonly format: string;
  readonly ctaLibraryEntryId: string | null;
  readonly ownerInstructions: string | null;
  readonly visualDirection: string | null;
  readonly selectedMediaIds: readonly string[];
  readonly source: "planner" | "owner";
};

/**
 * Week-plan lifecycle persistence (issue #187).
 *
 * A week plan holds exactly 3–5 ordered post plans while `draft`. Once
 * generation claims the week, the plan is frozen with a frozen-input
 * snapshot; plan replacement is rejected after freezing so a run can never
 * observe live owner state mid-flight.
 */
@Injectable()
export class ContentWeekPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCycleOwned(
    tx: Prisma.TransactionClient,
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<void> {
    const cycle = await tx.contentCycle.findFirst({
      where: { id: contentCycleId, ownerUserId },
      select: { id: true },
    });
    if (!cycle) {
      throw new NotFoundException("Content cycle not found");
    }
  }

  async createOrReplaceWeekPlan(
    contentCycleId: string,
    weekNumber: number,
    postPlans: readonly PostPlanInput[],
    ownerUserId: string,
  ): Promise<
    Prisma.ContentWeekPlanGetPayload<{ include: { postPlans: true } }>
  > {
    if (postPlans.length < 3 || postPlans.length > 5) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: "A week plan must contain exactly 3–5 post plans.",
      });
    }
    const positions = postPlans.map((plan) => plan.position);
    if (
      positions.join(",") !==
      "1,2,3,4,5".split(",").slice(0, positions.length).join(",")
    ) {
      throw new BadRequestException({
        code: "CONTENT_SCHEMA_FAILURE",
        message: "Post plans must be ordered 1..N without gaps.",
      });
    }
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      const existing = await tx.contentWeekPlan.findUnique({
        where: { contentCycleId_weekNumber: { contentCycleId, weekNumber } },
        include: { postPlans: true },
      });
      if (existing && existing.status === "frozen") {
        throw new BadRequestException({
          code: "CONTENT_WEEK_ALREADY_CLAIMED",
          message: `Week ${weekNumber} is frozen for generation; the plan cannot be replaced.`,
        });
      }
      if (existing) {
        await tx.contentPostPlan.deleteMany({
          where: { contentWeekPlanId: existing.id },
        });
        await tx.contentWeekPlan.update({
          where: { id: existing.id },
          data: { status: "draft" },
        });
        await tx.contentPostPlan.createMany({
          data: postPlans.map((plan) => ({
            contentWeekPlanId: existing.id,
            position: plan.position,
            purpose: plan.purpose,
            intendedAudience: plan.intendedAudience,
            channel: plan.channel,
            format: plan.format,
            ctaLibraryEntryId: plan.ctaLibraryEntryId,
            ownerInstructions: plan.ownerInstructions,
            visualDirection: plan.visualDirection,
            selectedMediaIds:
              plan.selectedMediaIds as unknown as Prisma.InputJsonValue,
            planState: "planned",
            source: plan.source,
          })),
        });
        return tx.contentWeekPlan.findUniqueOrThrow({
          where: { id: existing.id },
          include: { postPlans: true },
        });
      }
      const created = await tx.contentWeekPlan.create({
        data: {
          contentCycleId,
          weekNumber,
          status: "draft",
        },
      });
      await tx.contentPostPlan.createMany({
        data: postPlans.map((plan) => ({
          contentWeekPlanId: created.id,
          position: plan.position,
          purpose: plan.purpose,
          intendedAudience: plan.intendedAudience,
          channel: plan.channel,
          format: plan.format,
          ctaLibraryEntryId: plan.ctaLibraryEntryId,
          ownerInstructions: plan.ownerInstructions,
          visualDirection: plan.visualDirection,
          selectedMediaIds:
            plan.selectedMediaIds as unknown as Prisma.InputJsonValue,
          planState: "planned",
          source: plan.source,
        })),
      });
      return tx.contentWeekPlan.findUniqueOrThrow({
        where: { id: created.id },
        include: { postPlans: true },
      });
    });
  }

  async getWeekPlan(
    contentCycleId: string,
    weekNumber: number,
    ownerUserId: string,
  ): Promise<Prisma.ContentWeekPlanGetPayload<{
    include: { postPlans: true };
  }> | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentWeekPlan.findUnique({
        where: { contentCycleId_weekNumber: { contentCycleId, weekNumber } },
        include: { postPlans: true },
      });
    });
  }

  async listWeekPlans(
    contentCycleId: string,
    ownerUserId: string,
  ): Promise<
    Prisma.ContentWeekPlanGetPayload<{ include: { postPlans: true } }>[]
  > {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCycleOwned(tx, contentCycleId, ownerUserId);
      return tx.contentWeekPlan.findMany({
        where: { contentCycleId },
        include: { postPlans: true },
        orderBy: { weekNumber: "asc" },
      });
    });
  }

  /**
   * Freezes the week plan with the transactionally frozen input. Called by
   * the generation claim path; fails if the plan is already frozen so
   * duplicate claims resolve to one run.
   */
  async freezeWeekPlan(
    contentCycleId: string,
    weekNumber: number,
    frozenInput: ContentV2FrozenInput,
  ): Promise<{ frozen: boolean }> {
    const result = await this.prisma.contentWeekPlan.updateMany({
      where: {
        contentCycleId,
        weekNumber,
        status: "draft",
      },
      data: {
        status: "frozen",
        frozenInput: frozenInput as unknown as Prisma.InputJsonValue,
      },
    });
    return { frozen: result.count === 1 };
  }

  /**
   * Worker-side attachment: links a generated content item to its post plan
   * after the pack is persisted. Owner-unscoped on purpose (matches the
   * existing worker paths); never expose through an HTTP handler.
   */
  async attachGeneratedItem(
    contentWeekPlanId: string,
    position: number,
    contentItemId: string,
  ): Promise<void> {
    await this.prisma.contentPostPlan.updateMany({
      where: { contentWeekPlanId, position },
      data: { contentItemId, planState: "ready" },
    });
  }

  async markPlansGenerating(contentWeekPlanId: string): Promise<void> {
    await this.prisma.contentPostPlan.updateMany({
      where: {
        contentWeekPlanId,
        planState: { in: ["planned", "generating", "failed"] },
      },
      data: { planState: "generating" },
    });
  }

  async markPlansFailed(contentWeekPlanId: string): Promise<void> {
    await this.prisma.contentPostPlan.updateMany({
      where: {
        contentWeekPlanId,
        planState: { in: ["planned", "generating"] },
      },
      data: { planState: "failed" },
    });
  }

  async assertWeekPlanFrozenFor(weekPlanId: string): Promise<boolean> {
    const plan = await this.prisma.contentWeekPlan.findUnique({
      where: { id: weekPlanId },
      select: { status: true },
    });
    return plan?.status === "frozen";
  }
}

export function weekPlanRowToContract(
  row: Prisma.ContentWeekPlanGetPayload<{ include: { postPlans: true } }>,
): ContentWeekPlanV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    content_cycle_id: row.contentCycleId,
    week_number: row.weekNumber,
    status: row.status as ContentWeekPlanV2["status"],
    post_plans: row.postPlans
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((plan) => toPostPlanContract(plan)),
    frozen_input: row.frozenInput as unknown as ContentV2FrozenInput | null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toPostPlanContract(
  row: Prisma.ContentPostPlanGetPayload<Record<string, never>>,
): ContentPostPlanV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    content_week_plan_id: row.contentWeekPlanId,
    position: row.position,
    purpose: row.purpose,
    intended_audience: row.intendedAudience,
    channel: row.channel as ContentPostPlanV2["channel"],
    format: row.format as ContentPostPlanV2["format"],
    cta_library_entry_id: row.ctaLibraryEntryId,
    owner_instructions: row.ownerInstructions,
    visual_direction: row.visualDirection,
    selected_media_ids: Array.isArray(row.selectedMediaIds)
      ? row.selectedMediaIds.map(String)
      : [],
    plan_state: row.planState as ContentPostPlanV2["plan_state"],
    source: row.source as ContentPostPlanV2["source"],
    content_item_id: row.contentItemId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

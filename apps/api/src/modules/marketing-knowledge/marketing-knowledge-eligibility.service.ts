import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import { KnowledgeFilterDto } from "./dto/knowledge-filter.dto";

/**
 * Canonical definition of "live knowledge": a version whose review_status
 * is `approved`, whose `effective_at` is in the past or now, and whose
 * `expires_at` is null or strictly in the future.
 *
 * Uses `>` (not `>=`) for `expires_at`: a version expiring exactly now is no
 * longer eligible (boundary, see tests). `effective_at <= now()` is eligible.
 *
 * This predicate is the single source of truth for both the NestJS read path
 * and any future FastAPI reader (Option-A) — see
 * MARKETING_KNOWLEDGE_SCHEMA.md.
 */
export function eligibilityPredicate(now: Date = new Date()): Prisma.MarketingKnowledgeEntryVersionWhereInput {
  return {
    reviewStatus: "approved",
    effectiveAt: { lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/**
 * Builds the array-overlap (`&&`-style) filter fragment from a
 * {@link KnowledgeFilterDto}. A supplied array narrows the result to entries
 * whose corresponding array column overlaps the supplied values.
 */
export function filterToWhere(
  filter: KnowledgeFilterDto | undefined,
): Prisma.MarketingKnowledgeEntryVersionWhereInput {
  if (!filter) return {};
  const where: Prisma.MarketingKnowledgeEntryVersionWhereInput = {};
  if (filter.kind) where.kind = filter.kind;
  if (filter.locale) where.locale = filter.locale;
  if (filter.evidenceTier) where.evidenceTier = filter.evidenceTier;
  if (filter.markets?.length) where.markets = { hasSome: filter.markets };
  if (filter.industries?.length) where.industries = { hasSome: filter.industries };
  if (filter.businessModels?.length) where.businessModels = { hasSome: filter.businessModels };
  if (filter.objectives?.length) where.objectives = { hasSome: filter.objectives };
  if (filter.funnelStages?.length) where.funnelStages = { hasSome: filter.funnelStages };
  if (filter.channels?.length) where.channels = { hasSome: filter.channels };
  if (filter.seasons?.length) where.seasons = { hasSome: filter.seasons };
  if (filter.budgetModes?.length) where.budgetModes = { hasSome: filter.budgetModes };
  return where;
}

/**
 * The "only live knowledge" query. Returns approved, currently-effective,
 * non-expired versions, optionally narrowed by taxonomy overlap filters.
 */
@Injectable()
export class MarketingKnowledgeEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async findEligible(filter?: KnowledgeFilterDto) {
    return this.prisma.marketingKnowledgeEntryVersion.findMany({
      where: {
        AND: [eligibilityPredicate(), filterToWhere(filter)],
      },
      include: { entry: true, sources: true },
      orderBy: { effectiveAt: "desc" },
    });
  }

  async countEligible(filter?: KnowledgeFilterDto) {
    return this.prisma.marketingKnowledgeEntryVersion.count({
      where: {
        AND: [eligibilityPredicate(), filterToWhere(filter)],
      },
    });
  }
}
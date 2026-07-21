import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";

/**
 * Repository for {@link MarketingKnowledgeEntry} — the stable identity row for
 * a piece of curated marketing knowledge. Identifies an entry by `slug`
 * and creates it idempotently. The mutable pointer `latestVersion` is a
 * denormalized convenience updated transactionally by the version repository
 * when a new immutable version is inserted; it is never the source of truth
 * for "what's live" — that is always the eligibility query (see
 * MarketingKnowledgeEligibilityService).
 */
@Injectable()
export class MarketingKnowledgeEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string) {
    return this.prisma.marketingKnowledgeEntry.findUnique({
      where: { slug },
      include: { versions: { orderBy: { version: "desc" } } },
    });
  }

  async findById(id: string) {
    return this.prisma.marketingKnowledgeEntry.findUnique({ where: { id } });
  }

  /**
   * Resolve an entry by slug, creating it if missing. Returns the entry row.
   * Idempotent: safe to re-run for the same slug.
   */
  async createIfMissing(slug: string) {
    return this.prisma.marketingKnowledgeEntry.upsert({
      where: { slug },
      create: { slug },
      update: {},
    });
  }
}
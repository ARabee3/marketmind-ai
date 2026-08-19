import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { AuditService } from "../../audit/audit.service";
import { MarketingKnowledgeEntryRepository } from "../marketing-knowledge-entry.repository";
import { MarketingKnowledgeVersionRepository } from "../marketing-knowledge-version.repository";
import { MarketingKnowledgeSourceRepository } from "../marketing-knowledge-source.repository";
import { MarketingKnowledgeIngestionRunRepository } from "../marketing-knowledge-ingestion-run.repository";
import { ListLibraryEntriesQueryDto } from "./dto/list-library-entries-query.dto";

/**
 * Admin-facing operations over the curated knowledge library (issue #252 item
 * 5). Every write here only ever changes the REVIEW STATE of an existing
 * version — it never invents content, never fabricates citations, and never
 * presents simulated data as real.
 *
 * Review workflow, faithful to the governance schema:
 *  - Approve: the current DRAFT version is promoted to an immutable APPROVED
 *    version, recording the reviewer identity and timestamp. Content is copied
 *    verbatim from the draft — the approval adds metadata only.
 *  - Reject: the current DRAFT version is retired ("rejected" has no separate
 *    status in the vocabulary; reject = retire the draft so it is no longer
 *    reviewable or eligible).
 */
@Injectable()
export class KnowledgeLibraryAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entryRepo: MarketingKnowledgeEntryRepository,
    private readonly versionRepo: MarketingKnowledgeVersionRepository,
    private readonly sourceRepo: MarketingKnowledgeSourceRepository,
    private readonly ingestionRunRepo: MarketingKnowledgeIngestionRunRepository,
    private readonly auditService: AuditService,
  ) {}

  async listEntries(query: ListLibraryEntriesQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    const versionsWhere: Prisma.MarketingKnowledgeEntryVersionWhereInput = {};
    if (query.search) {
      versionsWhere.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { summary: { contains: query.search, mode: "insensitive" } },
      ];
    }

    // The corpus is a small curated library (tens of entries), so the full set
    // is fetched and the status filter is applied in memory against each
    // entry's LATEST version. Filtering on a child row's latest-version status
    // directly in SQL would need a lateral join; in-memory is simpler and
    // correct for this bounded dataset. Pagination happens after filtering so
    // `total` and the returned page always agree.
    const entries = await this.prisma.marketingKnowledgeEntry.findMany({
      where: query.search ? { versions: { some: versionsWhere } } : {},
      orderBy: { createdAt: "desc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
          include: { sources: true },
        },
      },
    });

    const items = entries
      .map((entry) => ({
        entry: {
          id: entry.id,
          slug: entry.slug,
          latestVersion: entry.latestVersion,
          createdAt: entry.createdAt,
        },
        latest: entry.versions[0] ?? null,
        versionCount: entry.versions.length,
      }))
      .filter((item) =>
        query.status ? item.latest?.reviewStatus === query.status : true,
      );

    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);

    return { items: paged, total, page, pageSize };
  }

  async getEntry(slug: string) {
    const entry = await this.entryRepo.findBySlug(slug);
    if (!entry) throw new NotFoundException("Knowledge entry not found");

    const now = new Date();
    const versions = entry.versions.map((version) => ({
      ...version,
      eligible: this.isEligible(version, now),
    }));

    return {
      entry: {
        id: entry.id,
        slug: entry.slug,
        latestVersion: entry.latestVersion,
        createdAt: entry.createdAt,
      },
      versions,
    };
  }

  async approveDraft(slug: string, reviewer: { id: string; email: string }) {
    const entry = await this.entryRepo.findBySlug(slug);
    if (!entry) throw new NotFoundException("Knowledge entry not found");

    const draft = await this.prisma.marketingKnowledgeEntryVersion.findFirst({
      where: { entryId: entry.id },
      orderBy: { version: "desc" },
      include: { sources: true },
    });
    if (!draft) {
      throw new NotFoundException("Knowledge entry has no versions to review");
    }
    if (draft.reviewStatus !== "draft") {
      throw new ConflictException(
        `Only a draft version can be approved; current status is "${draft.reviewStatus}"`,
      );
    }

    const created = await this.versionRepo.createNewVersion(
      {
        slug,
        kind: draft.kind,
        title: draft.title,
        summary: draft.summary,
        body: draft.body,
        locale: draft.locale,
        markets: draft.markets,
        industries: draft.industries,
        businessModels: draft.businessModels,
        objectives: draft.objectives,
        funnelStages: draft.funnelStages,
        channels: draft.channels,
        seasons: draft.seasons,
        budgetModes: draft.budgetModes,
        evidenceTier: draft.evidenceTier,
        reviewStatus: "approved",
        effectiveAt: draft.effectiveAt.toISOString(),
        expiresAt: draft.expiresAt?.toISOString(),
        author: draft.author,
        reviewer: reviewer.email,
        reviewedAt: new Date().toISOString(),
        checksum: draft.checksum,
        sources: draft.sources.map((s) => ({ reference: s.reference, note: s.note ?? undefined })),
      },
    );

    await this.auditService.record({
      actorUserId: reviewer.id,
      actorEmail: reviewer.email,
      action: "knowledge.approve",
      targetType: "marketing_knowledge_entry",
      targetId: entry.id,
      afterState: {
        slug,
        version: created.version,
        reviewStatus: created.reviewStatus,
        reviewer: reviewer.email,
      },
    });

    return {
      id: created.id,
      entryId: created.entryId,
      version: created.version,
      reviewStatus: created.reviewStatus,
      createdAt: created.createdAt,
    };
  }

  async rejectDraft(slug: string, reviewer: { id: string; email: string }) {
    const entry = await this.entryRepo.findBySlug(slug);
    if (!entry) throw new NotFoundException("Knowledge entry not found");

    const draft = await this.prisma.marketingKnowledgeEntryVersion.findFirst({
      where: { entryId: entry.id },
      orderBy: { version: "desc" },
    });
    if (!draft) {
      throw new NotFoundException("Knowledge entry has no versions to review");
    }
    if (draft.reviewStatus !== "draft") {
      throw new ConflictException(
        `Only a draft version can be rejected; current status is "${draft.reviewStatus}"`,
      );
    }

    await this.versionRepo.retire(draft.id);

    await this.auditService.record({
      actorUserId: reviewer.id,
      actorEmail: reviewer.email,
      action: "knowledge.reject",
      targetType: "marketing_knowledge_entry",
      targetId: entry.id,
      afterState: {
        slug,
        version: draft.version,
        reviewStatus: "retired",
      },
    });

    return {
      id: draft.id,
      entryId: draft.entryId,
      version: draft.version,
      reviewStatus: "retired",
    };
  }

  async triggerIngestion(actor: { id: string; email: string }) {
    // The ingestion pipeline is the AI-service CLI
    // (`uv run --directory services/ai python -m app.knowledge.ingestion.cli
    // ingest --actor ...`). The API records the run request and returns it; the
    // operator/CI executes the actual validated ingestion from the corpus. This
    // is NOT simulated data — the run row is real and status reflects the
    // lifecycle the pipeline writes (pending → running → succeeded/partial/failed).
    const run = await this.ingestionRunRepo.start({
      actor: actor.email,
      configuration: { triggeredBy: "admin-console", source: "corpus" },
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: "knowledge.ingest",
      targetType: "marketing_knowledge_ingestion_run",
      targetId: run.id,
    });

    return run;
  }

  async listIngestionRuns(page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const [total, items] = await Promise.all([
      this.prisma.marketingKnowledgeIngestionRun.count(),
      this.prisma.marketingKnowledgeIngestionRun.findMany({
        orderBy: { startedAt: "desc" },
        skip: (p - 1) * ps,
        take: ps,
        include: { errors: true },
      }),
    ]);
    return { items, total, page: p, pageSize: ps };
  }

  private isEligible(
    version: {
      reviewStatus: string;
      effectiveAt: Date;
      expiresAt: Date | null;
    },
    now: Date,
  ): boolean {
    return (
      version.reviewStatus === "approved" &&
      version.effectiveAt <= now &&
      (version.expiresAt === null || version.expiresAt > now)
    );
  }
}
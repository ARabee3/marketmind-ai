import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";

/**
 * Repository for {@link MarketingKnowledgeSourceRef} — citations linked to a
 * specific immutable version. Lets benchmark/source citations resolve
 * independently of Qdrant (an acceptance criterion): the knowledge library
 * always carries its evidence in Postgres.
 */
@Injectable()
export class MarketingKnowledgeSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listForVersion(entryVersionId: string) {
    return this.prisma.marketingKnowledgeSourceRef.findMany({
      where: { entryVersionId },
      orderBy: { createdAt: "asc" },
    });
  }

  async add(entryVersionId: string, reference: string, note?: string) {
    return this.prisma.marketingKnowledgeSourceRef.create({
      data: { entryVersionId, reference, note },
    });
  }

  async addMany(
    entryVersionId: string,
    refs: Array<{ reference: string; note?: string }>,
  ) {
    if (refs.length === 0) return;
    await this.prisma.marketingKnowledgeSourceRef.createMany({
      data: refs.map((r) => ({ entryVersionId, reference: r.reference, note: r.note })),
    });
  }
}
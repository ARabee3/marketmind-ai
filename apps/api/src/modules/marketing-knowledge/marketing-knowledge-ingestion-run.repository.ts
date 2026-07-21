import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  INGESTION_RUN_STATUSES,
  IngestionRunStatus,
  assertTaxonomyValue,
} from "./taxonomy";

export type IngestionRunCounts = {
  enteredCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  failedCount?: number;
};

export type StartIngestionInput = {
  actor: string;
  commitSha?: string;
  configuration?: Record<string, unknown>;
};

/**
 * Repository for {@link MarketingKnowledgeIngestionRun} and its errors.
 *
 * Each individual entry-version + its chunks is its own transaction; a whole
 * ingestion run is never wrapped in one all-or-nothing transaction, so a
 * `partial_failure` finish can keep successfully-indexed entries without
 * losing the failed ones' record.
 */
@Injectable()
export class MarketingKnowledgeIngestionRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: StartIngestionInput) {
    return this.prisma.marketingKnowledgeIngestionRun.create({
      data: {
        actor: input.actor,
        commitSha: input.commitSha ?? null,
        configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
        status: "running",
      },
    });
  }

  async recordError(
    runId: string,
    error: { slug?: string; version?: number; errorCode: string; errorMessage: string },
  ) {
    return this.prisma.marketingKnowledgeIngestionError.create({
      data: {
        runId,
        slug: error.slug ?? null,
        version: error.version ?? null,
        errorCode: error.errorCode,
        errorMessage: error.errorMessage,
      },
    });
  }

  async incrementCount(
    runId: string,
    field: keyof IngestionRunCounts,
    by = 1,
  ) {
    const increment = { increment: by };
    const data =
      field === "enteredCount"
        ? { enteredCount: increment }
        : field === "updatedCount"
          ? { updatedCount: increment }
          : field === "skippedCount"
            ? { skippedCount: increment }
            : { failedCount: increment };
    return this.prisma.marketingKnowledgeIngestionRun.update({
      where: { id: runId },
      data,
    });
  }

  async finish(
    runId: string,
    status: IngestionRunStatus,
    counts?: IngestionRunCounts,
  ) {
    assertTaxonomyValue(INGESTION_RUN_STATUSES, status, "ingestion_run.status");
    return this.prisma.marketingKnowledgeIngestionRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        ...(counts?.enteredCount !== undefined ? { enteredCount: counts.enteredCount } : {}),
        ...(counts?.updatedCount !== undefined ? { updatedCount: counts.updatedCount } : {}),
        ...(counts?.skippedCount !== undefined ? { skippedCount: counts.skippedCount } : {}),
        ...(counts?.failedCount !== undefined ? { failedCount: counts.failedCount } : {}),
      },
    });
  }

  async findById(runId: string) {
    return this.prisma.marketingKnowledgeIngestionRun.findUnique({
      where: { id: runId },
      include: { errors: { orderBy: { createdAt: "asc" } } },
    });
  }
}
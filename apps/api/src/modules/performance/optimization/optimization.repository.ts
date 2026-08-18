import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type OptimizationProposal as PrismaOptimizationProposal,
} from "@prisma/client";
import {
  assertValidOptimizationProposalV1,
  type OptimizationFormat,
  type OptimizationProposalV1,
} from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import type { OptimizationSnapshotInput } from "./optimization-analyzer";

export class OptimizationRepositoryError extends Error {
  constructor(
    readonly code:
      | "OPTIMIZATION_SNAPSHOT_CONFLICT"
      | "OPTIMIZATION_PROPOSAL_CONFLICT",
    message: string = code,
  ) {
    super(message);
    this.name = "OptimizationRepositoryError";
  }
}

type SnapshotRow = Prisma.MetricSnapshotGetPayload<{
  include: typeof OPTIMIZATION_SNAPSHOT_INCLUDE;
}>;

const OPTIMIZATION_SNAPSHOT_INCLUDE = {
  candidate: true,
  publishingResult: {
    include: {
      attempt: {
        include: {
          intent: { include: { candidate: true } },
        },
      },
    },
  },
} satisfies Prisma.MetricSnapshotInclude;

export type OptimizationSnapshotLoad = {
  readonly snapshots: readonly OptimizationSnapshotInput[];
  readonly conflict: boolean;
};

export type CreateOptimizationProposalInput = Omit<
  OptimizationProposalV1,
  "proposal_id" | "created_at"
> & {
  readonly proposal_id?: string;
  readonly created_at?: string;
};

@Injectable()
export class OptimizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listEligibleSnapshots(
    businessId: string,
  ): Promise<OptimizationSnapshotLoad> {
    const rows = await this.prisma.metricSnapshot.findMany({
      where: {
        businessId,
        provider: "facebook",
        window: "7d",
        observedAt: { not: null },
        candidate: {
          businessId,
          channel: "facebook",
          format: { in: ["text_post", "static_image_post"] },
        },
        publishingResult: {
          outcome: "PUBLISHED",
          provider: "meta",
          remotePublicationId: { not: null },
          attempt: {
            intent: {
              mode: "REAL",
              candidate: { businessId, channel: "facebook" },
            },
          },
        },
      },
      include: OPTIMIZATION_SNAPSHOT_INCLUDE,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    });

    let conflict = false;
    const snapshots = rows.flatMap((row) => {
      const normalized = normalizeSnapshotRow(row);
      if (!normalized) {
        conflict = true;
        return [];
      }
      return [normalized];
    });
    return { snapshots, conflict };
  }

  async findByFingerprint(
    businessId: string,
    generationFingerprint: string,
  ): Promise<OptimizationProposalV1 | null> {
    const row = await this.prisma.optimizationProposal.findUnique({
      where: {
        businessId_generationFingerprint: {
          businessId,
          generationFingerprint,
        },
      },
    });
    return row ? toProposalContract(row) : null;
  }

  async listProposals(
    businessId: string,
  ): Promise<readonly OptimizationProposalV1[]> {
    const rows = await this.prisma.optimizationProposal.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toProposalContract);
  }

  async findById(
    businessId: string,
    proposalId: string,
  ): Promise<OptimizationProposalV1 | null> {
    const row = await this.prisma.optimizationProposal.findFirst({
      where: { id: proposalId, businessId },
    });
    return row ? toProposalContract(row) : null;
  }

  async createProposal(
    proposal: CreateOptimizationProposalInput,
  ): Promise<OptimizationProposalV1> {
    const value: OptimizationProposalV1 = {
      ...proposal,
      proposal_id: proposal.proposal_id ?? randomUUID(),
      created_at: proposal.created_at ?? new Date().toISOString(),
    };
    assertValidOptimizationProposalV1(value);
    try {
      const row = await this.prisma.optimizationProposal.create({
        data: {
          id: value.proposal_id,
          contractVersion: value.contract_version,
          businessId: value.business_id,
          strategyId: value.strategy_id,
          strategyVersion: value.strategy_version,
          contentCycleId: value.content_cycle_id,
          formatCohort: value.format_cohort,
          basisSnapshotIds: value.basis_snapshot_ids as Prisma.InputJsonValue,
          evidenceChecksum: value.evidence_checksum,
          deterministicComparison:
            value.deterministic_comparison as Prisma.InputJsonValue,
          changeKind: value.change_kind,
          summary: value.summary,
          rationale: value.rationale,
          uncertainty: value.uncertainty,
          instruction: value.instruction,
          modelVersion: value.model_version,
          promptVersion: value.prompt_version,
          generationFingerprint: value.generation_fingerprint,
          status: value.status,
          createdAt: new Date(value.created_at),
        },
      });
      return toProposalContract(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findByFingerprint(
          value.business_id,
          value.generation_fingerprint,
        );
        if (existing && sameProposalGeneration(existing, value))
          return existing;
        throw new OptimizationRepositoryError(
          "OPTIMIZATION_PROPOSAL_CONFLICT",
          "optimization proposal generation identity already exists with different evidence",
        );
      }
      throw error;
    }
  }
}

function normalizeSnapshotRow(
  row: SnapshotRow,
): OptimizationSnapshotInput | null {
  const payload = asRecord(row.candidate.payload);
  const publishingCandidate = row.publishingResult.attempt.intent.candidate;
  if (!payload || !publishingCandidate) return null;
  if (
    row.publishingResult.id !== row.publishingResultId ||
    row.publishingResult.attempt.id !== row.publishingAttemptId ||
    row.publishingResult.attempt.intent.id !== row.publishingIntentId ||
    publishingCandidate.id !== row.candidateId ||
    publishingCandidate.businessId !== row.businessId ||
    publishingCandidate.candidateChecksum !== row.candidateChecksum ||
    publishingCandidate.channel !== "facebook" ||
    publishingCandidate.format !== row.candidate.format ||
    payload.candidate_id !== row.candidateId ||
    payload.candidate_checksum !== row.candidateChecksum ||
    payload.business_id !== row.businessId ||
    payload.content_format !== row.candidate.format ||
    payload.target_channel !== "facebook"
  ) {
    return null;
  }
  const strategyId = payload.strategy_id;
  const strategyVersion = payload.strategy_version;
  const contentCycleId = payload.content_cycle_id;
  const caption = payload.caption;
  const cta = payload.cta;
  if (
    typeof strategyId !== "string" ||
    typeof strategyVersion !== "number" ||
    !Number.isInteger(strategyVersion) ||
    strategyVersion < 1 ||
    typeof contentCycleId !== "string" ||
    typeof caption !== "string" ||
    caption.trim().length === 0 ||
    (cta !== null && cta !== undefined && typeof cta !== "string")
  ) {
    return null;
  }
  const metrics = asRecord(row.metrics);
  const postMediaView = asRecord(metrics?.post_media_view);
  const postClicks = asRecord(metrics?.post_clicks);
  if (!postMediaView || !postClicks) return null;
  const normalizedMetrics = {
    post_media_view: normalizeMetricValue(postMediaView),
    post_clicks: normalizeMetricValue(postClicks),
  };
  if (!normalizedMetrics.post_media_view || !normalizedMetrics.post_clicks)
    return null;
  return {
    snapshot_id: row.id,
    business_id: row.businessId,
    publishing_result_id: row.publishingResultId,
    candidate_id: row.candidateId,
    candidate_checksum: row.candidateChecksum,
    strategy_id: strategyId,
    strategy_version: strategyVersion,
    content_cycle_id: contentCycleId,
    content_format: row.candidate.format as OptimizationFormat,
    provider: "facebook",
    window: "7d",
    published_at: row.publishedAt.toISOString(),
    observed_at: row.observedAt?.toISOString() ?? null,
    metrics: normalizedMetrics,
    caption,
    cta: typeof cta === "string" ? cta : null,
  };
}

function normalizeMetricValue(value: Record<string, unknown>):
  | { status: "available"; value: number }
  | {
      status: "unavailable";
      reason:
        | "not_returned"
        | "unsupported"
        | "permission_denied"
        | "provider_error"
        | "invalid_value"
        | "not_yet_observed";
    }
  | null {
  if (
    value.status === "available" &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    value.value >= 0
  ) {
    return { status: "available", value: value.value };
  }
  const reasons = [
    "not_returned",
    "unsupported",
    "permission_denied",
    "provider_error",
    "invalid_value",
    "not_yet_observed",
  ] as const;
  return value.status === "unavailable" &&
    reasons.includes(value.reason as (typeof reasons)[number])
    ? {
        status: "unavailable",
        reason: value.reason as (typeof reasons)[number],
      }
    : null;
}

function toProposalContract(
  row: PrismaOptimizationProposal,
): OptimizationProposalV1 {
  const proposal = {
    contract_version: row.contractVersion,
    proposal_id: row.id,
    business_id: row.businessId,
    strategy_id: row.strategyId,
    strategy_version: row.strategyVersion,
    content_cycle_id: row.contentCycleId,
    format_cohort: row.formatCohort,
    basis_snapshot_ids: row.basisSnapshotIds,
    evidence_checksum: row.evidenceChecksum,
    deterministic_comparison: row.deterministicComparison,
    change_kind: row.changeKind,
    summary: row.summary,
    rationale: row.rationale,
    uncertainty: row.uncertainty,
    instruction: row.instruction,
    model_version: row.modelVersion,
    prompt_version: row.promptVersion,
    generation_fingerprint: row.generationFingerprint,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  } as unknown as OptimizationProposalV1;
  assertValidOptimizationProposalV1(proposal);
  return proposal;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function sameProposalGeneration(
  left: OptimizationProposalV1,
  right: OptimizationProposalV1,
): boolean {
  const comparable = (value: OptimizationProposalV1) => {
    const {
      proposal_id: _proposalId,
      created_at: _createdAt,
      ...identity
    } = value;
    return JSON.stringify(identity);
  };
  return comparable(left) === comparable(right);
}

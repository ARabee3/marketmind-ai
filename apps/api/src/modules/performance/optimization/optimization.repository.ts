import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type ApprovedOptimizationInstruction as PrismaApprovedOptimizationInstruction,
  type OptimizationDecision as PrismaOptimizationDecision,
  type OptimizationProposal as PrismaOptimizationProposal,
} from "@prisma/client";
import {
  assertValidApprovedOptimizationInstructionV1,
  assertValidOptimizationDecisionV1,
  assertValidOptimizationProposalV1,
  assertValidOptimizationProposalWorkspaceV1,
  type ApprovedOptimizationInstructionV1,
  type OptimizationDecisionAction,
  type OptimizationDecisionV1,
  type OptimizationFormat,
  type OptimizationProposalV1,
  type OptimizationProposalWorkspaceV1,
} from "@marketmind/contracts";
import { PrismaService } from "../../../common/persistence/prisma.service";
import type { OptimizationSnapshotInput } from "./optimization-analyzer";

export class OptimizationRepositoryError extends Error {
  constructor(
    readonly code:
      | "OPTIMIZATION_SNAPSHOT_CONFLICT"
      | "OPTIMIZATION_PROPOSAL_CONFLICT"
      | "OPTIMIZATION_DECISION_CONFLICT"
      | "OPTIMIZATION_EVIDENCE_CONFLICT"
      | "OPTIMIZATION_INSTRUCTION_CONFLICT",
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

export type CreateOptimizationDecisionInput = {
  readonly owner_user_id: string;
  readonly business_id: string;
  readonly proposal_id: string;
  readonly evidence_checksum: string;
  readonly action: OptimizationDecisionAction;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly note: string | null;
};

export type PendingOptimizationInstruction = ApprovedOptimizationInstructionV1;

const OPTIMIZATION_WORKSPACE_INCLUDE = {
  decisions: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  approvedInstruction: true,
} satisfies Prisma.OptimizationProposalInclude;

type OptimizationWorkspaceRow = Prisma.OptimizationProposalGetPayload<{
  include: typeof OPTIMIZATION_WORKSPACE_INCLUDE;
}>;

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

  async listProposalWorkspaces(
    businessId: string,
  ): Promise<readonly OptimizationProposalWorkspaceV1[]> {
    const rows = await this.prisma.optimizationProposal.findMany({
      where: { businessId },
      include: OPTIMIZATION_WORKSPACE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toWorkspaceContract);
  }

  async findProposalWorkspace(
    businessId: string,
    proposalId: string,
  ): Promise<OptimizationProposalWorkspaceV1 | null> {
    const row = await this.prisma.optimizationProposal.findFirst({
      where: { id: proposalId, businessId },
      include: OPTIMIZATION_WORKSPACE_INCLUDE,
    });
    return row ? toWorkspaceContract(row) : null;
  }

  /**
   * Records one terminal owner decision and, for approval, creates the one
   * immutable instruction in the same transaction. Proposal identity is read
   * from the database; the caller cannot select a different business, cycle,
   * Strategy version, or evidence set through this boundary.
   */
  async createDecision(
    input: CreateOptimizationDecisionInput,
  ): Promise<OptimizationProposalWorkspaceV1> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingByKey = await tx.optimizationDecision.findUnique({
          where: {
            ownerUserId_idempotencyKey: {
              ownerUserId: input.owner_user_id,
              idempotencyKey: input.idempotency_key,
            },
          },
        });
        if (existingByKey) {
          if (
            existingByKey.requestFingerprint !== input.request_fingerprint ||
            existingByKey.proposalId !== input.proposal_id
          ) {
            throw new OptimizationRepositoryError(
              "OPTIMIZATION_DECISION_CONFLICT",
              "idempotency key was already used for a different optimization decision",
            );
          }
          return loadWorkspaceWithin(tx, input.business_id, input.proposal_id);
        }

        const existingByFingerprint = await tx.optimizationDecision.findUnique({
          where: {
            ownerUserId_requestFingerprint: {
              ownerUserId: input.owner_user_id,
              requestFingerprint: input.request_fingerprint,
            },
          },
        });
        if (existingByFingerprint) {
          if (existingByFingerprint.proposalId !== input.proposal_id) {
            throw new OptimizationRepositoryError(
              "OPTIMIZATION_DECISION_CONFLICT",
              "request fingerprint was already used for a different proposal",
            );
          }
          return loadWorkspaceWithin(tx, input.business_id, input.proposal_id);
        }

        await tx.$queryRaw`
          SELECT "id"
          FROM "optimization_proposals"
          WHERE "id" = ${input.proposal_id}::uuid
            AND "business_id" = ${input.business_id}::uuid
          FOR UPDATE
        `;
        const proposal = await tx.optimizationProposal.findFirst({
          where: {
            id: input.proposal_id,
            businessId: input.business_id,
          },
        });
        if (!proposal) {
          throw new OptimizationRepositoryError(
            "OPTIMIZATION_DECISION_CONFLICT",
            "optimization proposal is not owned by this business",
          );
        }
        if (proposal.evidenceChecksum !== input.evidence_checksum) {
          throw new OptimizationRepositoryError(
            "OPTIMIZATION_EVIDENCE_CONFLICT",
            "the decision evidence checksum does not match the immutable proposal",
          );
        }

        const existingForProposal = await tx.optimizationDecision.findUnique({
          where: { proposalId: input.proposal_id },
        });
        if (existingForProposal) {
          if (
            existingForProposal.ownerUserId === input.owner_user_id &&
            existingForProposal.requestFingerprint === input.request_fingerprint
          ) {
            return loadWorkspaceWithin(
              tx,
              input.business_id,
              input.proposal_id,
            );
          }
          throw new OptimizationRepositoryError(
            "OPTIMIZATION_DECISION_CONFLICT",
            "an optimization proposal already has a different terminal decision",
          );
        }

        const decisionId = randomUUID();
        const decidedAt = new Date();
        await tx.optimizationDecision.create({
          data: {
            id: decisionId,
            contractVersion: "optimization-decision-v1",
            proposalId: proposal.id,
            businessId: proposal.businessId,
            strategyId: proposal.strategyId,
            strategyVersion: proposal.strategyVersion,
            contentCycleId: proposal.contentCycleId,
            formatCohort: proposal.formatCohort,
            evidenceChecksum: proposal.evidenceChecksum,
            action: input.action,
            ownerUserId: input.owner_user_id,
            idempotencyKey: input.idempotency_key,
            requestFingerprint: input.request_fingerprint,
            note: input.note,
            decidedAt,
          },
        });
        if (input.action === "approve") {
          await tx.approvedOptimizationInstruction.create({
            data: {
              id: randomUUID(),
              contractVersion: "optimization-instruction-v1",
              proposalId: proposal.id,
              approvedDecisionId: decisionId,
              businessId: proposal.businessId,
              strategyId: proposal.strategyId,
              strategyVersion: proposal.strategyVersion,
              contentCycleId: proposal.contentCycleId,
              formatCohort: proposal.formatCohort,
              evidenceChecksum: proposal.evidenceChecksum,
              changeKind: proposal.changeKind,
              instruction: proposal.instruction,
              status: "PENDING_CONSUMPTION",
              approvedAt: decidedAt,
            },
          });
        }
        return loadWorkspaceWithin(tx, input.business_id, input.proposal_id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new OptimizationRepositoryError(
          "OPTIMIZATION_DECISION_CONFLICT",
          "the optimization proposal already has a terminal decision",
        );
      }
      throw error;
    }
  }

  async findPendingInstruction(input: {
    readonly businessId: string;
    readonly contentCycleId: string;
    readonly strategyId: string;
    readonly strategyVersion: number;
    readonly formatCohorts: readonly OptimizationFormat[];
  }): Promise<PendingOptimizationInstruction | null> {
    if (input.formatCohorts.length === 0) return null;
    const row = await this.prisma.approvedOptimizationInstruction.findFirst({
      where: {
        businessId: input.businessId,
        contentCycleId: input.contentCycleId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        status: "PENDING_CONSUMPTION",
        formatCohort: { in: [...input.formatCohorts] },
      },
      orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
    });
    return row ? toInstructionContract(row) : null;
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

function toDecisionContract(
  row: PrismaOptimizationDecision,
): OptimizationDecisionV1 {
  const decision = {
    contract_version: row.contractVersion,
    decision_id: row.id,
    proposal_id: row.proposalId,
    business_id: row.businessId,
    strategy_id: row.strategyId,
    strategy_version: row.strategyVersion,
    content_cycle_id: row.contentCycleId,
    format_cohort: row.formatCohort,
    evidence_checksum: row.evidenceChecksum,
    action: row.action,
    owner_user_id: row.ownerUserId,
    request_fingerprint: row.requestFingerprint,
    note: row.note,
    decided_at: row.decidedAt.toISOString(),
  } as unknown as OptimizationDecisionV1;
  assertValidOptimizationDecisionV1(decision);
  return decision;
}

function toInstructionContract(
  row: PrismaApprovedOptimizationInstruction,
): ApprovedOptimizationInstructionV1 {
  const instruction = {
    contract_version: row.contractVersion,
    instruction_id: row.id,
    proposal_id: row.proposalId,
    approved_decision_id: row.approvedDecisionId,
    business_id: row.businessId,
    strategy_id: row.strategyId,
    strategy_version: row.strategyVersion,
    content_cycle_id: row.contentCycleId,
    format_cohort: row.formatCohort,
    evidence_checksum: row.evidenceChecksum,
    change_kind: row.changeKind,
    instruction: row.instruction,
    status: row.status,
    consumed_content_pack_id: row.consumedContentPackId,
    consumed_week_plan_id: row.consumedWeekPlanId,
    approved_at: row.approvedAt.toISOString(),
    consumed_at: row.consumedAt?.toISOString() ?? null,
    superseded_at: row.supersededAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  } as unknown as ApprovedOptimizationInstructionV1;
  assertValidApprovedOptimizationInstructionV1(instruction);
  return instruction;
}

function toWorkspaceContract(
  row: OptimizationWorkspaceRow,
): OptimizationProposalWorkspaceV1 {
  const proposal = toProposalContract(row);
  const decision = row.decisions[0]
    ? toDecisionContract(row.decisions[0])
    : null;
  const instruction = row.approvedInstruction
    ? toInstructionContract(row.approvedInstruction)
    : null;
  let state: OptimizationProposalWorkspaceV1["state"] =
    "PENDING_OWNER_DECISION";
  if (decision?.action === "dismiss") state = "DISMISSED";
  else if (instruction?.status === "PENDING_CONSUMPTION")
    state = "APPROVED_PENDING_CONSUMPTION";
  else if (instruction?.status === "CONSUMED") state = "CONSUMED";
  else if (instruction?.status === "SUPERSEDED") state = "SUPERSEDED";
  else if (instruction?.status === "EXPIRED") state = "EXPIRED";

  const workspace = {
    contract_version: "optimization-v1",
    proposal,
    state,
    decision,
    instruction,
  } as OptimizationProposalWorkspaceV1;
  assertValidOptimizationProposalWorkspaceV1(workspace);
  return workspace;
}

async function loadWorkspaceWithin(
  tx: Prisma.TransactionClient,
  businessId: string,
  proposalId: string,
): Promise<OptimizationProposalWorkspaceV1> {
  const row = await tx.optimizationProposal.findFirst({
    where: { id: proposalId, businessId },
    include: OPTIMIZATION_WORKSPACE_INCLUDE,
  });
  if (!row) {
    throw new OptimizationRepositoryError(
      "OPTIMIZATION_DECISION_CONFLICT",
      "optimization proposal disappeared while recording the decision",
    );
  }
  return toWorkspaceContract(row);
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

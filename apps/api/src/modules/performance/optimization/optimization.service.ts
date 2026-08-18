import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  computeOptimizationGenerationFingerprint,
  OPTIMIZATION_CHANGE_KINDS,
  OPTIMIZATION_PROHIBITED_CHANGES,
  OPTIMIZATION_REQUIRED_METRICS,
  OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT,
  type OptimizationFormat,
  type OptimizationGenerationRequestV1,
  type OptimizationProposalV1,
  type OptimizationReadinessV1,
} from "@marketmind/contracts";
import { ProviderError } from "../../../common/errors/provider-error";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { analyzeOptimizationSnapshots } from "./optimization-analyzer";
import {
  OptimizationRepository,
  OptimizationRepositoryError,
} from "./optimization.repository";
import { OptimizationAiClient } from "./optimization-ai.client";
import type { GenerateOptimizationProposalDto } from "./dto/generate-optimization-proposal.dto";

export type OptimizationReadinessResponse = {
  readonly readiness: OptimizationReadinessV1;
};

export type OptimizationGenerationResponse =
  | (OptimizationReadinessResponse & {
      readonly outcome: "not_ready";
    })
  | (OptimizationReadinessResponse & {
      readonly outcome: "no_recommendation";
      readonly generation_fingerprint: string;
      readonly reason: string;
    })
  | (OptimizationReadinessResponse & {
      readonly outcome: "proposal";
      readonly proposal: OptimizationProposalV1;
    });

@Injectable()
export class OptimizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: OptimizationRepository,
    private readonly ai: OptimizationAiClient,
  ) {}

  async readiness(
    ownerUserId: string,
    requestedFormat?: OptimizationFormat,
  ): Promise<OptimizationReadinessResponse> {
    const businessId = await this.businessIdForOwner(ownerUserId);
    const loaded = await this.repository.listEligibleSnapshots(businessId);
    if (loaded.conflict) {
      return {
        readiness: conflictReadiness(businessId, requestedFormat),
      };
    }
    return {
      readiness: analyzeOptimizationSnapshots({
        business_id: businessId,
        snapshots: loaded.snapshots,
        requested_format: requestedFormat,
      }).readiness,
    };
  }

  async generate(
    ownerUserId: string,
    dto: GenerateOptimizationProposalDto,
  ): Promise<OptimizationGenerationResponse> {
    const businessId = await this.businessIdForOwner(ownerUserId);
    const loaded = await this.repository.listEligibleSnapshots(businessId);
    if (loaded.conflict) {
      return {
        outcome: "not_ready",
        readiness: conflictReadiness(businessId, dto.format),
      };
    }
    const analysis = analyzeOptimizationSnapshots({
      business_id: businessId,
      snapshots: loaded.snapshots,
      requested_format: dto.format,
    });
    if (
      analysis.readiness.status !== "ready" ||
      !analysis.identity ||
      !analysis.evidence_checksum
    ) {
      return { outcome: "not_ready", readiness: analysis.readiness };
    }

    const evidence = analysis.evidence.map((item) => ({
      snapshot_id: item.snapshot_id,
      candidate_id: item.candidate_id,
      content_format: item.content_format,
      published_at: item.published_at,
      metrics: item.metrics,
      untrusted_caption: item.caption,
      untrusted_cta: item.cta,
    }));
    const withoutFingerprint: Omit<
      OptimizationGenerationRequestV1,
      "generation_fingerprint"
    > = {
      contract_version: "optimization-v1",
      identity: analysis.identity,
      evidence_checksum: analysis.evidence_checksum,
      evidence,
      deterministic_comparison: analysis.comparisons,
      allowed_change_kinds: OPTIMIZATION_CHANGE_KINDS,
      prohibited_changes: OPTIMIZATION_PROHIBITED_CHANGES,
    };
    const generationFingerprint =
      computeOptimizationGenerationFingerprint(withoutFingerprint);
    const existing = await this.repository.findByFingerprint(
      businessId,
      generationFingerprint,
    );
    if (existing) {
      return {
        outcome: "proposal",
        readiness: analysis.readiness,
        proposal: existing,
      };
    }

    let result: Awaited<ReturnType<OptimizationAiClient["generate"]>>;
    try {
      result = await this.ai.generate({
        ...withoutFingerprint,
        generation_fingerprint: generationFingerprint,
      });
    } catch (error) {
      this.throwRepositoryError(error);
    }
    if (result.generation_fingerprint !== generationFingerprint) {
      throw new ConflictException({
        code: "OPTIMIZATION_IDENTITY_CONFLICT",
        message: "The recommendation did not preserve the generation identity.",
      });
    }
    if (result.outcome === "no_recommendation") {
      return {
        outcome: "no_recommendation",
        readiness: analysis.readiness,
        generation_fingerprint: generationFingerprint,
        reason: result.reason,
      };
    }

    const expectedSnapshotIds = analysis.evidence
      .map((item) => item.snapshot_id)
      .sort();
    const returnedSnapshotIds = [...result.evidence_snapshot_ids].sort();
    if (
      expectedSnapshotIds.length !== returnedSnapshotIds.length ||
      expectedSnapshotIds.some((id, index) => id !== returnedSnapshotIds[index])
    ) {
      throw new ConflictException({
        code: "OPTIMIZATION_PROPOSAL_CONFLICT",
        message:
          "The recommendation did not preserve the deterministic evidence identity.",
      });
    }
    if (!OPTIMIZATION_CHANGE_KINDS.includes(result.change_kind)) {
      throw new ConflictException({
        code: "OPTIMIZATION_PROPOSAL_CONFLICT",
        message: "The recommendation requested an unsupported change kind.",
      });
    }

    try {
      const proposal = await this.repository.createProposal({
        contract_version: "optimization-v1",
        business_id: businessId,
        strategy_id: analysis.identity.strategy_id,
        strategy_version: analysis.identity.strategy_version,
        content_cycle_id: analysis.identity.content_cycle_id,
        format_cohort: analysis.identity.format_cohort,
        basis_snapshot_ids: analysis.evidence.map((item) => item.snapshot_id),
        evidence_checksum: analysis.evidence_checksum,
        deterministic_comparison: analysis.comparisons,
        change_kind: result.change_kind,
        summary: result.summary,
        rationale: result.rationale,
        uncertainty: result.uncertainty,
        instruction: result.instruction,
        model_version: result.model_version,
        prompt_version: result.prompt_version,
        generation_fingerprint: generationFingerprint,
        status: "PENDING_OWNER_DECISION",
      });
      return { outcome: "proposal", readiness: analysis.readiness, proposal };
    } catch (error) {
      this.throwRepositoryError(error);
    }
  }

  async list(ownerUserId: string): Promise<readonly OptimizationProposalV1[]> {
    return this.repository.listProposals(
      await this.businessIdForOwner(ownerUserId),
    );
  }

  async get(
    ownerUserId: string,
    proposalId: string,
  ): Promise<OptimizationProposalV1> {
    const proposal = await this.repository.findById(
      await this.businessIdForOwner(ownerUserId),
      proposalId,
    );
    if (!proposal)
      throw new NotFoundException({
        code: "OPTIMIZATION_PROPOSAL_NOT_FOUND",
        message: "Optimization proposal was not found.",
      });
    return proposal;
  }

  private async businessIdForOwner(ownerUserId: string): Promise<string> {
    const business = await this.prisma.business.findFirst({
      where: { ownerUserId },
      select: { id: true },
    });
    if (!business) {
      throw new ForbiddenException({
        code: "PUBLISHING_FORBIDDEN_NO_BUSINESS",
        message:
          "A business profile is required for optimization recommendations.",
      });
    }
    return business.id;
  }

  private throwRepositoryError(error: unknown): never {
    if (error instanceof OptimizationRepositoryError) {
      if (error.code === "OPTIMIZATION_PROPOSAL_CONFLICT") {
        throw new ConflictException({
          code: error.code,
          message:
            "The optimization proposal already exists with different evidence.",
        });
      }
      throw new ConflictException({
        code: error.code,
        message: "Optimization evidence provenance is conflicting.",
      });
    }
    if (error instanceof ProviderError) {
      if (error.retryable) {
        throw new ServiceUnavailableException({
          code: error.code,
          message: "The optimization provider is temporarily unavailable.",
        });
      }
      throw new BadRequestException({
        code: error.code,
        message: error.message,
      });
    }
    throw new InternalServerErrorException({
      code: "OPTIMIZATION_PROVIDER_FAILURE",
      message: "The optimization recommendation could not be generated.",
    });
  }
}

function conflictReadiness(
  businessId: string,
  format: OptimizationFormat | undefined,
): OptimizationReadinessV1 {
  return {
    contract_version: "optimization-v1",
    status: "insufficient_evidence",
    business_id: businessId,
    format_cohort: format ?? null,
    eligible_post_count: 0,
    required_post_count: OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT,
    required_metrics: OPTIMIZATION_REQUIRED_METRICS,
    available_formats: [],
    reason: "snapshot_provenance_conflict",
  };
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  computePublishingSha256,
  isOrchestrationStatus,
  transitionOrchestrationRun,
} from "@marketmind/contracts";
import type {
  CampaignOrchestrationStartV1,
  OrchestrationStatus,
} from "@marketmind/contracts";
import { OrchestrationRepository } from "./orchestration.repository";
import type { CreateOrchestrationRunInput } from "./orchestration.repository";

const INITIAL_BOUNDS = {
  tool_calls_used: 0,
  tool_calls_limit: 0,
  replans_used: 0,
  replans_limit: 0,
  token_budget: null,
  cost_budget_usd: null,
  deadline_at: null,
} as const;

@Injectable()
export class OrchestrationService {
  constructor(
    private readonly repository: OrchestrationRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Phase 1 only creates a durable queued envelope. No existing domain job is
   * routed here until a later shadow-mode gate explicitly enables it.
   */
  async startRun(
    input: CampaignOrchestrationStartV1,
    authorizedOwnerUserId: string,
  ) {
    if (!this.config.get<boolean>("orchestration.enabled", false)) {
      throw new BadRequestException({
        code: ERROR_CODES.ORCHESTRATION_FEATURE_DISABLED,
        message: "Agentic orchestration is disabled by default.",
      });
    }

    if (input.owner_user_id !== authorizedOwnerUserId) {
      throw new ForbiddenException({
        code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH,
        message: "The orchestration owner scope does not match the caller.",
      });
    }

    const fingerprint = computePublishingSha256(input);
    const existing = await this.repository.findByIdempotency(
      authorizedOwnerUserId,
      input.idempotency_key,
    );
    if (existing) {
      return this.resolveIdempotentReplay(existing, fingerprint);
    }

    const createInput: CreateOrchestrationRunInput = {
      id: input.run_id,
      businessId: input.business_id,
      ownerUserId: authorizedOwnerUserId,
      contractVersion: input.contract_version,
      graphName: input.graph_name,
      graphVersion: input.graph_version,
      status: "queued",
      currentRole: null,
      currentStage: "prepare",
      featureCohort: input.feature_cohort,
      checkpointThreadId: input.run_id,
      immutableInputRefs: {
        confirmed_profile_version_id: input.confirmed_profile_version_id,
        confirmed_profile_version: input.confirmed_profile_version,
        confirmed_profile_checksum: input.confirmed_profile_checksum,
        strategy_id: input.strategy_id,
        strategy_brief_id: input.strategy_brief_id,
        requested_week_number: input.requested_week_number,
        week_context_id: null,
        week_context_checksum: null,
      },
      outputRefs: {},
      bounds: INITIAL_BOUNDS,
      correlationId: input.correlation_id,
      idempotencyKey: input.idempotency_key,
      idempotencyFingerprint: fingerprint,
    };

    try {
      return await this.repository.createRunWithInitialEvent(createInput);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const committed = await this.repository.findByIdempotency(
        authorizedOwnerUserId,
        input.idempotency_key,
      );
      if (!committed) throw error;
      return this.resolveIdempotentReplay(committed, fingerprint);
    }
  }

  /**
   * Shared lifecycle entry point for later workers. It validates the contract
   * before the conditional database update; a stale worker gets a stable
   * conflict instead of silently overwriting a newer state.
   */
  async transitionRun(
    runId: string,
    ownerUserId: string,
    next: OrchestrationStatus,
  ): Promise<boolean> {
    const current = await this.repository.findByIdAndOwner(runId, ownerUserId);
    if (!current) return false;
    if (
      !isOrchestrationStatus(current.status) ||
      !isOrchestrationStatus(next)
    ) {
      throw new ConflictException({
        code: ERROR_CODES.ORCHESTRATION_INVALID_TRANSITION,
        message:
          "The orchestration run contains an unsupported lifecycle status.",
      });
    }
    const from: OrchestrationStatus = current.status;
    transitionOrchestrationRun(from, next);
    const transitioned = await this.repository.transitionStatus(
      runId,
      ownerUserId,
      from,
      next,
    );
    if (!transitioned) {
      throw new ConflictException({
        code: ERROR_CODES.ORCHESTRATION_STALE_RESUME,
        message:
          "The orchestration run changed before this transition committed.",
      });
    }
    return true;
  }

  private resolveIdempotentReplay<T extends { idempotencyFingerprint: string }>(
    existing: T,
    fingerprint: string,
  ): T {
    if (existing.idempotencyFingerprint !== fingerprint) {
      throw new ConflictException({
        code: ERROR_CODES.ORCHESTRATION_DUPLICATE_START,
        message:
          "The idempotency key was already used with a different orchestration request.",
      });
    }
    return existing;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

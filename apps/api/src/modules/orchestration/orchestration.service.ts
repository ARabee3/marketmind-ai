import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import {
  ERROR_CODES,
  OrchestrationContractValidationError,
  OrchestrationLifecycleError,
  assertCampaignOrchestrationResumeV1,
  assertCampaignOrchestrationStartV1,
  computePublishingSha256,
  isOrchestrationStatus,
  transitionOrchestrationRun,
} from "@marketmind/contracts";
import type {
  CampaignOrchestrationResumeV1,
  CampaignOrchestrationStartV1,
  OrchestrationStatus,
} from "@marketmind/contracts";
import { OrchestrationRepository } from "./orchestration.repository";
import type {
  CreateOrchestrationRunInput,
  OrchestrationStartResult,
} from "./orchestration.repository";

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
  ): Promise<OrchestrationStartResult> {
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

    try {
      assertCampaignOrchestrationStartV1(input);
    } catch (error) {
      if (error instanceof OrchestrationContractValidationError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }

    if (
      !(await this.repository.isStartScopeValid(input, authorizedOwnerUserId))
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH,
        message:
          "The business and immutable input references are outside the caller scope.",
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
        week_context_id: input.week_context_id,
        week_context_checksum: input.week_context_checksum,
      },
      outputRefs: {},
      bounds: { ...input.bounds },
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
    try {
      transitionOrchestrationRun(from, next);
    } catch (error) {
      if (error instanceof OrchestrationLifecycleError) {
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
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

  /**
   * Validates the exact owner, thread, run, and decision binding before a
   * future worker calls FastAPI with Command(resume=...). Keeping this check
   * here prevents a resume caller from selecting an arbitrary checkpoint.
   */
  async validateResumeRequest(
    input: CampaignOrchestrationResumeV1,
    authorizedOwnerUserId: string,
  ) {
    if (!this.config.get<boolean>("orchestration.enabled", false)) {
      throw new BadRequestException({
        code: ERROR_CODES.ORCHESTRATION_FEATURE_DISABLED,
        message: "Agentic orchestration is disabled by default.",
      });
    }

    if (
      input.owner_user_id !== authorizedOwnerUserId ||
      input.decision_binding.decided_by_user_id !== authorizedOwnerUserId
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH,
        message:
          "The orchestration decision owner scope does not match the caller.",
      });
    }

    try {
      assertCampaignOrchestrationResumeV1(input);
    } catch (error) {
      if (error instanceof OrchestrationContractValidationError) {
        const Exception =
          error.code === ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH
            ? ForbiddenException
            : BadRequestException;
        throw new Exception({ code: error.code, message: error.message });
      }
      throw error;
    }

    const run = await this.repository.findByIdAndOwner(
      input.run_id,
      authorizedOwnerUserId,
    );
    if (!run) {
      throw new NotFoundException({
        code: ERROR_CODES.ORCHESTRATION_NOT_FOUND,
        message: "The orchestration run was not found for this owner.",
      });
    }
    if (
      run.businessId !== input.business_id ||
      run.checkpointThreadId !== input.checkpoint_thread_id
    ) {
      throw new ForbiddenException({
        code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH,
        message: "The resume binding does not match the persisted run scope.",
      });
    }
    if (
      run.status !== "awaiting_strategy_approval" &&
      run.status !== "awaiting_content_approval"
    ) {
      throw new ConflictException({
        code: ERROR_CODES.ORCHESTRATION_STALE_RESUME,
        message: "The orchestration run is not waiting for an owner decision.",
      });
    }
    return run;
  }

  private resolveIdempotentReplay(
    existing: OrchestrationStartResult,
    fingerprint: string,
  ): OrchestrationStartResult {
    if (existing.run.idempotencyFingerprint !== fingerprint) {
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

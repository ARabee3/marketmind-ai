import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { ERROR_CODES, computePublishingSha256 } from "@marketmind/contracts";
import type {
  CampaignOrchestrationResumeV1,
  CampaignOrchestrationStartV1,
} from "@marketmind/contracts";
import { OrchestrationRepository } from "./orchestration.repository";
import { OrchestrationService } from "./orchestration.service";

const START: CampaignOrchestrationStartV1 = {
  contract_version: "orchestration-v1",
  run_id: "11111111-1111-4111-8111-111111111111",
  correlation_id: "corr-1",
  idempotency_key: "start-1",
  owner_user_id: "22222222-2222-4222-8222-222222222222",
  business_id: "33333333-3333-4333-8333-333333333333",
  graph_name: "campaign-v1",
  graph_version: "2026-08-07",
  feature_cohort: "demo-only",
  confirmed_profile_version_id: "44444444-4444-4444-8444-444444444444",
  confirmed_profile_version: 1,
  confirmed_profile_checksum:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  strategy_id: "55555555-5555-4555-8555-555555555555",
  strategy_brief_id: "66666666-6666-4666-8666-666666666666",
  requested_week_number: 1,
  week_context_id: null,
  week_context_checksum: null,
  bounds: {
    tool_calls_used: 0,
    tool_calls_limit: 8,
    replans_used: 0,
    replans_limit: 2,
    token_budget: 12000,
    cost_budget_usd: 0.5,
    deadline_at: "2026-08-07T08:30:00.000Z",
  },
  requested_at: "2026-08-07T09:00:00.000Z",
};

const RUN = {
  id: START.run_id,
  ownerUserId: START.owner_user_id,
  idempotencyKey: START.idempotency_key,
  idempotencyFingerprint: computePublishingSha256(START),
  status: "queued",
};
const EVENT = { seq: 1 };
const START_RESULT = { run: RUN, event: EVENT };
const RESUME: CampaignOrchestrationResumeV1 = {
  contract_version: "orchestration-v1",
  run_id: START.run_id,
  checkpoint_thread_id: START.run_id,
  correlation_id: START.correlation_id,
  idempotency_key: "resume-1",
  owner_user_id: START.owner_user_id,
  business_id: START.business_id,
  decision_binding: {
    binding_type: "strategy",
    run_id: START.run_id,
    business_id: START.business_id,
    strategy_id: START.strategy_id,
    strategy_version_id: "77777777-7777-4777-8777-777777777777",
    strategy_version: 1,
    strategy_checksum:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    decision_id: "88888888-8888-4888-8888-888888888888",
    decision: "approved",
    decided_by_user_id: START.owner_user_id,
    decided_at: "2026-08-07T09:15:00.000Z",
  },
  requested_at: "2026-08-07T09:16:00.000Z",
};

function setup(enabled: boolean) {
  const repository = {
    findByIdempotency: jest.fn(),
    isStartScopeValid: jest.fn().mockResolvedValue(true),
    createRunWithInitialEvent: jest.fn(),
    findByIdAndOwner: jest.fn(),
    transitionStatus: jest.fn(),
  } as unknown as OrchestrationRepository;
  const config = {
    get: jest.fn().mockReturnValue(enabled),
  } as unknown as ConfigService;
  return {
    repository,
    config,
    service: new OrchestrationService(repository, config),
  };
}

describe("OrchestrationService", () => {
  it("rejects starts while the opt-in flag is disabled", async () => {
    const { service } = setup(false);

    await expect(
      service.startRun(START, START.owner_user_id),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_FEATURE_DISABLED },
    });
  });

  it("creates a queued run envelope when explicitly enabled", async () => {
    const { service, repository } = setup(true);
    const create = (
      repository.createRunWithInitialEvent as jest.Mock
    ).mockResolvedValue({
      run: RUN,
      event: EVENT,
    });

    await expect(service.startRun(START, START.owner_user_id)).resolves.toEqual(
      START_RESULT,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: START.run_id,
        status: "queued",
        currentStage: "prepare",
        checkpointThreadId: START.run_id,
        idempotencyFingerprint: RUN.idempotencyFingerprint,
      }),
    );
  });

  it("replays the same idempotency key to one committed run", async () => {
    const { service, repository } = setup(true);
    (repository.findByIdempotency as jest.Mock).mockResolvedValue(START_RESULT);

    await expect(service.startRun(START, START.owner_user_id)).resolves.toBe(
      START_RESULT,
    );
    expect(repository.createRunWithInitialEvent).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused with different request bytes", async () => {
    const { service, repository } = setup(true);
    (repository.findByIdempotency as jest.Mock).mockResolvedValue({
      ...START_RESULT,
      run: { ...RUN, idempotencyFingerprint: "different-request" },
    });

    await expect(
      service.startRun(START, START.owner_user_id),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_DUPLICATE_START },
    });
  });

  it("rejects a caller whose owner scope does not match the envelope", async () => {
    const { service } = setup(true);

    await expect(
      service.startRun(START, "another-owner"),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH },
    });
  });

  it("rejects a business or immutable reference outside the owner scope", async () => {
    const { service, repository } = setup(true);
    (repository.isStartScopeValid as jest.Mock).mockResolvedValue(false);

    await expect(
      service.startRun(START, START.owner_user_id),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH },
    });
    expect(repository.findByIdempotency).not.toHaveBeenCalled();
  });

  it("handles a concurrent unique-key race by replaying the committed row", async () => {
    const { service, repository } = setup(true);
    (repository.createRunWithInitialEvent as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );
    (repository.findByIdempotency as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(START_RESULT);

    await expect(service.startRun(START, START.owner_user_id)).resolves.toBe(
      START_RESULT,
    );
  });

  it("uses the lifecycle contract and rejects an illegal transition", async () => {
    const { service, repository } = setup(true);
    (repository.findByIdAndOwner as jest.Mock).mockResolvedValue({
      status: "queued",
    });
    (repository.transitionStatus as jest.Mock).mockResolvedValue(true);

    await expect(
      service.transitionRun(START.run_id, START.owner_user_id, "running"),
    ).resolves.toBe(true);
    expect(repository.transitionStatus).toHaveBeenCalledWith(
      START.run_id,
      START.owner_user_id,
      "queued",
      "running",
    );

    await expect(
      service.transitionRun(START.run_id, START.owner_user_id, "completed"),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_INVALID_TRANSITION },
    });
  });

  it("turns an unknown persisted status into a stable lifecycle error", async () => {
    const { service, repository } = setup(true);
    (repository.findByIdAndOwner as jest.Mock).mockResolvedValue({
      status: "corrupted_status",
    });

    await expect(
      service.transitionRun(START.run_id, START.owner_user_id, "running"),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_INVALID_TRANSITION },
    });
    expect(repository.transitionStatus).not.toHaveBeenCalled();
  });

  it("validates an exact owner decision binding before resume", async () => {
    const { service, repository } = setup(true);
    (repository.findByIdAndOwner as jest.Mock).mockResolvedValue({
      businessId: START.business_id,
      checkpointThreadId: START.run_id,
      status: "awaiting_strategy_approval",
    });

    await expect(
      service.validateResumeRequest(RESUME, START.owner_user_id),
    ).resolves.toMatchObject({
      businessId: START.business_id,
      checkpointThreadId: START.run_id,
    });
  });

  it("rejects a resume that points at another checkpoint", async () => {
    const { service, repository } = setup(true);
    const mismatched = {
      ...RESUME,
      checkpoint_thread_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    await expect(
      service.validateResumeRequest(mismatched, START.owner_user_id),
    ).rejects.toMatchObject({
      response: { code: ERROR_CODES.ORCHESTRATION_SCOPE_MISMATCH },
    });
    expect(repository.findByIdAndOwner).not.toHaveBeenCalled();
  });
});

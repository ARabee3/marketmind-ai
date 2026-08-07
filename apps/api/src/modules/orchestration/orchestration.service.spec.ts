import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { ERROR_CODES, computePublishingSha256 } from "@marketmind/contracts";
import type { CampaignOrchestrationStartV1 } from "@marketmind/contracts";
import { OrchestrationRepository } from "./orchestration.repository";
import { OrchestrationService } from "./orchestration.service";

const START: CampaignOrchestrationStartV1 = {
  contract_version: "orchestration-v1",
  run_id: "run-1",
  correlation_id: "corr-1",
  idempotency_key: "start-1",
  owner_user_id: "owner-1",
  business_id: "business-1",
  graph_name: "campaign-v1",
  graph_version: "2026-08-07",
  feature_cohort: "demo-only",
  confirmed_profile_version_id: "profile-version-1",
  confirmed_profile_version: 1,
  confirmed_profile_checksum: "profile-checksum",
  strategy_id: "strategy-1",
  strategy_brief_id: "brief-1",
  requested_week_number: 1,
  requested_at: "2026-08-07T09:00:00.000Z",
};

const RUN = {
  id: START.run_id,
  ownerUserId: START.owner_user_id,
  idempotencyKey: START.idempotency_key,
  idempotencyFingerprint: computePublishingSha256(START),
  status: "queued",
};

function setup(enabled: boolean) {
  const repository = {
    findByIdempotency: jest.fn(),
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
      event: { seq: 1 },
    });

    await expect(service.startRun(START, START.owner_user_id)).resolves.toEqual(
      {
        run: RUN,
        event: { seq: 1 },
      },
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
    (repository.findByIdempotency as jest.Mock).mockResolvedValue(RUN);

    await expect(service.startRun(START, START.owner_user_id)).resolves.toBe(
      RUN,
    );
    expect(repository.createRunWithInitialEvent).not.toHaveBeenCalled();
  });

  it("rejects an idempotency key reused with different request bytes", async () => {
    const { service, repository } = setup(true);
    (repository.findByIdempotency as jest.Mock).mockResolvedValue({
      ...RUN,
      idempotencyFingerprint: "different-request",
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
      .mockResolvedValueOnce(RUN);

    await expect(service.startRun(START, START.owner_user_id)).resolves.toBe(
      RUN,
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
      code: ERROR_CODES.ORCHESTRATION_INVALID_TRANSITION,
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
});

import { ConflictException } from "@nestjs/common";
import type {
  OptimizationAgentResultV1,
  OptimizationProposalV1,
} from "@marketmind/contracts";
import { OptimizationService } from "./optimization.service";
import type { OptimizationSnapshotInput } from "./optimization-analyzer";

const BUSINESS_ID = "a1000000-0000-4000-8000-000000000002";
const STRATEGY_ID = "a1000000-0000-4000-8000-000000000011";
const CYCLE_ID = "a1000000-0000-4000-8000-000000000012";

function snapshot(index: number): OptimizationSnapshotInput {
  const suffix = String(index).padStart(3, "0");
  return {
    snapshot_id: `a1000000-0000-4000-8000-000000000${suffix}`,
    business_id: BUSINESS_ID,
    publishing_result_id: `a2000000-0000-4000-8000-000000000${suffix}`,
    candidate_id: `a3000000-0000-4000-8000-000000000${suffix}`,
    candidate_checksum: `checksum-${index}`,
    strategy_id: STRATEGY_ID,
    strategy_version: 2,
    content_cycle_id: CYCLE_ID,
    content_format: "text_post",
    provider: "facebook",
    window: "7d",
    published_at: `2026-08-${10 + index}T08:00:00Z`,
    observed_at: `2026-08-${17 + index}T08:00:00Z`,
    metrics: {
      post_media_view: { status: "available", value: 80 + index * 20 },
      post_clicks: { status: "available", value: 8 + index },
    },
    caption: `Caption ${index}`,
    cta: "Learn more",
  };
}

function proposal(
  overrides: Partial<OptimizationProposalV1> = {},
): OptimizationProposalV1 {
  return {
    contract_version: "optimization-v1",
    proposal_id: "a4000000-0000-4000-8000-000000000001",
    business_id: BUSINESS_ID,
    strategy_id: STRATEGY_ID,
    strategy_version: 2,
    content_cycle_id: CYCLE_ID,
    format_cohort: "text_post",
    basis_snapshot_ids: [
      snapshot(1).snapshot_id,
      snapshot(2).snapshot_id,
      snapshot(3).snapshot_id,
    ],
    evidence_checksum:
      "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
    deterministic_comparison: [
      {
        metric: "post_media_view",
        baseline_median: 100,
        values: [100, 120, 140],
        best_snapshot_id: snapshot(3).snapshot_id,
        best_value: 140,
        delta_from_median: 40,
        delta_percent: 40,
        direction: "higher_is_better",
      },
    ],
    change_kind: "hook_style",
    summary: "Lead with a concrete situation.",
    rationale: "The strongest observed post used a direct opening.",
    uncertainty: "Small cohort; no causal claim.",
    instruction: "Try a concrete situation in one future hook only.",
    model_version: "mock-optimization-model",
    prompt_version: "optimization-prompt-v1",
    generation_fingerprint:
      "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
    status: "PENDING_OWNER_DECISION",
    created_at: "2026-08-20T08:01:12Z",
    ...overrides,
  };
}

function recommendation(
  ids: readonly string[],
  generationFingerprint = "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
): OptimizationAgentResultV1 {
  return {
    contract_version: "optimization-v1",
    outcome: "recommendation",
    generation_fingerprint: generationFingerprint,
    model_version: "mock-optimization-model",
    prompt_version: "optimization-prompt-v1",
    evidence_snapshot_ids: ids,
    change_kind: "hook_style",
    summary: "Lead with a concrete situation.",
    rationale: "The strongest observed post used a direct opening.",
    uncertainty: "Small cohort; no causal claim.",
    instruction: "Try a concrete situation in one future hook only.",
  };
}

describe("OptimizationService", () => {
  function setup(snapshots: readonly OptimizationSnapshotInput[]) {
    const prisma = {
      business: { findFirst: jest.fn().mockResolvedValue({ id: BUSINESS_ID }) },
    } as any;
    const repository = {
      listEligibleSnapshots: jest
        .fn()
        .mockResolvedValue({ snapshots, conflict: false }),
      findByFingerprint: jest.fn().mockResolvedValue(null),
      createProposal: jest.fn().mockResolvedValue(proposal()),
      listProposals: jest.fn().mockResolvedValue([proposal()]),
      findById: jest.fn().mockResolvedValue(proposal()),
    } as any;
    const ai = { generate: jest.fn() } as any;
    const service = new OptimizationService(prisma, repository, ai);
    return { service, repository, ai };
  }

  it("returns collecting baseline without calling FastAPI", async () => {
    const { service, ai } = setup([snapshot(1), snapshot(2)]);

    const result = await service.generate("owner-1", { format: "text_post" });

    expect(result.outcome).toBe("not_ready");
    expect(result.readiness.reason).toBe(
      "fewer_than_three_comparable_7d_snapshots",
    );
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("returns weak readiness without calling FastAPI", async () => {
    const { service, ai } = setup(
      [snapshot(1), snapshot(2), snapshot(3)].map((item) => ({
        ...item,
        metrics: {
          post_media_view: { status: "available", value: 100 },
          post_clicks: { status: "available", value: 10 },
        },
      })),
    );

    const result = await service.generate("owner-1", { format: "text_post" });

    expect(result.outcome).toBe("not_ready");
    expect(result.readiness.reason).toBe("weak_signal");
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("sends only deterministic evidence and persists a pending proposal", async () => {
    const snapshots = [snapshot(1), snapshot(2), snapshot(3)];
    const { service, repository, ai } = setup(snapshots);
    ai.generate.mockImplementation(
      async (request: { generation_fingerprint: string }) =>
        recommendation(
          snapshots.map((item) => item.snapshot_id),
          request.generation_fingerprint,
        ),
    );

    const result = await service.generate("owner-1", { format: "text_post" });

    expect(result.outcome).toBe("proposal");
    expect(repository.createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PENDING_OWNER_DECISION",
        change_kind: "hook_style",
        basis_snapshot_ids: snapshots.map((item) => item.snapshot_id).sort(),
      }),
    );
    expect(ai.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ format_cohort: "text_post" }),
        evidence: expect.arrayContaining([
          expect.objectContaining({ untrusted_caption: "Caption 1" }),
        ]),
      }),
    );
  });

  it("reuses an identical persisted proposal without another provider call", async () => {
    const snapshots = [snapshot(1), snapshot(2), snapshot(3)];
    const { service, repository, ai } = setup(snapshots);
    repository.findByFingerprint.mockResolvedValue(proposal());

    const result = await service.generate("owner-1", { format: "text_post" });

    expect(result.outcome).toBe("proposal");
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it("rejects an AI result that cites a different evidence set", async () => {
    const snapshots = [snapshot(1), snapshot(2), snapshot(3)];
    const { service, ai } = setup(snapshots);
    ai.generate.mockImplementation(
      async (request: { generation_fingerprint: string }) =>
        recommendation(
          [snapshot(1).snapshot_id],
          request.generation_fingerprint,
        ),
    );

    await expect(
      service.generate("owner-1", { format: "text_post" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects an AI result that changes the generation fingerprint", async () => {
    const snapshots = [snapshot(1), snapshot(2), snapshot(3)];
    const { service, ai } = setup(snapshots);
    ai.generate.mockResolvedValue(
      recommendation(
        snapshots.map((item) => item.snapshot_id),
        "different",
      ),
    );

    await expect(
      service.generate("owner-1", { format: "text_post" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

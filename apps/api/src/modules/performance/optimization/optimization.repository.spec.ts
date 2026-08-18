import {
  OptimizationRepository,
  OptimizationRepositoryError,
} from "./optimization.repository";

const BUSINESS_ID = "a1000000-0000-4000-8000-000000000002";
const RESULT_ID = "a1000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "a1000000-0000-4000-8000-000000000004";
const INTENT_ID = "a1000000-0000-4000-8000-000000000005";
const CANDIDATE_ID = "a1000000-0000-4000-8000-000000000006";
const SNAPSHOT_ID = "a1000000-0000-4000-8000-000000000007";
const CHECKSUM =
  "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";
const FINGERPRINT =
  "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";
const STRATEGY_ID = "a1000000-0000-4000-8000-000000000011";
const CYCLE_ID = "a1000000-0000-4000-8000-000000000012";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    businessId: BUSINESS_ID,
    publishingResultId: RESULT_ID,
    publishingAttemptId: ATTEMPT_ID,
    publishingIntentId: INTENT_ID,
    candidateId: CANDIDATE_ID,
    candidateChecksum: CHECKSUM,
    provider: "facebook",
    providerObjectId: "page-123_post-456",
    window: "7d",
    publishedAt: new Date("2026-08-10T08:00:00Z"),
    dueAt: new Date("2026-08-17T08:00:00Z"),
    observedAt: new Date("2026-08-17T08:01:00Z"),
    fetchedAt: new Date("2026-08-17T08:01:12Z"),
    graphVersion: "v21.0",
    metricSchemaVersion: "facebook-insights-v1",
    metrics: {
      post_media_view: { status: "available", value: 100 },
      post_clicks: { status: "available", value: 12 },
    },
    providerMetadata: { source: "meta_insights" },
    createdAt: new Date("2026-08-17T08:01:12Z"),
    candidate: {
      id: CANDIDATE_ID,
      businessId: BUSINESS_ID,
      candidateChecksum: CHECKSUM,
      channel: "facebook",
      format: "text_post",
      payload: {
        candidate_id: CANDIDATE_ID,
        business_id: BUSINESS_ID,
        candidate_checksum: CHECKSUM,
        target_channel: "facebook",
        strategy_id: "a1000000-0000-4000-8000-000000000011",
        strategy_version: 2,
        content_cycle_id: "a1000000-0000-4000-8000-000000000012",
        content_format: "text_post",
        caption: "A quoted caption",
        cta: "Learn more",
      },
    },
    publishingResult: {
      id: RESULT_ID,
      outcome: "PUBLISHED",
      provider: "meta",
      remotePublicationId: "page-123_post-456",
      attempt: {
        id: ATTEMPT_ID,
        intent: {
          id: INTENT_ID,
          mode: "REAL",
          candidate: {
            id: CANDIDATE_ID,
            businessId: BUSINESS_ID,
            candidateChecksum: CHECKSUM,
            channel: "facebook",
            format: "text_post",
          },
        },
      },
    },
    ...overrides,
  };
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1000000-0000-4000-8000-000000000010",
    contractVersion: "optimization-v1",
    businessId: BUSINESS_ID,
    strategyId: STRATEGY_ID,
    strategyVersion: 2,
    contentCycleId: CYCLE_ID,
    formatCohort: "text_post",
    basisSnapshotIds: [
      "a1000000-0000-4000-8000-000000000001",
      "a1000000-0000-4000-8000-000000000002",
      "a1000000-0000-4000-8000-000000000003",
    ],
    evidenceChecksum: CHECKSUM,
    deterministicComparison: [
      {
        metric: "post_media_view",
        baseline_median: 100,
        values: [80, 100, 140],
        best_snapshot_id: "a1000000-0000-4000-8000-000000000003",
        best_value: 140,
        delta_from_median: 40,
        delta_percent: 40,
        direction: "higher_is_better",
      },
      {
        metric: "post_clicks",
        baseline_median: 10,
        values: [8, 10, 13],
        best_snapshot_id: "a1000000-0000-4000-8000-000000000003",
        best_value: 13,
        delta_from_median: 3,
        delta_percent: 30,
        direction: "higher_is_better",
      },
    ],
    changeKind: "hook_style",
    summary: "Lead with a concrete customer situation.",
    rationale: "The strongest observed post used a direct opening.",
    uncertainty: "This small cohort shows association, not causality.",
    instruction: "Try one different hook wording in a future draft.",
    modelVersion: "mock-optimization-model",
    promptVersion: "optimization-prompt-v1",
    generationFingerprint: FINGERPRINT,
    status: "PENDING_OWNER_DECISION",
    createdAt: new Date("2026-08-20T08:01:12Z"),
    ...overrides,
  };
}

function createInput() {
  const stored = proposalRow();
  return {
    contract_version: "optimization-v1" as const,
    business_id: stored.businessId,
    strategy_id: stored.strategyId,
    strategy_version: stored.strategyVersion,
    content_cycle_id: stored.contentCycleId,
    format_cohort: "text_post" as const,
    basis_snapshot_ids: stored.basisSnapshotIds,
    evidence_checksum: stored.evidenceChecksum,
    deterministic_comparison: stored.deterministicComparison as any,
    change_kind: "hook_style" as const,
    summary: stored.summary,
    rationale: stored.rationale,
    uncertainty: stored.uncertainty,
    instruction: stored.instruction,
    model_version: stored.modelVersion,
    prompt_version: "optimization-prompt-v1",
    generation_fingerprint: stored.generationFingerprint,
    status: "PENDING_OWNER_DECISION" as const,
    proposal_id: stored.id,
    created_at: stored.createdAt.toISOString(),
  };
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1000000-0000-4000-8000-000000000020",
    contractVersion: "optimization-decision-v1",
    proposalId: proposalRow().id,
    businessId: BUSINESS_ID,
    strategyId: STRATEGY_ID,
    strategyVersion: 2,
    contentCycleId: CYCLE_ID,
    formatCohort: "text_post",
    evidenceChecksum: CHECKSUM,
    action: "approve",
    ownerUserId: "a1000000-0000-4000-8000-000000000021",
    idempotencyKey: "decision-1",
    requestFingerprint: FINGERPRINT,
    note: null,
    decidedAt: new Date("2026-08-20T08:02:12Z"),
    createdAt: new Date("2026-08-20T08:02:12Z"),
    ...overrides,
  };
}

function instructionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1000000-0000-4000-8000-000000000022",
    contractVersion: "optimization-instruction-v1",
    proposalId: proposalRow().id,
    approvedDecisionId: decisionRow().id,
    businessId: BUSINESS_ID,
    strategyId: STRATEGY_ID,
    strategyVersion: 2,
    contentCycleId: CYCLE_ID,
    formatCohort: "text_post",
    evidenceChecksum: CHECKSUM,
    changeKind: "hook_style",
    instruction: proposalRow().instruction,
    status: "PENDING_CONSUMPTION",
    consumedContentPackId: null,
    consumedWeekPlanId: null,
    approvedAt: new Date("2026-08-20T08:02:12Z"),
    consumedAt: null,
    supersededAt: null,
    createdAt: new Date("2026-08-20T08:02:12Z"),
    updatedAt: new Date("2026-08-20T08:02:12Z"),
    ...overrides,
  };
}

describe("OptimizationRepository", () => {
  it("loads only the server-owned real Facebook seven-day chain", async () => {
    const prisma = {
      metricSnapshot: { findMany: jest.fn().mockResolvedValue([row()]) },
    } as any;
    const repository = new OptimizationRepository(prisma);

    await expect(
      repository.listEligibleSnapshots(BUSINESS_ID),
    ).resolves.toMatchObject({
      conflict: false,
      snapshots: [
        expect.objectContaining({
          snapshot_id: SNAPSHOT_ID,
          strategy_version: 2,
          content_format: "text_post",
          caption: "A quoted caption",
        }),
      ],
    });
    expect(prisma.metricSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: BUSINESS_ID,
          provider: "facebook",
          window: "7d",
          publishingResult: expect.objectContaining({
            outcome: "PUBLISHED",
            provider: "meta",
          }),
        }),
      }),
    );
  });

  it("fails closed when frozen candidate provenance does not match the snapshot", async () => {
    const prisma = {
      metricSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          row({
            candidate: {
              ...row().candidate,
              payload: {
                ...row().candidate.payload,
                candidate_checksum: "tampered",
              },
            },
          }),
        ]),
      },
    } as any;
    const repository = new OptimizationRepository(prisma);

    await expect(
      repository.listEligibleSnapshots(BUSINESS_ID),
    ).resolves.toEqual({
      conflict: true,
      snapshots: [],
    });
  });

  it("returns the existing immutable proposal after an identical concurrent replay", async () => {
    const prisma = {
      optimizationProposal: {
        create: jest.fn().mockRejectedValue({ code: "P2002" }),
        findUnique: jest.fn().mockResolvedValue(proposalRow()),
      },
    } as any;
    const repository = new OptimizationRepository(prisma);

    await expect(
      repository.createProposal(createInput()),
    ).resolves.toMatchObject({
      proposal_id: proposalRow().id,
      generation_fingerprint: FINGERPRINT,
    });
  });

  it("creates one immutable decision and one approved instruction atomically", async () => {
    const decision = decisionRow();
    const instruction = instructionRow();
    const workspaceRow = {
      ...proposalRow(),
      decisions: [decision],
      approvedInstruction: instruction,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      optimizationDecision: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(decision),
      },
      optimizationProposal: {
        findFirst: jest
          .fn()
          .mockImplementation(async ({ include }: { include?: unknown }) =>
            include ? workspaceRow : proposalRow(),
          ),
      },
      approvedOptimizationInstruction: {
        create: jest.fn().mockResolvedValue(instruction),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as any;
    const repository = new OptimizationRepository(prisma);

    const result = await repository.createDecision({
      owner_user_id: decision.ownerUserId,
      business_id: BUSINESS_ID,
      proposal_id: proposalRow().id,
      evidence_checksum: CHECKSUM,
      action: "approve",
      idempotency_key: decision.idempotencyKey,
      request_fingerprint: decision.requestFingerprint,
      note: null,
    });

    expect(result.state).toBe("APPROVED_PENDING_CONSUMPTION");
    expect(tx.optimizationDecision.create).toHaveBeenCalledTimes(1);
    expect(tx.approvedOptimizationInstruction.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a decision that supplies a different immutable evidence checksum", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      optimizationDecision: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      optimizationProposal: {
        findFirst: jest.fn().mockResolvedValue(proposalRow()),
      },
    } as any;
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as any;
    const repository = new OptimizationRepository(prisma);

    await expect(
      repository.createDecision({
        owner_user_id: "a1000000-0000-4000-8000-000000000021",
        business_id: BUSINESS_ID,
        proposal_id: proposalRow().id,
        evidence_checksum: FINGERPRINT,
        action: "dismiss",
        idempotency_key: "decision-2",
        request_fingerprint: FINGERPRINT,
        note: null,
      }),
    ).rejects.toMatchObject({ code: "OPTIMIZATION_EVIDENCE_CONFLICT" });
  });

  it("fails closed when the same fingerprint already stores different evidence", async () => {
    const prisma = {
      optimizationProposal: {
        create: jest.fn().mockRejectedValue({ code: "P2002" }),
        findUnique: jest.fn().mockResolvedValue(
          proposalRow({
            evidenceChecksum:
              "d7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
          }),
        ),
      },
    } as any;
    const repository = new OptimizationRepository(prisma);

    await expect(
      repository.createProposal(createInput()),
    ).rejects.toMatchObject<Partial<OptimizationRepositoryError>>({
      code: "OPTIMIZATION_PROPOSAL_CONFLICT",
    });
  });
});

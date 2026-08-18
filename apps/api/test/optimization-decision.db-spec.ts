import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * PostgreSQL verification for Optimization 2. It is deliberately skipped
 * unless DATABASE_URL names a disposable _test, _ci, or _e2e database.
 */
const databaseUrl = String(process.env.DATABASE_URL ?? "");
const databaseName = databaseUrl.split("/").pop()?.split("?")[0] ?? "";
const safeDatabase = /_(test|ci|e2e)$/i.test(databaseName);
const describeDatabase = safeDatabase ? describe : describe.skip;

const prisma = new PrismaClient();
const ids = {
  user: randomUUID(),
  business: randomUUID(),
  profile: randomUUID(),
  strategy: randomUUID(),
  cycle: randomUUID(),
  proposal: randomUUID(),
  decision: randomUUID(),
  instruction: randomUUID(),
};
const evidenceChecksum =
  "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";
const decisionFingerprint =
  "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";

function proposalData(overrides: Record<string, unknown> = {}) {
  const snapshots = [randomUUID(), randomUUID(), randomUUID()];
  return {
    id: ids.proposal,
    contractVersion: "optimization-v1",
    businessId: ids.business,
    strategyId: ids.strategy,
    strategyVersion: 2,
    contentCycleId: ids.cycle,
    formatCohort: "text_post",
    basisSnapshotIds: snapshots,
    evidenceChecksum,
    deterministicComparison: [
      {
        metric: "post_media_view",
        baseline_median: 100,
        values: [80, 100, 140],
        best_snapshot_id: snapshots[2],
        best_value: 140,
        delta_from_median: 40,
        delta_percent: 40,
        direction: "higher_is_better",
      },
      {
        metric: "post_clicks",
        baseline_median: 10,
        values: [8, 10, 13],
        best_snapshot_id: snapshots[2],
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
    modelVersion: "db-test",
    promptVersion: "optimization-prompt-v1",
    generationFingerprint: randomUUID().replaceAll("-", "").padEnd(64, "0"),
    status: "PENDING_OWNER_DECISION",
    ...overrides,
  };
}

describeDatabase("Optimization 2 PostgreSQL invariants", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ids.user,
        email: `${ids.user}@optimization-decision.test`,
        password: "not-a-real-password",
        fullName: "Optimization 2 DB Test",
      },
    });
    await prisma.business.create({
      data: {
        id: ids.business,
        ownerUserId: ids.user,
        displayName: "Optimization 2 DB Test",
        businessType: "retail",
        city: "Cairo",
      },
    });
    await prisma.businessProfileVersion.create({
      data: {
        id: ids.profile,
        businessId: ids.business,
        version: 1,
        profile: { display_name: "Optimization 2 DB Test" },
        confirmedByUserId: ids.user,
      },
    });
    await prisma.strategy.create({
      data: {
        id: ids.strategy,
        businessId: ids.business,
        ownerUserId: ids.user,
        contractVersion: "strategy-v2",
        status: "approved",
      },
    });
    await prisma.contentCycle.create({
      data: {
        id: ids.cycle,
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 2,
        strategyDecisionId: randomUUID(),
        profileVersionId: ids.profile,
        week1StartDate: new Date("2026-08-17T00:00:00.000Z"),
        ownerUserId: ids.user,
      },
    });
    await prisma.optimizationProposal.create({
      data: proposalData() as never,
    });
    await prisma.optimizationDecision.create({
      data: {
        id: ids.decision,
        contractVersion: "optimization-decision-v1",
        proposalId: ids.proposal,
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 2,
        contentCycleId: ids.cycle,
        formatCohort: "text_post",
        evidenceChecksum,
        action: "approve",
        ownerUserId: ids.user,
        idempotencyKey: `decision-${ids.decision}`,
        requestFingerprint: decisionFingerprint,
        note: null,
        decidedAt: new Date(),
      },
    });
    await prisma.approvedOptimizationInstruction.create({
      data: {
        id: ids.instruction,
        contractVersion: "optimization-instruction-v1",
        proposalId: ids.proposal,
        approvedDecisionId: ids.decision,
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 2,
        contentCycleId: ids.cycle,
        formatCohort: "text_post",
        evidenceChecksum,
        changeKind: "hook_style",
        instruction: "Try one different hook wording in a future draft.",
        status: "PENDING_CONSUMPTION",
        approvedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    // Immutable records intentionally remain in the disposable test database.
    await prisma.$disconnect();
  });

  it("stores one decision and one approved instruction with exact identity", async () => {
    const instruction =
      await prisma.approvedOptimizationInstruction.findUniqueOrThrow({
        where: { id: ids.instruction },
      });
    expect(instruction.proposalId).toBe(ids.proposal);
    expect(instruction.approvedDecisionId).toBe(ids.decision);
    expect(instruction.status).toBe("PENDING_CONSUMPTION");
    expect(instruction.consumedContentPackId).toBeNull();
    expect(instruction.consumedWeekPlanId).toBeNull();
  });

  it("rejects mutation of the immutable decision and forward-only instruction", async () => {
    await expect(
      prisma.optimizationDecision.update({
        where: { id: ids.decision },
        data: { note: "tamper" },
      }),
    ).rejects.toThrow(/immutable|P2010|P2004/i);
    await expect(
      prisma.approvedOptimizationInstruction.update({
        where: { id: ids.instruction },
        data: { status: "PENDING_CONSUMPTION" },
      }),
    ).rejects.toThrow(/forward|P2010|P2004/i);
  });

  it("enforces one terminal decision and one instruction per proposal", async () => {
    await expect(
      prisma.optimizationDecision.create({
        data: {
          id: randomUUID(),
          contractVersion: "optimization-decision-v1",
          proposalId: ids.proposal,
          businessId: ids.business,
          strategyId: ids.strategy,
          strategyVersion: 2,
          contentCycleId: ids.cycle,
          formatCohort: "text_post",
          evidenceChecksum,
          action: "dismiss",
          ownerUserId: ids.user,
          idempotencyKey: `second-${randomUUID()}`,
          requestFingerprint: randomUUID().replaceAll("-", "").padEnd(64, "0"),
          note: null,
          decidedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/P2002|unique|decision/i);
    await expect(
      prisma.approvedOptimizationInstruction.create({
        data: {
          id: randomUUID(),
          contractVersion: "optimization-instruction-v1",
          proposalId: ids.proposal,
          approvedDecisionId: ids.decision,
          businessId: ids.business,
          strategyId: ids.strategy,
          strategyVersion: 2,
          contentCycleId: ids.cycle,
          formatCohort: "text_post",
          evidenceChecksum,
          changeKind: "hook_style",
          instruction: "Try one different hook wording in a future draft.",
          status: "PENDING_CONSUMPTION",
          approvedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/P2002|unique|instruction/i);
  });
});

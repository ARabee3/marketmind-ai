import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * PostgreSQL verification for Optimization 1. It is deliberately skipped
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
};
const snapshotIds = [randomUUID(), randomUUID(), randomUUID()];
const evidenceChecksum =
  "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";
const generationFingerprint =
  "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";

function comparisons() {
  return [
    {
      metric: "post_media_view",
      baseline_median: 100,
      values: [80, 100, 140],
      best_snapshot_id: snapshotIds[2],
      best_value: 140,
      delta_from_median: 40,
      delta_percent: 40,
      direction: "higher_is_better",
    },
    {
      metric: "post_clicks",
      baseline_median: 10,
      values: [8, 10, 13],
      best_snapshot_id: snapshotIds[2],
      best_value: 13,
      delta_from_median: 3,
      delta_percent: 30,
      direction: "higher_is_better",
    },
  ];
}

function proposalData(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.proposal,
    contractVersion: "optimization-v1",
    businessId: ids.business,
    strategyId: ids.strategy,
    strategyVersion: 2,
    contentCycleId: ids.cycle,
    formatCohort: "text_post",
    basisSnapshotIds: snapshotIds,
    evidenceChecksum,
    deterministicComparison: comparisons(),
    changeKind: "hook_style",
    summary: "Lead with a concrete customer situation.",
    rationale: "The strongest observed post used a direct opening.",
    uncertainty: "This small cohort shows association, not causality.",
    instruction: "Try one different hook wording in a future draft.",
    modelVersion: "mock-optimization-model",
    promptVersion: "optimization-prompt-v1",
    generationFingerprint,
    status: "PENDING_OWNER_DECISION",
    ...overrides,
  };
}

describeDatabase("Optimization 1 migration + PostgreSQL invariants", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ids.user,
        email: `${ids.user}@optimization.test`,
        password: "not-a-real-password",
        fullName: "Optimization DB Test",
      },
    });
    await prisma.business.create({
      data: {
        id: ids.business,
        ownerUserId: ids.user,
        displayName: "Optimization DB Test",
        businessType: "retail",
        city: "Cairo",
      },
    });
    await prisma.businessProfileVersion.create({
      data: {
        id: ids.profile,
        businessId: ids.business,
        version: 1,
        profile: { display_name: "Optimization DB Test" },
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
  });

  afterAll(async () => {
    // The immutable proposal intentionally prevents cleanup. CI uses a
    // disposable database, so retain the randomized fixture and disconnect.
    await prisma.$disconnect();
  });

  it("creates only the bounded proposal columns", async () => {
    const columns = (await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'optimization_proposals'`,
    )) as { column_name: string }[];
    const names = columns.map((column) => column.column_name);
    expect(names).toContain("evidence_checksum");
    expect(names).toContain("generation_fingerprint");
    expect(names).not.toContain("access_token");
    expect(names).not.toContain("raw_payload");
    expect(names).not.toContain("caption");
  });

  it("persists one pending proposal per evidence fingerprint", async () => {
    await prisma.optimizationProposal.create({ data: proposalData() as never });

    await expect(
      prisma.optimizationProposal.create({
        data: proposalData({ id: randomUUID() }) as never,
      }),
    ).rejects.toThrow(/P2002|unique/i);
  });

  it("rejects evidence sets below the frozen three-snapshot minimum", async () => {
    await expect(
      prisma.optimizationProposal.create({
        data: proposalData({
          id: randomUUID(),
          generationFingerprint:
            "d7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
          basisSnapshotIds: snapshotIds.slice(0, 2),
        }) as never,
      }),
    ).rejects.toThrow(/constraint|snapshot_ids|P2004/i);
  });

  it("rejects updates and deletes after persistence", async () => {
    await expect(
      prisma.optimizationProposal.update({
        where: { id: ids.proposal },
        data: { summary: "Mutation must fail" },
      }),
    ).rejects.toThrow(/immutable|P2010|P2004/i);
    await expect(
      prisma.optimizationProposal.delete({ where: { id: ids.proposal } }),
    ).rejects.toThrow(/immutable|P2010|P2004/i);
  });
});

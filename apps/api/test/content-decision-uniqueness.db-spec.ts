import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { ContentCycleRepository } from "../src/modules/content/repositories/content-cycle.repository";

const prisma = new PrismaClient();
const run = `decision-unique-${randomUUID()}`;
const ids = {
  user: randomUUID(),
  business: randomUUID(),
  profile: randomUUID(),
  strategy: randomUUID(),
  strategyDecision: randomUUID(),
  cycle: randomUUID(),
  item: randomUUID(),
  version: randomUUID(),
};
let claimedCycleId: string | null = null;

async function cleanup(): Promise<void> {
  const cycle = await prisma.contentCycle.findFirst({
    where: { idempotencyKey: `${run}-cycle` },
    select: { id: true },
  });
  const cycleId = cycle?.id ?? claimedCycleId ?? ids.cycle;
  await prisma.publicationCandidate.deleteMany({
    where: { contentCycleId: cycleId },
  });
  await prisma.contentDecision.deleteMany({
    where: { contentItemId: ids.item },
  });
  await prisma.contentItemVersion.deleteMany({ where: { id: ids.version } });
  await prisma.contentItem.deleteMany({ where: { id: ids.item } });
  await prisma.contentPack.deleteMany({ where: { contentCycleId: cycleId } });
  await prisma.contentWeekContext.deleteMany({
    where: { contentCycleId: cycleId },
  });
  await prisma.contentCycle.deleteMany({ where: { id: cycleId } });
  await prisma.businessProfileVersion.deleteMany({
    where: { id: ids.profile },
  });
  await prisma.business.deleteMany({ where: { id: ids.business } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

describe("Content decision and candidate PostgreSQL uniqueness", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: ids.user,
        email: `${run}@example.test`,
        password: "not-used",
      },
    });
    await prisma.business.create({
      data: {
        id: ids.business,
        ownerUserId: ids.user,
        displayName: "Decision Unique Test",
        businessType: "retail",
        city: "Cairo",
      },
    });
    await prisma.businessProfileVersion.create({
      data: {
        id: ids.profile,
        businessId: ids.business,
        version: 1,
        profile: {},
        confirmedByUserId: ids.user,
      },
    });
    const cycle = await new ContentCycleRepository(
      prisma as unknown as PrismaService,
    ).createCycleWithWeekOne(
      {
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 1,
        strategyDecisionId: ids.strategyDecision,
        profileVersionId: ids.profile,
        week1StartDate: new Date("2026-08-01T00:00:00.000Z"),
        nextGenerationAt: new Date("2026-08-08T00:00:00.000Z"),
        idempotencyKey: `${run}-cycle`,
        requestFingerprint: `${run}-fingerprint`,
        initialWeekContext: {
          week_number: 1,
          week_start_date: "2026-08-01",
          promotion_mode: "none",
          promotion: null,
          must_include: [],
          must_avoid: [],
          approved_asset_ids: [],
          cta_destination: { type: "none", value: null },
        },
      },
      ids.user,
    );
    claimedCycleId = cycle.cycle.id;
    await prisma.contentPack.update({
      where: { id: cycle.pack.id },
      data: { status: "draft" },
    });
    await prisma.contentItem.create({
      data: { id: ids.item, contentPackId: cycle.pack.id, status: "draft" },
    });
    await prisma.contentItemVersion.create({
      data: {
        id: ids.version,
        contentItemId: ids.item,
        contentPackId: cycle.pack.id,
        version: 1,
        channel: "instagram",
        format: "text_post",
        languageMode: "ar-EG",
        strategyTrace: {},
        captionVariants: [],
        cta: null,
        hashtags: [],
        creativeBrief: "decision test",
        altText: "decision test",
        shortVideoScript: null,
        recommendedPublishWindow: {},
        claimSources: [],
        warnings: [],
        blockers: [],
        assetRequired: false,
        assetIds: [],
        generationProvenance: {},
        versionChecksum: "checksum-decision-test",
      },
    });
    await prisma.contentItem.update({
      where: { id: ids.item },
      data: { currentVersionId: ids.version },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("allows exactly one concurrent terminal decision for one exact version", async () => {
    const create = (key: string) =>
      prisma.contentDecision.create({
        data: {
          contentItemId: ids.item,
          contentItemVersionId: ids.version,
          contentItemVersion: 1,
          contentItemVersionChecksum: "checksum-decision-test",
          requestFingerprint: key,
          decision: "approved",
          revisionNotes: null,
          decidedByUserId: ids.user,
          ownerUserId: ids.user,
          idempotencyKey: `${run}-${key}`,
          decidedAt: new Date(),
        },
      });
    const results = await Promise.allSettled([create("a"), create("b")]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(
      (rejected?.reason as Prisma.PrismaClientKnownRequestError).code,
    ).toBe("P2002");
  });

  it("allows one immutable publication candidate for that exact version", async () => {
    const pack = await prisma.contentPack.findFirstOrThrow({
      where: { contentCycleId: claimedCycleId! },
    });
    await prisma.publicationCandidate.create({
      data: {
        candidateId: randomUUID(),
        businessId: ids.business,
        contractVersion: "publication-candidate-v1",
        payload: {},
        candidateChecksum: `${run}-checksum-a`,
        contentCycleId: claimedCycleId!,
        contentPackId: pack.id,
        contentItemId: ids.item,
        contentItemVersionId: ids.version,
        contentItemVersion: 1,
        state: "active",
      },
    });
    await expect(
      prisma.publicationCandidate.create({
        data: {
          candidateId: randomUUID(),
          businessId: ids.business,
          contractVersion: "publication-candidate-v1",
          payload: {},
          candidateChecksum: `${run}-checksum-b`,
          contentCycleId: claimedCycleId!,
          contentPackId: pack.id,
          contentItemId: ids.item,
          contentItemVersionId: ids.version,
          contentItemVersion: 1,
          state: "active",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

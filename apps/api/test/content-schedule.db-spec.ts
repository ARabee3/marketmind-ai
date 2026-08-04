import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { computeContentItemVersionChecksum } from "@marketmind/contracts";
import { PrismaService } from "../src/common/persistence/prisma.service";
import {
  cairoCalendarDate,
  weekCutoffDate,
  weekStartDate,
} from "../src/modules/content/content-schedule";
import { ContentCycleRepository } from "../src/modules/content/repositories/content-cycle.repository";
import { ContentPackRepository } from "../src/modules/content/repositories/content-pack.repository";
import { ContentWeekContextRepository } from "../src/modules/content/repositories/content-week-context.repository";

/** Real PostgreSQL coverage for the anchored 12-week lifecycle. */
const prisma = new PrismaClient();
const run = `schedule-${randomUUID()}`;
const ids = {
  user: randomUUID(),
  business: randomUUID(),
  profile: randomUUID(),
  cycle: randomUUID(),
  strategy: randomUUID(),
  decision: randomUUID(),
};
const anchor = new Date("2026-04-10T00:00:00.000Z");
let claimedCycleId: string | null = null;

async function cleanup(): Promise<void> {
  const cycle = await prisma.contentCycle.findFirst({
    where: { idempotencyKey: `${run}-cycle` },
    select: { id: true },
  });
  const cycleId = cycle?.id ?? claimedCycleId ?? ids.cycle;
  await prisma.contentItemVersion.deleteMany({
    where: { contentPack: { contentCycleId: cycleId } },
  });
  await prisma.contentItem.deleteMany({
    where: { contentPack: { contentCycleId: cycleId } },
  });
  await prisma.contentProgressEvent.deleteMany({
    where: { contentPack: { contentCycleId: cycleId } },
  });
  await prisma.contentGenerationRun.deleteMany({
    where: { contentCycleId: cycleId },
  });
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

describe("Content schedule and freeze DB lifecycle", () => {
  let cycles: ContentCycleRepository;
  let contexts: ContentWeekContextRepository;
  let packs: ContentPackRepository;

  beforeAll(async () => {
    await prisma.$connect();
    cycles = new ContentCycleRepository(prisma as unknown as PrismaService);
    contexts = new ContentWeekContextRepository(
      prisma as unknown as PrismaService,
    );
    packs = new ContentPackRepository(prisma as unknown as PrismaService);

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
        displayName: "Schedule DB Test Business",
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
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("claims Weeks 1-12 without date drift and completes only after Week-12 draft", async () => {
    const created = await cycles.createCycleWithWeekOne(
      {
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 1,
        strategyDecisionId: ids.decision,
        profileVersionId: ids.profile,
        week1StartDate: anchor,
        nextGenerationAt: weekCutoffDate(anchor, 1),
        idempotencyKey: `${run}-cycle`,
        requestFingerprint: `${run}-fingerprint`,
        initialWeekContext: {
          week_number: 1,
          week_start_date: weekStartDate(anchor, 1),
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

    expect(created.created).toBe(true);
    expect(created.pack.weekNumber).toBe(1);
    claimedCycleId = created.cycle.id;
    const cycleId = created.cycle.id;

    const replay = await cycles.createCycleWithWeekOne(
      {
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 1,
        strategyDecisionId: ids.decision,
        profileVersionId: ids.profile,
        week1StartDate: anchor,
        nextGenerationAt: weekCutoffDate(anchor, 1),
        idempotencyKey: `${run}-cycle`,
        requestFingerprint: `${run}-fingerprint`,
        initialWeekContext: {
          week_number: 1,
          week_start_date: weekStartDate(anchor, 1),
          promotion_mode: "none",
          promotion: null,
          must_include: ["must-not-replace-frozen-context"],
          must_avoid: [],
          approved_asset_ids: [],
          cta_destination: { type: "none", value: null },
        },
      },
      ids.user,
    );
    expect(replay.created).toBe(false);
    expect(replay.cycle.id).toBe(cycleId);
    expect(replay.weekContext.mustInclude).toEqual([]);

    for (let weekNumber = 1; weekNumber <= 12; weekNumber += 1) {
      let pack = created.pack;
      if (weekNumber > 1) {
        const context = await contexts.createSafeDefaultContext(
          cycleId,
          weekNumber,
          {
            weekStartDate: new Date(
              `${weekStartDate(anchor, weekNumber)}T00:00:00.000Z`,
            ),
            cutoffAt: weekCutoffDate(anchor, weekNumber),
          },
        );
        const claim = await packs.claimQueuedPack(
          cycleId,
          weekNumber,
          context.id,
        );
        expect(claim.created).toBe(true);
        pack = claim.pack;
      }

      const context = await prisma.contentWeekContext.findUniqueOrThrow({
        where: {
          contentCycleId_weekNumber: {
            contentCycleId: cycleId,
            weekNumber,
          },
        },
      });
      const cycle = await prisma.contentCycle.findUniqueOrThrow({
        where: { id: cycleId },
      });
      expect(context.weekStartDate.toISOString().slice(0, 10)).toBe(
        weekStartDate(anchor, weekNumber),
      );
      expect(cairoCalendarDate(cycle.nextGenerationAt!)).toBe(
        cairoCalendarDate(weekCutoffDate(anchor, weekNumber)),
      );
      expect(context.frozenAt).not.toBeNull();
      expect(pack.weekNumber).toBe(weekNumber);
      expect(
        await prisma.contentPack.count({
          where: { contentCycleId: cycleId, weekNumber },
        }),
      ).toBe(1);

      if (weekNumber === 12) {
        expect(cycle.status).toBe("active");
      }
    }

    await expect(
      packs.claimQueuedPack(cycleId, 13, randomUUID()),
    ).rejects.toThrow("between 1 and 12");

    const week12 = await prisma.contentPack.findUniqueOrThrow({
      where: {
        contentCycleId_weekNumber: { contentCycleId: cycleId, weekNumber: 12 },
      },
    });
    await packs.markPackStatus(week12.id, "queued", "generating");
    await packs.markPackStatus(week12.id, "generating", "validating");

    const itemId = randomUUID();
    const version = randomUUID();
    const item = {
      id: version,
      contract_version: "content-v1",
      content_item_id: itemId,
      content_pack_id: week12.id,
      version: 1,
      channel: "instagram",
      format: "text_post",
      language_mode: "ar-EG",
      strategy_trace: {
        strategy_id: ids.strategy,
        strategy_version: 1,
        week_number: 12,
        pillar_ids: [],
        objective: "awareness",
        channel: "instagram",
      },
      caption_variants: [],
      cta: null,
      hashtags: [],
      creative_brief: "Week 12 draft",
      alt_text: "Week 12",
      short_video_script: null,
      recommended_publish_window: {
        starts_at: "2026-07-03T10:00:00.000Z",
        ends_at: "2026-07-03T12:00:00.000Z",
        timezone: "Africa/Cairo",
      },
      claim_sources: [],
      warnings: [],
      blockers: [],
      asset_required: false,
      asset_ids: [],
      generation_provenance: {
        generation_run_id: randomUUID(),
        provider_name: "schedule-test",
        provider_model: "fixture",
        generated_at: "2026-07-03T07:00:00.000Z",
      },
      created_at: "2026-07-03T07:00:00.000Z",
      version_checksum: "",
    };
    item.version_checksum = computeContentItemVersionChecksum(item);

    await packs.persistGeneratedItems({
      packId: week12.id,
      cycleId,
      weekNumber: 12,
      generationRunId: randomUUID(),
      items: [
        {
          id: item.id,
          contentItemId: item.content_item_id,
          channel: item.channel,
          format: item.format,
          languageMode: item.language_mode,
          strategyTrace: item.strategy_trace,
          captionVariants: item.caption_variants,
          cta: item.cta,
          hashtags: item.hashtags,
          creativeBrief: item.creative_brief,
          altText: item.alt_text,
          shortVideoScript: item.short_video_script,
          recommendedPublishWindow: item.recommended_publish_window,
          claimSources: item.claim_sources,
          warnings: item.warnings,
          blockers: item.blockers,
          assetRequired: item.asset_required,
          assetIds: item.asset_ids,
          generationProvenance: item.generation_provenance,
          versionChecksum: item.version_checksum,
          createdAt: new Date(item.created_at),
        },
      ],
      progressEvent: {
        stage: "ready",
        status: "complete",
        messageKey: "content.ready",
        messageText: "Week 12 draft ready.",
      },
      latencyMs: 1,
      startedAt: new Date("2026-07-03T07:00:00.000Z"),
      finishedAt: new Date("2026-07-03T07:00:00.001Z"),
    });

    const completed = await prisma.contentCycle.findUniqueOrThrow({
      where: { id: cycleId },
    });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();

    await expect(
      prisma.contentCycle.update({
        where: { id: cycleId },
        data: { week1StartDate: new Date("2026-04-11T00:00:00.000Z") },
      }),
    ).rejects.toThrow("week_1_start_date is immutable");
    const frozenWeek = await prisma.contentWeekContext.findUniqueOrThrow({
      where: {
        contentCycleId_weekNumber: { contentCycleId: cycleId, weekNumber: 1 },
      },
    });
    await expect(
      prisma.contentWeekContext.update({
        where: { id: frozenWeek.id },
        data: { mustInclude: ["tampered"] },
      }),
    ).rejects.toThrow("frozen content week context is immutable");
  });
});

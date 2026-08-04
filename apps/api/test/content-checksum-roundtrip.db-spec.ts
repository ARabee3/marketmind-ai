import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { ContentItemVersion } from "@marketmind/contracts";
import { computeContentItemVersionChecksum } from "@marketmind/contracts";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { normalizeAiContentItemVersion } from "../src/modules/content/content-item-version-normalizer";
import { toContentItemVersion } from "../src/modules/content/content.service";
import {
  ContentPackRepository,
  type ContentProgressInput,
  type PersistGeneratedItemsInput,
} from "../src/modules/content/repositories/content-pack.repository";

/**
 * Real PostgreSQL/Prisma checksum round-trip coverage for issue #110.
 *
 * Run with an isolated migrated DATABASE_URL:
 * `npm run test:db -w @marketmind/api -- content-checksum-roundtrip.db-spec.ts`
 */
const prisma = new PrismaClient();
const run = `checksum-${randomUUID()}`;
const ids = {
  user: randomUUID(),
  business: randomUUID(),
  profile: randomUUID(),
  strategy: randomUUID(),
  cycle: randomUUID(),
  context: randomUUID(),
  pack: randomUUID(),
  item: randomUUID(),
  baseVersion: randomUUID(),
  revisedVersion: randomUUID(),
  generationRun: randomUUID(),
  decision: randomUUID(),
  weeklyClaim: randomUUID(),
};

function providerItem(
  id: string,
  version: number,
  overrides: Record<string, unknown> = {},
): ContentItemVersion {
  const item = {
    id,
    contract_version: "content-v1" as const,
    content_item_id: ids.item,
    content_pack_id: ids.pack,
    version,
    channel: "instagram" as const,
    format: "text_post" as const,
    language_mode: "ar-EG" as const,
    strategy_trace: {
      strategy_id: ids.strategy,
      strategy_version: 1,
      week_number: 1,
      pillar_ids: [],
      objective: "awareness",
      channel: "instagram" as const,
    },
    caption_variants: [
      {
        locale: "ar" as const,
        caption: "خصم اليوم من متجر الاختبار.",
        cta: null,
        hashtags: ["#اختبار", "#القاهرة"],
      },
    ],
    cta: null,
    hashtags: ["#اختبار", "#القاهرة"],
    creative_brief: "Round-trip fixture",
    alt_text: "وصف اختبار",
    short_video_script: null,
    recommended_publish_window: {
      starts_at: "2026-08-01T07:05:06.123456+03:00",
      ends_at: "2026-08-01T09:05:06.123456+03:00",
      timezone: "Africa/Cairo" as const,
    },
    claim_sources: [],
    warnings: [],
    blockers: [],
    asset_required: false,
    asset_ids: [],
    generation_provenance: {
      generation_run_id: ids.generationRun,
      provider_name: "roundtrip-provider",
      provider_model: "roundtrip-model",
      generated_at: "2026-08-01T07:05:06.123456+03:00",
    },
    created_at: "2026-08-01T07:05:06.123456+03:00",
    ...overrides,
  };
  return {
    ...item,
    version_checksum: computeContentItemVersionChecksum(item),
  } as ContentItemVersion;
}

function draftInput(item: ContentItemVersion) {
  return {
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
  };
}

async function cleanup(): Promise<void> {
  await prisma.contentItemVersion.deleteMany({
    where: { contentPackId: ids.pack },
  });
  await prisma.contentItem.deleteMany({ where: { contentPackId: ids.pack } });
  await prisma.contentProgressEvent.deleteMany({
    where: { contentPackId: ids.pack },
  });
  await prisma.contentGenerationRun.deleteMany({
    where: { contentPackId: ids.pack },
  });
  await prisma.contentPack.deleteMany({ where: { id: ids.pack } });
  await prisma.contentWeekContext.deleteMany({ where: { id: ids.context } });
  await prisma.contentCycle.deleteMany({ where: { id: ids.cycle } });
  await prisma.businessProfileVersion.deleteMany({
    where: { id: ids.profile },
  });
  await prisma.business.deleteMany({ where: { id: ids.business } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

describe("Content item version checksum DB round-trip", () => {
  let repository: ContentPackRepository;

  beforeAll(async () => {
    await prisma.$connect();
    repository = new ContentPackRepository(prisma as unknown as PrismaService);

    await prisma.user.create({
      data: {
        id: ids.user,
        email: `${run}@example.test`,
        password: "not-used",
        fullName: "Checksum DB Test",
      },
    });
    await prisma.business.create({
      data: {
        id: ids.business,
        ownerUserId: ids.user,
        displayName: "Checksum DB Test Business",
        businessType: "retail",
        city: "Cairo",
      },
    });
    await prisma.businessProfileVersion.create({
      data: {
        id: ids.profile,
        businessId: ids.business,
        version: 1,
        profile: { business_name: "Checksum DB Test Business" },
        confirmedByUserId: ids.user,
      },
    });
    await prisma.contentCycle.create({
      data: {
        id: ids.cycle,
        contractVersion: "content-v1",
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 1,
        strategyDecisionId: ids.decision,
        profileVersionId: ids.profile,
        ownerUserId: ids.user,
        currentWeekNumber: 1,
        week1StartDate: new Date("2026-08-01T00:00:00.000Z"),
        nextGenerationAt: new Date("2026-08-08T00:00:00.000Z"),
        timezone: "Africa/Cairo",
        idempotencyKey: `${run}-cycle`,
      } as never,
    });
    await prisma.contentWeekContext.create({
      data: {
        id: ids.context,
        contractVersion: "content-v1",
        contentCycleId: ids.cycle,
        weekNumber: 1,
        weekStartDate: new Date("2026-08-01T00:00:00.000Z"),
        promotionMode: "none",
        mustInclude: [],
        mustAvoid: [],
        approvedAssetIds: [],
        ctaDestination: { type: "none", value: null },
        generationCutoffAt: new Date("2026-08-08T00:00:00.000Z"),
        weeklyClaimId: ids.weeklyClaim,
        contextSource: "system_defaulted",
        systemDefaultedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    await prisma.contentPack.create({
      data: {
        id: ids.pack,
        contractVersion: "content-v1",
        contentCycleId: ids.cycle,
        weeklyClaimId: ids.weeklyClaim,
        weekNumber: 1,
        businessId: ids.business,
        strategyId: ids.strategy,
        strategyVersion: 1,
        strategyDecisionId: ids.decision,
        profileVersionId: ids.profile,
        weekContextId: ids.context,
        status: "validating",
        retryEligible: false,
        itemIds: [],
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("persists generated version and revision with checksum-valid readbacks", async () => {
    const base = normalizeAiContentItemVersion(
      providerItem(ids.baseVersion, 1),
      {
        contentPackId: ids.pack,
        contentItemId: ids.item,
        version: 1,
        strategyId: ids.strategy,
        strategyVersion: 1,
        weekNumber: 1,
      },
    );
    const progressEvent: ContentProgressInput = {
      stage: "ready",
      status: "complete",
      messageKey: "content.ready",
      messageText: "Pack draft ready.",
    };
    const persistInput: PersistGeneratedItemsInput = {
      packId: ids.pack,
      cycleId: ids.cycle,
      weekNumber: 1,
      generationRunId: ids.generationRun,
      items: [draftInput(base)],
      progressEvent,
      providerName: "roundtrip-provider",
      providerModel: "roundtrip-model",
      latencyMs: 10,
      startedAt: new Date("2026-08-01T07:00:00.000Z"),
      finishedAt: new Date("2026-08-01T07:00:00.010Z"),
    };

    await repository.persistGeneratedItems(persistInput);

    const persistedBase = await prisma.contentItemVersion.findUniqueOrThrow({
      where: { id: ids.baseVersion },
    });
    const roundTrippedBase = toContentItemVersion(persistedBase);
    expect(roundTrippedBase.created_at).toBe("2026-08-01T04:05:06.123Z");
    expect(computeContentItemVersionChecksum(roundTrippedBase)).toBe(
      roundTrippedBase.version_checksum,
    );

    const revised = normalizeAiContentItemVersion(
      providerItem(ids.revisedVersion, 2, {
        creative_brief: "Round-trip revision",
      }),
      {
        contentPackId: ids.pack,
        contentItemId: ids.item,
        version: 2,
        strategyId: ids.strategy,
        strategyVersion: 1,
        weekNumber: 1,
      },
    );
    await repository.appendRevisedItemVersion({
      ...draftInput(revised),
      packId: ids.pack,
      itemId: ids.item,
      baseVersionId: ids.baseVersion,
      newVersionNumber: 2,
    });

    const persistedRevision = await prisma.contentItemVersion.findUniqueOrThrow(
      {
        where: { id: ids.revisedVersion },
      },
    );
    const roundTrippedRevision = toContentItemVersion(persistedRevision);
    expect(roundTrippedRevision.version).toBe(2);
    expect(computeContentItemVersionChecksum(roundTrippedRevision)).toBe(
      roundTrippedRevision.version_checksum,
    );
    expect(roundTrippedRevision.created_at).toBe("2026-08-01T04:05:06.123Z");
  });
});

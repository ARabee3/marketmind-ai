import { PrismaClient } from "@prisma/client";

/**
 * Marketing knowledge seed fixtures.
 *
 * Seven entries covering the lifecycle the eligibility/rebuild queries depend
 * on, plus one extra future-effective entry to exercise the eligibility
 * boundary. Idempotent: every entry is upserted by its slug and its first
 * version by `(entryId, version)`; re-running never duplicates.
 *
 * Run via the root `apps/api/prisma/seed.ts` (which calls this function).
 */
export async function seedMarketingKnowledge(
  prisma: PrismaClient,
): Promise<void> {
  const now = new Date();
  const past = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7);
  const future = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);

  // 1. draft — never eligible.
  const draftEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/draft-entry" },
    create: { slug: "fixture/draft-entry" },
    update: {},
  });
  await upsertVersion(prisma, {
    entryId: draftEntry.id,
    version: 1,
    kind: "framework",
    title: "Draft framework (never eligible)",
    summary: "A draft version that should never appear in eligible results.",
    body: "Draft body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["awareness"],
    funnelStages: ["awareness"],
    channels: ["facebook"],
    seasons: [],
    budgetModes: ["organic_only"],
    evidenceTier: "contextual_note",
    reviewStatus: "draft",
    effectiveAt: past,
    author: "fixture-author",
    checksum: "fixture:draft:v1",
  });

  // 2. approved, effective now, no expiry — eligible.
  const approvedEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/approved-entry" },
    create: { slug: "fixture/approved-entry" },
    update: {},
  });
  await upsertVersion(prisma, {
    entryId: approvedEntry.id,
    version: 1,
    kind: "channel_playbook",
    title: "Approved channel playbook (eligible)",
    summary: "An approved, currently-effective channel playbook.",
    body: "Approved body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["awareness", "acquisition"],
    funnelStages: ["awareness", "consideration"],
    channels: ["facebook", "instagram"],
    seasons: [],
    budgetModes: ["organic_only", "monthly_amount"],
    evidenceTier: "reviewed_guidance",
    reviewStatus: "approved",
    effectiveAt: past,
    expiresAt: null,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: past,
    checksum: "fixture:approved:v1",
  });

  // 3. retired — was approved, now superseded; not eligible.
  const retiredEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/retired-entry" },
    create: { slug: "fixture/retired-entry" },
    update: {},
  });
  await upsertVersion(prisma, {
    entryId: retiredEntry.id,
    version: 1,
    kind: "objective_playbook",
    title: "Retired objective playbook",
    summary: "Was approved, now retired; not eligible.",
    body: "Retired body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["services"],
    businessModels: [],
    objectives: ["retention"],
    funnelStages: ["retention"],
    channels: ["website"],
    seasons: [],
    budgetModes: ["organic_only"],
    evidenceTier: "contextual_note",
    reviewStatus: "retired",
    effectiveAt: past,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: past,
    checksum: "fixture:retired:v1",
  });

  // 4. expired — expires_at in the past; not eligible.
  const expiredEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/expired-entry" },
    create: { slug: "fixture/expired-entry" },
    update: {},
  });
  await upsertVersion(prisma, {
    entryId: expiredEntry.id,
    version: 1,
    kind: "regional_guidance",
    title: "Expired regional guidance",
    summary: "Expired; not eligible.",
    body: "Expired body.",
    locale: "en",
    markets: ["mena"],
    industries: ["general"],
    businessModels: [],
    objectives: ["awareness"],
    funnelStages: ["awareness"],
    channels: ["facebook"],
    seasons: [],
    budgetModes: ["organic_only"],
    evidenceTier: "contextual_note",
    reviewStatus: "approved",
    effectiveAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30),
    expiresAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1),
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30),
    checksum: "fixture:expired:v1",
  });

  // 5. superseded — two versions, old retired, new approved; only the new one eligible.
  const supersededEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/superseded-entry" },
    create: { slug: "fixture/superseded-entry" },
    update: { latestVersion: 2 },
  });
  await upsertVersion(prisma, {
    entryId: supersededEntry.id,
    version: 1,
    kind: "benchmark_report",
    title: "Superseded benchmark (old)",
    summary: "Old version, now retired by supersession.",
    body: "Old body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["conversion"],
    funnelStages: ["conversion"],
    channels: ["facebook"],
    seasons: ["ramadan"],
    budgetModes: ["monthly_amount"],
    evidenceTier: "verified_benchmark",
    reviewStatus: "retired",
    effectiveAt: past,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: past,
    checksum: "fixture:superseded:v1",
  });
  await upsertVersion(prisma, {
    entryId: supersededEntry.id,
    version: 2,
    kind: "benchmark_report",
    title: "Superseded benchmark (new, approved)",
    summary: "New version, approved and eligible.",
    body: "New body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["conversion"],
    funnelStages: ["conversion"],
    channels: ["facebook"],
    seasons: ["ramadan"],
    budgetModes: ["monthly_amount"],
    evidenceTier: "verified_benchmark",
    reviewStatus: "approved",
    effectiveAt: now,
    expiresAt: null,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: now,
    checksum: "fixture:superseded:v2",
  });

  // 6. multilingual — locale mixed, Arabic body.
  const multilingualEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/multilingual-entry" },
    create: { slug: "fixture/multilingual-entry" },
    update: {},
  });
  await upsertVersion(prisma, {
    entryId: multilingualEntry.id,
    version: 1,
    kind: "sector_note",
    title: "ملاحظة قطاعية ثنائية اللغة",
    summary: "Bilingual sector note with Arabic title.",
    body: "محتوى باللغة العربية للتأكد من أن النص يُخزَّن ويُسترجَع بدون تشويه (UTF-8).",
    locale: "mixed",
    markets: ["egypt"],
    industries: ["hospitality"],
    businessModels: [],
    objectives: ["retention"],
    funnelStages: ["retention"],
    channels: ["instagram"],
    seasons: ["ramadan"],
    budgetModes: ["organic_only"],
    evidenceTier: "reviewed_guidance",
    reviewStatus: "approved",
    effectiveAt: past,
    expiresAt: null,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: past,
    checksum: "fixture:multilingual:v1",
  });

  // 7. benchmark — verified_benchmark with a linked source ref.
  const benchmarkEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/benchmark-entry" },
    create: { slug: "fixture/benchmark-entry" },
    update: {},
  });
  const benchmarkVersion = await upsertVersion(prisma, {
    entryId: benchmarkEntry.id,
    version: 1,
    kind: "benchmark_report",
    title: "Benchmark report with citation",
    summary: "Verified benchmark with a linked source ref.",
    body: "Benchmark body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    businessModels: [],
    objectives: ["conversion", "acquisition"],
    funnelStages: ["conversion"],
    channels: ["facebook", "instagram"],
    seasons: [],
    budgetModes: ["monthly_amount", "three_month_amount"],
    evidenceTier: "verified_benchmark",
    reviewStatus: "approved",
    effectiveAt: past,
    expiresAt: null,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: past,
    checksum: "fixture:benchmark:v1",
  });
  // The compound unique (entry_version_id, reference) now exists, so a
  // single upsert by entryVersionId_reference keeps the benchmark citation
  // idempotent on re-run — no delete-then-create workaround needed.
  await prisma.marketingKnowledgeSourceRef.upsert({
    where: {
      entryVersionId_reference: {
        entryVersionId: benchmarkVersion.id,
        reference: "https://example.com/benchmark-q1-2026.pdf",
      },
    },
    update: { note: "Q1 2026 CPC benchmark — verified source." },
    create: {
      entryVersionId: benchmarkVersion.id,
      reference: "https://example.com/benchmark-q1-2026.pdf",
      note: "Q1 2026 CPC benchmark — verified source.",
    },
  });

  // 8. future-effective — approved but effective_at in the future; not yet eligible.
  const futureEffectiveEntry = await prisma.marketingKnowledgeEntry.upsert({
    where: { slug: "fixture/future-effective-entry" },
    create: { slug: "fixture/future-effective-entry" },
    update: {},
  });
  await upsertVersion(prisma, {
    entryId: futureEffectiveEntry.id,
    version: 1,
    kind: "content_strategy_playbook",
    title: "Future-effective content playbook",
    summary: "Approved but not effective yet; not eligible.",
    body: "Future body.",
    locale: "en",
    markets: ["egypt"],
    industries: ["education"],
    businessModels: [],
    objectives: ["launch"],
    funnelStages: ["awareness"],
    channels: ["tiktok"],
    seasons: [],
    budgetModes: ["organic_only"],
    evidenceTier: "reviewed_guidance",
    reviewStatus: "approved",
    effectiveAt: future,
    expiresAt: null,
    author: "fixture-author",
    reviewer: "fixture-reviewer",
    reviewedAt: now,
    checksum: "fixture:future-effective:v1",
  });

  console.log("Seeded marketing knowledge fixtures (7 lifecycle + 1 boundary).");
}

type VersionSeed = {
  entryId: string;
  version: number;
  kind: string;
  title: string;
  summary: string;
  body: string;
  locale: string;
  markets: string[];
  industries: string[];
  businessModels: string[];
  objectives: string[];
  funnelStages: string[];
  channels: string[];
  seasons: string[];
  budgetModes: string[];
  evidenceTier: string;
  reviewStatus: string;
  effectiveAt: Date;
  expiresAt?: Date | null;
  author: string;
  reviewer?: string;
  reviewedAt?: Date;
  checksum: string;
};

async function upsertVersion(
  prisma: PrismaClient,
  v: VersionSeed,
) {
  const existing = await prisma.marketingKnowledgeEntryVersion.findUnique({
    where: { entryId_version: { entryId: v.entryId, version: v.version } },
  });
  if (existing) {
    // The trigger forbids mutating approved content; for fixtures we never
    // mutate content, only (re-)assert lifecycle fields. Return as-is to keep
    // the seed idempotent on re-run.
    return existing;
  }
  return prisma.marketingKnowledgeEntryVersion.create({
    data: {
      entryId: v.entryId,
      version: v.version,
      kind: v.kind,
      title: v.title,
      summary: v.summary,
      body: v.body,
      locale: v.locale,
      markets: v.markets,
      industries: v.industries,
      businessModels: v.businessModels,
      objectives: v.objectives,
      funnelStages: v.funnelStages,
      channels: v.channels,
      seasons: v.seasons,
      budgetModes: v.budgetModes,
      evidenceTier: v.evidenceTier,
      reviewStatus: v.reviewStatus,
      effectiveAt: v.effectiveAt,
      expiresAt: v.expiresAt ?? null,
      author: v.author,
      reviewer: v.reviewer ?? null,
      reviewedAt: v.reviewedAt ?? null,
      checksum: v.checksum,
    },
  });
}
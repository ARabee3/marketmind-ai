import { PrismaClient } from "@prisma/client";

/**
 * Database-level integration tests for the marketing knowledge governance
 * schema (issue #69, plan §10).
 *
 * These exercise the real PostgreSQL CHECK constraints, the immutability
 * trigger, the eligibility boundary semantics, and the Qdrant rebuild
 * export shape. They run against a live database with the
 * `add_marketing_knowledge_governance` migration applied, using a unique
 * `dbtest/<run>` slug prefix and cleaning up after each run.
 *
 * Run with: `npm run test:db` (separate jest config; NOT part of `npm test`
 * so DB-less CI stays green). Requires DATABASE_URL pointing at a migrated
 * database.
 */
const prisma = new PrismaClient();

const RUN = `dbtest/${Date.now()}`;
const NOW = new Date();
const PAST = new Date(NOW.getTime() - 1000 * 60 * 60 * 24);
const FUTURE = new Date(NOW.getTime() + 1000 * 60 * 60 * 24);

function validVersion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "benchmark_report",
    title: "DB test",
    summary: "DB test summary",
    body: "DB test body",
    locale: "en",
    markets: ["egypt"],
    industries: ["retail"],
    business_models: [],
    objectives: ["conversion"],
    funnel_stages: ["conversion"],
    channels: ["facebook"],
    seasons: [],
    budget_modes: ["monthly_amount"],
    evidence_tier: "verified_benchmark",
    review_status: "approved",
    effective_at: PAST,
    expires_at: null,
    author: "db-tester",
    reviewer: "db-reviewer",
    reviewed_at: PAST,
    checksum: `chk-${RUN}`,
    ...overrides,
  };
}

async function makeEntry(slug: string) {
  return prisma.marketingKnowledgeEntry.create({ data: { slug } });
}

async function insertVersionRaw(entryId: string, data: Record<string, unknown>) {
  await prisma.$executeRaw`INSERT INTO marketing_knowledge_entry_versions
    (id, entry_id, version, kind, title, summary, body, locale, markets, industries,
     business_models, objectives, funnel_stages, channels, seasons, budget_modes,
     evidence_tier, review_status, effective_at, expires_at, author, reviewer,
     reviewed_at, checksum)
    VALUES (gen_random_uuid(), ${entryId}::uuid, ${data.version}::int,
      ${data.kind}::text, ${data.title}::text, ${data.summary}::text, ${data.body}::text,
      ${data.locale}::text, ${data.markets}::text[], ${data.industries}::text[],
      ${data.business_models}::text[], ${data.objectives}::text[], ${data.funnel_stages}::text[],
      ${data.channels}::text[], ${data.seasons}::text[], ${data.budget_modes}::text[],
      ${data.evidence_tier}::text, ${data.review_status}::text,
      ${data.effective_at}::timestamptz, ${data.expires_at}::timestamptz,
      ${data.author}::text, ${data.reviewer}::text, ${data.reviewed_at}::timestamptz,
      ${data.checksum}::text)`;
}

async function cleanup() {
  await prisma.marketingKnowledgeEntryVersion.deleteMany({
    where: { entry: { slug: { startsWith: RUN } } },
  });
  await prisma.marketingKnowledgeEntry.deleteMany({
    where: { slug: { startsWith: RUN } },
  });
}

describe("Marketing knowledge governance DB (issue #69)", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe("CHECK constraints", () => {
    let entryId: string;

    beforeAll(async () => {
      entryId = (await makeEntry(`${RUN}/constraints`)).id;
    });

    it("rejects an invalid review_status", async () => {
      await expect(
        insertVersionRaw(
          entryId,
          validVersion({ review_status: "nonsense", version: 1, reviewer: null, reviewed_at: null }),
        ),
      ).rejects.toThrow(/chk_mkv_review_status/);
    });

    it("rejects an invalid evidence_tier", async () => {
      await expect(
        insertVersionRaw(
          entryId,
          validVersion({ evidence_tier: "guess", version: 2, reviewer: null, reviewed_at: null, review_status: "draft" }),
        ),
      ).rejects.toThrow(/chk_mkv_evidence_tier/);
    });

    it("rejects an invalid locale", async () => {
      await expect(
        insertVersionRaw(
          entryId,
          validVersion({ locale: "fr-FR", version: 3, reviewer: null, reviewed_at: null, review_status: "draft" }),
        ),
      ).rejects.toThrow(/chk_mkv_locale/);
    });

    it("rejects expires_at <= effective_at", async () => {
      await expect(
        insertVersionRaw(
          entryId,
          validVersion({
            review_status: "draft",
            reviewer: null,
            reviewed_at: null,
            version: 4,
            effective_at: NOW,
            expires_at: NOW,
          }),
        ),
      ).rejects.toThrow(/chk_mkv_expiry_after_effective/);
    });

    it("rejects review_status = approved without reviewer", async () => {
      await expect(
        insertVersionRaw(
          entryId,
          validVersion({ review_status: "approved", reviewer: null, reviewed_at: null, version: 5 }),
        ),
      ).rejects.toThrow(/chk_mkv_approved_has_reviewer/);
    });
  });

  describe("immutability trigger", () => {
    let entryId: string;
    let approvedVersionId: string;

    beforeAll(async () => {
      entryId = (await makeEntry(`${RUN}/immutability`)).id;
      const v = await prisma.marketingKnowledgeEntryVersion.create({
        data: {
          entryId,
          version: 1,
          kind: "benchmark_report",
          title: "immutable title",
          summary: "s",
          body: "b",
          locale: "en",
          markets: ["egypt"],
          industries: ["retail"],
          businessModels: [],
          objectives: ["conversion"],
          funnelStages: ["conversion"],
          channels: ["facebook"],
          seasons: [],
          budgetModes: ["monthly_amount"],
          evidenceTier: "verified_benchmark",
          reviewStatus: "approved",
          effectiveAt: PAST,
          expiresAt: null,
          author: "db-tester",
          reviewer: "db-reviewer",
          reviewedAt: PAST,
          checksum: "immutable-chk",
        } as never,
      });
      approvedVersionId = v.id;
    });

    it("blocks mutating the body of an approved version", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE marketing_knowledge_entry_versions SET body='changed' WHERE id = $1::uuid`,
          approvedVersionId,
        ),
      ).rejects.toThrow(/cannot mutate content of an approved version/);
    });

    it("blocks reverting an approved version to draft", async () => {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE marketing_knowledge_entry_versions SET review_status='draft' WHERE id = $1::uuid`,
          approvedVersionId,
        ),
      ).rejects.toThrow(/cannot revert an approved version back to draft/);
    });

    it("permits moving an approved version to retired", async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE marketing_knowledge_entry_versions SET review_status='retired' WHERE id = $1::uuid`,
        approvedVersionId,
      );
      const row = await prisma.marketingKnowledgeEntryVersion.findUnique({
        where: { id: approvedVersionId },
        select: { reviewStatus: true },
      });
      expect(row?.reviewStatus).toBe("retired");
    });
  });

  describe("source ref unique constraint", () => {
    let entryId: string;

    beforeAll(async () => {
      entryId = (await makeEntry(`${RUN}/source-ref-unique`)).id;
    });

    it("rejects a duplicate (entry_version_id, reference) pair with P2002", async () => {
      const version = await prisma.marketingKnowledgeEntryVersion.create({
        data: {
          entryId,
          version: 1,
          kind: "benchmark_report",
          title: "source ref unique",
          summary: "s",
          body: "b",
          locale: "en",
          markets: ["egypt"],
          industries: ["retail"],
          businessModels: [],
          objectives: ["conversion"],
          funnelStages: ["conversion"],
          channels: ["facebook"],
          seasons: [],
          budgetModes: ["monthly_amount"],
          evidenceTier: "verified_benchmark",
          reviewStatus: "approved",
          effectiveAt: PAST,
          expiresAt: null,
          author: "db-tester",
          reviewer: "db-reviewer",
          reviewedAt: PAST,
          checksum: "source-ref-unique-chk",
        } as never,
      });

      await prisma.marketingKnowledgeSourceRef.create({
        data: {
          entryVersionId: version.id,
          reference: "https://example.com/duplicate-citation.pdf",
          note: "first insert",
        },
      });

      await expect(
        prisma.marketingKnowledgeSourceRef.create({
          data: {
            entryVersionId: version.id,
            reference: "https://example.com/duplicate-citation.pdf",
            note: "second insert should fail",
          },
        }),
      ).rejects.toMatchObject({
        code: "P2002",
        message: expect.stringMatching(/Unique constraint/),
      });
    });
  });

  describe("eligibility boundary", () => {
    let entryId: string;
    let versionCounter = 100;

    beforeAll(async () => {
      entryId = (await makeEntry(`${RUN}/boundary`)).id;
    });

    async function statusOf(reviewStatus: string, effectiveAt: Date, expiresAt: Date | null) {
      const version = versionCounter++;
      const v = await prisma.marketingKnowledgeEntryVersion.create({
        data: {
          entryId,
          version,
          kind: "framework",
          title: `boundary-${version}`,
          summary: "s",
          body: "b",
          locale: "en",
          markets: [],
          industries: [],
          businessModels: [],
          objectives: [],
          funnelStages: [],
          channels: [],
          seasons: [],
          budgetModes: [],
          evidenceTier: "contextual_note",
          reviewStatus,
          effectiveAt,
          expiresAt,
          author: "db-tester",
          reviewer: reviewStatus === "approved" ? "r" : null,
          reviewedAt: reviewStatus === "approved" ? effectiveAt : null,
          checksum: `b-${version}-${effectiveAt.getTime()}`,
        } as never,
      });

      const eligible = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM marketing_knowledge_entry_versions
        WHERE id = ${v.id}::uuid
          AND review_status = 'approved'
          AND effective_at <= NOW()
          AND (expires_at IS NULL OR expires_at > NOW())`;
      return Number(eligible[0].count) === 1;
    }

    it("approved, effective now, no expiry → eligible", async () => {
      expect(await statusOf("approved", PAST, null)).toBe(true);
    });

    it("approved, effective exactly now (<=) → eligible", async () => {
      expect(await statusOf("approved", NOW, null)).toBe(true);
    });

    it("approved, effective one second in the future → not eligible", async () => {
      const soon = new Date(Date.now() + 1000);
      expect(await statusOf("approved", soon, null)).toBe(false);
    });

    it("approved, expires_at exactly now (>) → not eligible", async () => {
      const exp = new Date();
      expect(await statusOf("approved", PAST, exp)).toBe(false);
    });

    it("approved, expires_at one second in the future → still eligible", async () => {
      const exp = new Date(Date.now() + 1000);
      expect(await statusOf("approved", PAST, exp)).toBe(true);
    });

    it("draft → not eligible", async () => {
      expect(await statusOf("draft", PAST, null)).toBe(false);
    });
  });

  describe("Qdrant rebuild export shape", () => {
    it("returns rows with the exact QdrantKnowledgePoint field names and order", async () => {
      const entryId = (await makeEntry(`${RUN}/rebuild`)).id;
      const version = await prisma.marketingKnowledgeEntryVersion.create({
        data: {
          entryId,
          version: 1,
          kind: "benchmark_report",
          title: "rebuild",
          summary: "s",
          body: "b",
          locale: "mixed",
          markets: ["egypt"],
          industries: ["retail"],
          businessModels: [],
          objectives: ["conversion"],
          funnelStages: ["conversion"],
          channels: ["facebook"],
          seasons: [],
          budgetModes: ["monthly_amount"],
          evidenceTier: "verified_benchmark",
          reviewStatus: "approved",
          effectiveAt: PAST,
          expiresAt: null,
          author: "db-tester",
          reviewer: "db-reviewer",
          reviewedAt: PAST,
          checksum: "rebuild-chk",
        } as never,
      });
      await prisma.marketingKnowledgeChunk.create({
        data: {
          entryVersionId: version.id,
          chunkOrder: 0,
          text: "chunk body",
          tokenCount: 2,
          checksum: "rebuild-chunk-chk",
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDimensions: 1536,
          embeddingVersion: "v1",
        } as never,
      });

      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT
          c.id AS chunk_id, e.id AS entry_id, v.version AS entry_version,
          c.checksum, c.text, v.kind, v.locale, v.markets, v.industries,
          v.business_models, v.objectives, v.funnel_stages, v.channels,
          v.seasons, v.budget_modes, v.evidence_tier, v.review_status,
          v.effective_at, v.expires_at
        FROM marketing_knowledge_chunks c
        JOIN marketing_knowledge_entry_versions v ON v.id = c.entry_version_id
        JOIN marketing_knowledge_entries e ON e.id = v.entry_id
        WHERE e.slug LIKE ${RUN + "%"} AND v.review_status = 'approved'
          AND v.effective_at <= NOW()
          AND (v.expires_at IS NULL OR v.expires_at > NOW())`;

      expect(rows.length).toBeGreaterThanOrEqual(1);
      const keys = Object.keys(rows[0]);
      expect(keys).toEqual([
        "chunk_id",
        "entry_id",
        "entry_version",
        "checksum",
        "text",
        "kind",
        "locale",
        "markets",
        "industries",
        "business_models",
        "objectives",
        "funnel_stages",
        "channels",
        "seasons",
        "budget_modes",
        "evidence_tier",
        "review_status",
        "effective_at",
        "expires_at",
      ]);
    });
  });
});
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * PostgreSQL verification for Performance 1. The suite only runs against a
 * dedicated database whose name ends in _test, _ci, or _e2e; the CI database
 * is recreated for every job. It proves the migration's uniqueness and
 * immutability backstops with real Prisma/PostgreSQL operations.
 */
const databaseUrl = String(process.env.DATABASE_URL ?? "");
const databaseName = databaseUrl.split("/").pop()?.split("?")[0] ?? "";
const safeDatabase = /_(test|ci|e2e)$/i.test(databaseName);
const describeDatabase = safeDatabase ? describe : describe.skip;

const prisma = new PrismaClient();
const ids = {
  user: randomUUID(),
  business: randomUUID(),
  candidate: randomUUID(),
  intent: randomUUID(),
  attempt: randomUUID(),
  result: randomUUID(),
  syncWindow: randomUUID(),
  snapshot: randomUUID(),
  replaySnapshot: randomUUID(),
  concurrentSnapshotA: randomUUID(),
  concurrentSnapshotB: randomUUID(),
};
const publishedAt = new Date("2026-08-18T08:00:00.000Z");
const dueAt = new Date("2026-08-19T08:00:00.000Z");
const fetchedAt = new Date("2026-08-19T08:01:12.000Z");
const checksum =
  "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0";

function snapshotData(id: string, window: "24h" | "72h" = "24h") {
  return {
    id,
    businessId: ids.business,
    publishingResultId: ids.result,
    publishingAttemptId: ids.attempt,
    publishingIntentId: ids.intent,
    candidateId: ids.candidate,
    candidateChecksum: checksum,
    provider: "facebook",
    providerObjectId: "page-123_post-456",
    window,
    publishedAt,
    dueAt,
    observedAt: new Date("2026-08-19T08:01:00.000Z"),
    fetchedAt,
    graphVersion: "v21.0",
    metricSchemaVersion: "facebook-insights-v1",
    metrics: {
      post_media_view: { status: "available", value: 0 },
      post_total_media_view_unique: {
        status: "unavailable",
        reason: "not_returned",
      },
      post_clicks: { status: "available", value: 14 },
    },
    providerMetadata: {
      source: "meta_insights",
      response_metric_count: 2,
      response_periods: ["lifetime"],
    },
    createdAt: fetchedAt,
  };
}

describeDatabase("Performance 1 migration + PostgreSQL invariants", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ids.user,
        email: `${ids.user}@performance.test`,
        password: "not-a-real-password",
        fullName: "Performance DB Test",
      },
    });
    await prisma.business.create({
      data: {
        id: ids.business,
        ownerUserId: ids.user,
        displayName: "Performance DB Test",
        businessType: "retail",
        city: "Cairo",
      },
    });
    await prisma.publishingCandidate.create({
      data: {
        id: ids.candidate,
        businessId: ids.business,
        externalContentId: `performance-${ids.candidate}`,
        candidateChecksum: checksum,
        eventFingerprint: `performance-event-${ids.candidate}`,
        eventId: randomUUID(),
        sourceStatus: { contract_version: "publication-candidate-status-v1" },
        payload: {
          content_item_version_id: randomUUID(),
          target_channel: "facebook",
          caption: "caption remains in the frozen candidate only",
        },
        channel: "facebook",
        format: "text_post",
      },
    });
    await prisma.publishingIntent.create({
      data: {
        id: ids.intent,
        businessId: ids.business,
        candidateId: ids.candidate,
        mode: "REAL",
        status: "SUCCEEDED",
        version: 1,
        createdByUserId: ids.user,
      },
    });
    await prisma.publishingAttempt.create({
      data: {
        id: ids.attempt,
        intentId: ids.intent,
        intentVersion: 1,
        attemptSequence: 1,
        status: "SUCCEEDED",
        idempotencyKey: `performance-attempt-${ids.attempt}`,
      },
    });
    await prisma.publishingResult.create({
      data: {
        id: ids.result,
        attemptId: ids.attempt,
        intentId: ids.intent,
        outcome: "PUBLISHED",
        provider: "meta",
        remotePublicationId: "page-123_post-456",
        retryable: false,
        occurredAt: publishedAt,
      },
    });
  });

  afterAll(async () => {
    // The immutable snapshot trigger intentionally prevents row cleanup. The
    // CI database is disposable; retaining this random fixture also avoids
    // weakening the production immutability boundary for test teardown.
    await prisma.$disconnect();
  });

  it("applies the migration objects and keeps payload out of metric_snapshots", async () => {
    const tables = (await prisma.$queryRawUnsafe(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('performance_sync_windows','metric_snapshots') ORDER BY table_name`,
    )) as { table_name: string }[];
    expect(tables.map((row) => row.table_name)).toEqual([
      "metric_snapshots",
      "performance_sync_windows",
    ]);

    const columns = (await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'metric_snapshots'`,
    )) as { column_name: string }[];
    const names = columns.map((column) => column.column_name);
    expect(names).toContain("candidate_id");
    expect(names).toContain("candidate_checksum");
    expect(names).not.toContain("payload");
    expect(names).not.toContain("caption");
  });

  it("enforces one sync window and one snapshot per result/window", async () => {
    await prisma.performanceSyncWindow.create({
      data: {
        id: ids.syncWindow,
        businessId: ids.business,
        publishingResultId: ids.result,
        provider: "facebook",
        window: "24h",
        dueAt,
      },
    });
    await expect(
      prisma.performanceSyncWindow.create({
        data: {
          id: randomUUID(),
          businessId: ids.business,
          publishingResultId: ids.result,
          provider: "facebook",
          window: "24h",
          dueAt,
        },
      }),
    ).rejects.toThrow(/P2002|unique/i);

    await prisma.metricSnapshot.create({ data: snapshotData(ids.snapshot) });
    await expect(
      prisma.metricSnapshot.create({ data: snapshotData(ids.replaySnapshot) }),
    ).rejects.toThrow(/P2002|unique/i);
  });

  it("rejects concurrent snapshot inserts and preserves numeric zero", async () => {
    const results = await Promise.allSettled([
      prisma.metricSnapshot.create({
        data: snapshotData(ids.concurrentSnapshotA, "72h"),
      }),
      prisma.metricSnapshot.create({
        data: snapshotData(ids.concurrentSnapshotB, "72h"),
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const row = await prisma.metricSnapshot.findUnique({
      where: {
        publishingResultId_window: {
          publishingResultId: ids.result,
          window: "24h",
        },
      },
    });
    expect(row?.metrics).toMatchObject({
      post_media_view: { status: "available", value: 0 },
    });
  });

  it("rejects UPDATE and DELETE through the immutable snapshot trigger", async () => {
    await expect(
      prisma.metricSnapshot.update({
        where: { id: ids.snapshot },
        data: { providerObjectId: "tampered" },
      }),
    ).rejects.toThrow(/metric_snapshots are immutable/i);
    await expect(
      prisma.metricSnapshot.delete({ where: { id: ids.snapshot } }),
    ).rejects.toThrow(/metric_snapshots are immutable/i);
  });

  it("keeps the migration forward-only and documents its trigger backstop", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "prisma",
        "migrations",
        "20260818120000_add_performance_contracts",
        "migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("metric_snapshots_immutable");
    expect(migration).toContain(
      "performance_sync_windows_publishing_result_id_window_key",
    );
    expect(migration).toContain(
      "metric_snapshots_publishing_result_id_window_key",
    );
  });
});

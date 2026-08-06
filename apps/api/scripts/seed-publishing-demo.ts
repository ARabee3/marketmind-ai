/**
 * Publishing demo seed — boots a complete, real candidate → intent → approval
 * chain straight into Postgres and enqueues the BullMQ dispatch job, so the
 * whole publishing pipeline (#120 / #121) is triggerable end-to-end from a
 * clean environment with one command.
 *
 * Run: `npm run seed:publishing-demo` (from apps/api)
 *
 * Design notes (PLAN.md Phase 2):
 *  - Each run mints FRESH candidate/event/intent/approval ids so re-running never
 *    trips the one-intent-per-candidate partial unique index or any event
 *    fingerprint dedup. The Meta target row is upserted by a FIXED id so the
 *    connected Page target is stable across runs (the same row the intents bind).
 *  - The candidate payload is built to satisfy the frozen
 *    `validatePublicationCandidateV1` contract and carries the committed demo
 *    asset (asset_id + real SHA-256) read from the SAME manifest the internal
 *    asset route + dispatch integrity validator use — single source of truth.
 *  - `credential_ref` is an opaque pointer (`env:META_TEST_PAGE_ACCESS_TOKEN`);
 *    the real Meta adapter in n8n resolves the token from its own env (Phase 3),
 *    never from the dispatch body.
 *  - The intent goes DRAFT → schedule (AWAITING_APPROVAL, v2) → approve
 *    (SCHEDULED) and the BullMQ dispatch job is enqueued with ~10s delay, mirroring
 *    `IntentsService.approveIntent`'s enqueue (idempotency key `…::dispatch`,
 *    jobId `publish:<intent>:<version>`). The running API's
 *    `DispatchProcessor` worker consumes it.
 *
 * This script writes to Postgres and Redis ONLY — it never calls a provider.
 * Idempotent: safe to re-run; each run leaves a fresh terminal intent + a real
 * attempt that the worker drives to SUCCEEDED/FAILED.
 */
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

import { PrismaClient, Prisma } from "@prisma/client";
import { Queue } from "bullmq";
import {
  computePublicationCandidateChecksum,
  computePublicationApprovalFingerprint,
  computePublishingSha256,
  validatePublicationCandidateV1,
  type PublicationCandidateV1,
  type PublicationCandidateStatusV1,
} from "@marketmind/contracts";

// ── Load environment (Prisma client + BullMQ need process.env) ──────────────
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const QUEUE_NAME = "publishing-dispatch";
const DEMO_TARGET_ID = "11111111-2222-4111-8111-111111111111";
const ASSET_MANIFEST_PATH = path.resolve(
  process.cwd(),
  "test-assets/publishing/manifest.json",
);
const DEMO_ASSET_ID = "11111111-1111-4111-8111-111111111111";

/** Stable, recognizable UUIDs for the non-dedup content ancestry fields. The
 *  candidate reducer only requires these be non-empty strings; no FK binds them. */
const DEMO_STRATEGY_ID = crypto.randomUUID();
const DEMO_CYCLE_ID = crypto.randomUUID();
const DEMO_PACK_ID = crypto.randomUUID();
const DEMO_ITEM_ID = crypto.randomUUID();

const uuid = () => crypto.randomUUID();
const sha256 = (s: string) =>
  crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** Naive "YYYY-MM-DDTHH:mm:ss" Cairo wall-clock for a UTC instant — mirrors the
 *  dispatch envelope builder's deterministic rendering. */
function naiveCairoLocal(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${h}:${get("minute")}:${get("second")}`;
}

interface DemoAsset {
  readonly asset_id: string;
  readonly checksum: string;
  readonly mime_type: string;
}

function loadDemoAsset(): DemoAsset {
  const manifest = JSON.parse(fs.readFileSync(ASSET_MANIFEST_PATH, "utf8")) as {
    assets: Record<string, { checksum: string; mime_type: string }>;
  };
  const entry = manifest.assets[DEMO_ASSET_ID];
  if (!entry) {
    throw new Error(
      `Demo asset ${DEMO_ASSET_ID} missing from ${ASSET_MANIFEST_PATH}`,
    );
  }
  return {
    asset_id: DEMO_ASSET_ID,
    checksum: entry.checksum,
    mime_type: entry.mime_type,
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  // Resolve a real business + owner (or accept overrides) so the demo lives
  // against a truthful owner record rather than a synthetic one.
  const business = await prisma.business.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, ownerUserId: true },
  });
  if (!business) {
    throw new Error(
      "No business found in the DB — create an owner + business first (run the normal onboarding) before seeding the publishing demo.",
    );
  }
  const businessId = business.id;
  const ownerId = business.ownerUserId;

  // Zero-credentials mode: when META_TEST_PAGE_ID is empty the demo must stay
  // fully local — seed a MANUAL_EXPORT + a SIMULATION intent instead of the
  // real-mode leg (no target row, no approval, no BullMQ job, no provider).
  const metaPageId = process.env.META_TEST_PAGE_ID ?? "";
  const zeroCredentials = !metaPageId;
  if (!zeroCredentials) {
    console.log(`Real-mode demo target will use Meta Page ${metaPageId}`);
  }

  const asset = loadDemoAsset();
  const now = new Date();
  const scheduledUtc = new Date(now.getTime() + 10_000); // now + 10s
  const scheduledLocal = naiveCairoLocal(scheduledUtc);

  const buildCandidate = (): {
    candidate: PublicationCandidateV1;
    sourceStatus: PublicationCandidateStatusV1;
    createdEvent: { event_id: string; event_type: string; occurred_at: string; correlation_id: string; payload: PublicationCandidateV1 };
    eventFingerprint: string;
    eventId: string;
    contentItemVersionId: string;
    occurredAt: string;
    decidedAt: string;
    candidateId: string;
  } => {
    const contentItemVersionId = uuid();
    const contentItemVersionChecksum = sha256(`demo-content:${contentItemVersionId}`);
    const candidateId = uuid();
    const eventId = uuid();
    const occurredAt = new Date().toISOString();
    const approvalDecisionId = uuid();
    const decidedAt = new Date().toISOString();

    const candidatePayload: PublicationCandidateV1 = {
      contract_version: "publication-candidate-v1",
      candidate_id: candidateId,
      business_id: businessId,
      strategy_id: DEMO_STRATEGY_ID,
      strategy_version: 1,
      content_cycle_id: DEMO_CYCLE_ID,
      strategy_week_number: 1,
      content_pack_id: DEMO_PACK_ID,
      content_item_id: DEMO_ITEM_ID,
      content_item_version_id: contentItemVersionId,
      content_item_version: 1,
      content_item_version_checksum: contentItemVersionChecksum,
      target_channel: "facebook",
      content_format: "static_image_post",
      selected_locale: "ar",
      caption:
        "حلويات حلوانى العبد… طعم أصيل يذكّرك بالبيت 🍮\nزوروا فرعنا بقنا ورقم الاستقبال 10071.\n#حلوانى_العبد #حلويات_مصرية #قنا",
      cta: "زوروا الفرع اليوم",
      hashtags: ["#حلوانى_العبد", "#حلويات_مصرية", "#قنا"],
      alt_text: "صورة تسويقية لمنشور حلوانى العبد على فيسبوك",
      assets: [
        {
          asset_id: asset.asset_id,
          kind: "generated_static",
          mime_type: asset.mime_type,
          storage_key: "demo-static-image.png",
          checksum: asset.checksum,
        },
      ],
      recommended_publish_window: {
        starts_at: now.toISOString(),
        ends_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        timezone: "Africa/Cairo",
      },
      approval: {
        decision_id: approvalDecisionId,
        decision: "approved",
        content_item_version_id: contentItemVersionId,
        content_item_version_checksum: contentItemVersionChecksum,
        decided_by_user_id: ownerId,
        decided_at: decidedAt,
      },
      candidate_checksum: "", // stamped below
      created_at: occurredAt,
    };
    // Compute the frozen candidate checksum over the canonical payload (excludes
    // candidate_checksum itself) and re-validate against the frozen contract.
    const candidateChecksum = computePublicationCandidateChecksum(
      candidatePayload as PublicationCandidateV1,
    );
    const candidate: PublicationCandidateV1 = {
      ...candidatePayload,
      candidate_checksum: candidateChecksum,
    };
    const validation = validatePublicationCandidateV1(candidate);
    if (!validation.valid) {
      throw new Error(
        `Seed candidate failed frozen validation: ${validation.issues
          .map((i) => `${i.code}@${i.field}: ${i.message}`)
          .join("; ")}`,
      );
    }

    // The active source status snapshot the dispatch envelope builder sends.
    const sourceStatus: PublicationCandidateStatusV1 = {
      contract_version: "publication-candidate-status-v1",
      candidate_id: candidateId,
      business_id: businessId,
      candidate_checksum: candidateChecksum,
      state_version: 1,
      candidate_state: "active",
      replacement_candidate_id: null,
      changed_by_user_id: null,
      changed_at: occurredAt,
    };

    // The created event + its fingerprint (the candidate dedup key).
    const createdEvent = {
      event_id: eventId,
      event_type: "content.publication_candidate.created.v1",
      occurred_at: occurredAt,
      correlation_id: eventId,
      payload: candidate,
    };
    const eventFingerprint = computePublishingSha256(createdEvent);

    return {
      candidate,
      sourceStatus,
      createdEvent,
      eventFingerprint,
      eventId,
      contentItemVersionId,
      occurredAt,
      decidedAt,
      candidateId,
    };
  };

  if (zeroCredentials) {
    // ── Zero-credentials mode: export + simulation legs, fully local ─────────
    const ids: Record<string, string> = {};
    for (const mode of ["MANUAL_EXPORT", "SIMULATION"] as const) {
      const {
        candidate,
        sourceStatus,
        createdEvent,
        eventFingerprint,
        eventId,
        contentItemVersionId,
        occurredAt,
        candidateId,
      } = buildCandidate();

      // Persist candidate (direct insert — mirrors CandidatesService.ingest)
      await prisma.publishingCandidate.create({
        data: {
          id: candidateId,
          businessId,
          externalContentId: contentItemVersionId,
          candidateChecksum: candidate.candidate_checksum,
          eventFingerprint,
          eventId,
          status: "ACTIVE",
          sourceStatus: sourceStatus as unknown as Prisma.InputJsonValue,
          payload: candidate as unknown as Prisma.InputJsonValue,
          channel: "facebook",
          format: "static_image_post",
          locale: "ar",
          strategyWeekNumber: 1,
          sourceStateVersion: 1,
        },
      });
      console.log(`✓ Candidate ${candidateId} (${mode})`);

      // DRAFT intent — dispatch-export / dispatch-simulation are synchronous
      // local actions and need no approval, target, or queue job.
      const intentId = uuid();
      await prisma.publishingIntent.create({
        data: {
          id: intentId,
          businessId,
          candidateId,
          mode,
          status: "DRAFT",
          createdByUserId: ownerId,
          idempotencyKey: `seed:create:${intentId}`,
        },
      });
      console.log(`✓ Intent ${intentId} DRAFT (${mode})`);
      ids[mode === "MANUAL_EXPORT" ? "intentExportId" : "intentSimulationId"] =
        intentId;
    }
    console.log("");
    console.log("Zero-credentials demo seed complete. With the API running,");
    console.log("approve-free local actions drive both legs to their terminal");
    console.log("states — nothing touches a provider or a BullMQ queue:");
    console.log(
      `  POST /api/v1/publication-intents/<id>/dispatch-export     (owner JWT)`,
    );
    console.log(
      `  POST /api/v1/publication-intents/<id>/dispatch-simulation (owner JWT)`,
    );
    console.log("");
    console.log(
      JSON.stringify(
        { businessId, mode: "zero-credentials", ...ids },
        null,
        2,
      ),
    );
    return;
  }

  const {
    candidate,
    sourceStatus,
    createdEvent,
    eventFingerprint,
    eventId,
    contentItemVersionId,
    occurredAt,
    decidedAt,
    candidateId,
  } = buildCandidate();

  // ── Persist candidate (direct insert — mirrors CandidatesService.ingest) ──
  await prisma.publishingCandidate.create({
    data: {
      id: candidateId,
      businessId,
      externalContentId: contentItemVersionId,
      candidateChecksum: candidate.candidate_checksum,
      eventFingerprint,
      eventId,
      status: "ACTIVE",
      sourceStatus: sourceStatus as unknown as Prisma.InputJsonValue,
      payload: candidate as unknown as Prisma.InputJsonValue,
      channel: "facebook",
      format: "static_image_post",
      locale: "ar",
      strategyWeekNumber: 1,
      sourceStateVersion: 1,
    },
  });
  console.log(`✓ Candidate ${candidateId} (checksum=${candidate.candidate_checksum})`);

  // ── Upsert the connected Meta Page target (stable id across runs) ──────────
  await prisma.publishingTarget.upsert({
    where: { id: DEMO_TARGET_ID },
    update: {
      businessId,
      provider: "META",
      channel: "facebook",
      externalAccountId: metaPageId,
      displayName: "MarketMind ya 2alby",
      // Opaque pointer to the secret store — the real Meta adapter in n8n
      // resolves the token from its OWN env (Phase 3), never from this string.
      credentialRef: "env:META_TEST_PAGE_ACCESS_TOKEN",
      connectionState: "CONNECTED",
      capabilities: ["static_image"],
      lastVerifiedAt: now,
      expiresAt: null,
    },
    create: {
      id: DEMO_TARGET_ID,
      businessId,
      provider: "META",
      channel: "facebook",
      externalAccountId: metaPageId,
      displayName: "MarketMind ya 2alby",
      credentialRef: "env:META_TEST_PAGE_ACCESS_TOKEN",
      connectionState: "CONNECTED",
      capabilities: ["static_image"],
      lastVerifiedAt: now,
      expiresAt: null,
    },
  });
  console.log(`✓ Target ${DEMO_TARGET_ID} (Meta Page ${metaPageId})`);

  // ── Create intent (DRAFT) then schedule (AWAITING_APPROVAL, v2) ────────────
  const intentId = uuid();
  const createKey = `seed:create:${intentId}`;
  const intent = await prisma.publishingIntent.create({
    data: {
      id: intentId,
      businessId,
      candidateId: candidateId,
      mode: "REAL",
      status: "DRAFT",
      createdByUserId: ownerId,
      idempotencyKey: createKey,
    },
  });

  const scheduleKey = `seed:schedule:${intentId}`;
  await prisma.publishingIntent.update({
    where: { id: intentId },
    data: {
      targetId: DEMO_TARGET_ID,
      scheduledLocalAt: new Date(scheduledLocal),
      timezone: "Africa/Cairo",
      scheduledUtcAt: scheduledUtc,
      status: "AWAITING_APPROVAL",
      version: 2,
      idempotencyKey: scheduleKey,
    },
  });

  // ── Approve (SCHEDULED) + write the approval snapshot row ──────────────────
  const approveKey = `seed:approve:${intentId}`;
  const approvalId = uuid();
  const approvalSnapshotInput = {
    contract_version: "publication-approval-v1",
    decision_id: approvalId,
    intent_id: intentId,
    intent_version: 2,
    candidate_id: candidateId,
    candidate_checksum: candidate.candidate_checksum,
    mode: "real",
    target_id: DEMO_TARGET_ID,
    scheduled_local: scheduledLocal,
    time_zone: "Africa/Cairo",
    scheduled_utc: scheduledUtc.toISOString(),
    decided_by_user_id: ownerId,
    decided_at: decidedAt,
  } as const;
  const approvalFingerprint =
    computePublicationApprovalFingerprint(approvalSnapshotInput);

  await prisma.publishingApproval.create({
    data: {
      id: approvalId,
      intentId,
      intentVersionAtDecision: 2,
      candidateChecksum: candidate.candidate_checksum,
      decision: "APPROVED",
      decidedByUserId: ownerId,
      decidedAt: new Date(decidedAt),
      notes: "Seeded two-approval (content + publish) simulation for the publishing demo.",
      approvalFingerprint,
      idempotencyKey: approveKey,
    },
  });
  await prisma.publishingIntent.update({
    where: { id: intentId },
    data: { status: "SCHEDULED" },
  });

  // ── Enqueue the BullMQ dispatch job (mirrors IntentsService.approveIntent) ──
  const dispatchKey = `${approveKey}::dispatch`;
  const jobKey = `publish:${intentId}:2`;
  const delay = Math.max(0, scheduledUtc.getTime() - Date.now());
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const queue = new Queue(QUEUE_NAME, { connection: { url: redisUrl } });
  await queue.add(
    "dispatch",
    { intentId, version: 2, idempotencyKey: dispatchKey },
    { jobId: jobKey, delay },
  );
  await queue.close();

  console.log(`✓ Intent ${intentId} SCHEDULED (v2, fires in ~${Math.round(delay / 1000)}s)`);
  console.log(`✓ Dispatch job ${jobKey} enqueued (key=${dispatchKey})`);
  console.log("");
  console.log("Publishing demo seed complete. With the API running and the");
  console.log("publishing-v1 n8n workflow active, the DispatchProcessor worker");
  console.log("will pick up the job, dispatch to n8n, and (real mode) post to");
  console.log("the Meta Page. Watch the API logs or query:");
  console.log(`  GET /api/v1/publication-intents/${intentId}  (owner JWT)`);
  console.log("");
  console.log("IDs for this run:");
  console.log(JSON.stringify(
    {
      businessId,
      candidateId,
      intentId,
      approvalId,
      targetId: DEMO_TARGET_ID,
      jobId: jobKey,
      scheduled_utc: scheduledUtc.toISOString(),
    },
    null,
    2,
  ));
}

main()
  .catch((e) => {
    console.error("seed-publishing-demo failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    // give stdout a chance to flush
    await new Promise((r) => setImmediate(r));
    process.exit(0);
  });
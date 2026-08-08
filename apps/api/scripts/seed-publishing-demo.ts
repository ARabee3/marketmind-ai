/**
 * Publishing demo seed — boots a complete, real candidate → intent → approval
 * chain straight into Postgres and enqueues the BullMQ dispatch job, so the
 * whole publishing pipeline (#120 / #121) is triggerable end-to-end from a
 * clean environment with one command.
 *
 * Run: `npm run seed:publishing-demo` (from apps/api)
 *
 * Design notes (PLAN.md Phase 2 / issue #175):
 *  - Each run mints FRESH candidate/event/intent ids so re-running never
 *    trips the one-intent-per-candidate partial unique index or any event
 *    fingerprint dedup.
 *  - The candidate payload is built to satisfy the frozen
 *    `validatePublicationCandidateV1` contract and carries the committed demo
 *    asset (asset_id + real SHA-256) read from the SAME manifest the internal
 *    asset route + dispatch integrity validator use — single source of truth.
 *  - Issue #175: this seed NEVER creates a real-mode target or credential.
 *    Real-mode publishing requires the Meta OAuth journey in the UI — the
 *    API-owned executor resolves the vault credential for the exact target and
 *    there is NO fallback to an env Page token. This seed drives the
 *    no-credentials demo (export + simulation) only; export/simulation are
 *    never labelled as published.
 *  - The intents stay DRAFT and the owner-driven dispatch-export /
 *    dispatch-simulation actions complete them synchronously — no provider,
 *    no BullMQ job, and no approval is fabricated for real mode.
 *
 * This script writes to Postgres ONLY — it never calls a provider and never
 * enqueues a real-mode dispatch. Idempotent: safe to re-run.
 */
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

import { PrismaClient, Prisma } from "@prisma/client";
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

  // Issue #175: the demo is ALWAYS no-credentials. Real-mode targets can only
  // come from the Meta OAuth journey (connect → callback → select), which
  // writes an encrypted vault record behind an opaque credentialRef. A demo
  // seed must never fabricate a CONNECTED target with an env token.
  const asset = loadDemoAsset();
  const now = new Date();

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

  {
    // ── No-credentials demo: export + simulation legs, fully local ─────────
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
          candidateId: candidateId,
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
    console.log("Demo seed complete. With the API running, approve-free local");
    console.log("actions drive both legs to their terminal states — nothing");
    console.log("touches a provider, a BullMQ queue, or a Meta token:");
    console.log(
      `  POST /api/v1/publication-intents/<id>/dispatch-export     (owner JWT)`,
    );
    console.log(
      `  POST /api/v1/publication-intents/<id>/dispatch-simulation (owner JWT)`,
    );
    console.log("");
    console.log(
      "Real-mode publishing is NOT seeded (issue #175): connect a Meta",
      "account from the Publishing workspace (Meta OAuth journey) to create a",
      "vault-backed target, then schedule + approve a real item.",
    );
    console.log("");
    console.log(
      JSON.stringify({ businessId, mode: "no-credentials-demo", ...ids }, null, 2),
    );
  }
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
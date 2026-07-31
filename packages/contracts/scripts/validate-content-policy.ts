import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  computePublicationCandidateChecksum,
  isPublicationCandidateChecksumValid,
  validateInternalContentGenerateRequest,
  validatePublicationCandidateV1,
  validateContentPolicyFixture,
  validateContentSchema,
  type ContentPolicyFixture,
  type InternalContentGenerateRequest,
  type PublicationCandidateV1,
} from "../src/content/index";

const examplesUrl = new URL("../examples/", import.meta.url);

async function load(name: string): Promise<ContentPolicyFixture> {
  return JSON.parse(
    await readFile(new URL(name, examplesUrl), "utf8"),
  ) as ContentPolicyFixture;
}

type InvalidMutation =
  | { readonly kind: "duplicate_week_claim" }
  | { readonly kind: "strategy_status"; readonly value: "draft" | "rejected" }
  | { readonly kind: "current_profile_version_id"; readonly value: string }
  | { readonly kind: "cycle_status"; readonly value: "paused" | "completed" }
  | { readonly kind: "week_number"; readonly value: number }
  | { readonly kind: "empty_item_ids" }
  | { readonly kind: "too_few_item_ids" }
  | { readonly kind: "too_many_item_ids" }
  | { readonly kind: "promotion_mode"; readonly value: "none" }
  | { readonly kind: "promotion_expired"; readonly value: string }
  | { readonly kind: "channel"; readonly value: "facebook" | "instagram" }
  | {
      readonly kind: "claim";
      readonly claim_type: ContentPolicyFixture["item_version"]["claim_sources"][number]["claim_type"];
      readonly approved: boolean;
    }
  | { readonly kind: "protected_text_mutated" }
  | { readonly kind: "default_context_owner_claim" }
  | {
      readonly kind: "asset_status";
      readonly value: "missing" | "failed" | "blocked";
    }
  | { readonly kind: "approved_decision_without_asset" }
  | { readonly kind: "version_conflict" }
  | {
      readonly kind: "identity_mismatch";
      readonly field:
        | "pack_strategy_version"
        | "trace_week_number"
        | "content_pack_id"
        | "trace_channel"
        | "asset_owner"
        | "decision_item";
    }
  | { readonly kind: "alt_text"; readonly value: string };

type InvalidCase = {
  readonly base_fixture: string;
  readonly mutation: InvalidMutation;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function loadInvalidCase(name: string): Promise<ContentPolicyFixture> {
  const testCase = JSON.parse(
    await readFile(new URL(name, examplesUrl), "utf8"),
  ) as InvalidCase;
  const fixture = clone(await load(testCase.base_fixture));
  switch (testCase.mutation.kind) {
    case "duplicate_week_claim":
      fixture.existing_weekly_claims.push({
        content_cycle_id: fixture.week_context.content_cycle_id,
        week_number: fixture.week_context.week_number,
        weekly_claim_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      });
      return fixture;
    case "strategy_status":
      fixture.strategy_status = testCase.mutation.value;
      return fixture;
    case "current_profile_version_id":
      fixture.current_profile_version_id = testCase.mutation.value;
      return fixture;
    case "cycle_status":
      fixture.cycle_status = testCase.mutation.value;
      return fixture;
    case "week_number":
      fixture.week_context.week_number = testCase.mutation.value;
      return fixture;
    case "empty_item_ids":
      fixture.pack.item_ids = [];
      return fixture;
    case "too_few_item_ids":
      fixture.pack.item_ids = fixture.pack.item_ids.slice(0, 1);
      return fixture;
    case "too_many_item_ids":
      fixture.pack.item_ids = [
        ...fixture.pack.item_ids,
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ];
      return fixture;
    case "promotion_mode":
      fixture.week_context.promotion_mode = testCase.mutation.value;
      fixture.week_context.promotion = null;
      return fixture;
    case "promotion_expired":
      if (fixture.week_context.promotion) {
        fixture.week_context.promotion.valid_until = testCase.mutation.value;
      }
      return fixture;
    case "channel":
      fixture.item_version.channel = testCase.mutation.value;
      return fixture;
    case "claim":
      fixture.item_version.claim_sources.push({
        claim_type: testCase.mutation.claim_type,
        source_type: "week_context",
        source_path: "unsafe_claim",
        approved: testCase.mutation.approved,
      });
      return fixture;
    case "protected_text_mutated":
      fixture.protected_text_mutated = true;
      return fixture;
    case "default_context_owner_claim":
      fixture.week_context.context_source = "system_defaulted";
      fixture.week_context.system_defaulted_at = "2026-08-01T18:00:00+03:00";
      return fixture;
    case "asset_status":
      fixture.assets[0].status = testCase.mutation.value;
      return fixture;
    case "approved_decision_without_asset":
      fixture.decision = {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        content_item_id: fixture.item_version.content_item_id,
        content_item_version_id: fixture.item_version.id,
        content_item_version: fixture.item_version.version,
        content_item_version_checksum: fixture.item_version.version_checksum,
        decision: "approved",
        revision_notes: null,
        decided_by_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        decided_at: "2026-08-01T11:00:00+03:00",
      };
      fixture.assets[0].status = "missing";
      return fixture;
    case "version_conflict":
      fixture.decision = {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        content_item_id: fixture.item_version.content_item_id,
        content_item_version_id: "99999999-9999-4999-8999-999999999998",
        content_item_version: fixture.item_version.version,
        content_item_version_checksum: "stale-checksum",
        decision: "approved",
        revision_notes: null,
        decided_by_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        decided_at: "2026-08-01T11:00:00+03:00",
      };
      return fixture;
    case "identity_mismatch":
      switch (testCase.mutation.field) {
        case "pack_strategy_version":
          fixture.pack.strategy_version = 99;
          break;
        case "trace_week_number":
          fixture.item_version.strategy_trace.week_number = 12;
          break;
        case "content_pack_id":
          fixture.item_version.content_pack_id =
            "00000000-0000-4000-8000-000000000000";
          break;
        case "trace_channel":
          fixture.item_version.strategy_trace.channel = "instagram";
          break;
        case "asset_owner":
          fixture.assets[0].content_item_version_id =
            "00000000-0000-4000-8000-000000000000";
          break;
        case "decision_item":
          fixture.decision = {
            id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            content_item_id: "00000000-0000-4000-8000-000000000000",
            content_item_version_id: fixture.item_version.id,
            content_item_version: fixture.item_version.version,
            content_item_version_checksum:
              fixture.item_version.version_checksum,
            decision: "approved",
            revision_notes: null,
            decided_by_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            decided_at: "2026-08-01T11:00:00+03:00",
          };
          break;
      }
      return fixture;
    case "alt_text":
      fixture.item_version.alt_text = testCase.mutation.value;
      return fixture;
    default:
      throw new Error("Unsupported invalid content mutation.");
  }
}

const expectedCodes = {
  "content-duplicate-week-claim.invalid.json": "CONTENT_WEEK_ALREADY_CLAIMED",
  "content-strategy-unapproved.invalid.json": "CONTENT_STRATEGY_NOT_APPROVED",
  "content-profile-stale.invalid.json": "CONTENT_PROFILE_STALE",
  "content-invented-promotion.invalid.json": "CONTENT_OFFER_UNAPPROVED",
  "content-expired-promotion.invalid.json": "CONTENT_OFFER_UNAPPROVED",
  "content-wrong-channel.invalid.json": "CONTENT_CHANNEL_MISMATCH",
  "content-unsupported-testimonial.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
  "content-guarantee-claim.invalid.json": "CONTENT_POLICY_VIOLATION",
  "content-regulated-claim.invalid.json": "CONTENT_POLICY_VIOLATION",
  "content-competitor-superiority.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
  "content-unconfirmed-price.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
  "content-unconfirmed-availability.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
  "content-superiority-claim.invalid.json": "CONTENT_UNSUPPORTED_CLAIM",
  "content-branded-undisclosed.invalid.json": "CONTENT_POLICY_VIOLATION",
  "content-protected-text-mutated.invalid.json": "CONTENT_POLICY_VIOLATION",
  "content-default-context-owner-claim.invalid.json":
    "CONTENT_POLICY_VIOLATION",
  "content-missing-required-asset.invalid.json": "CONTENT_ASSET_REQUIRED",
  "content-cycle-paused.invalid.json": "CONTENT_CYCLE_PAUSED",
  "content-cycle-completed.invalid.json": "CONTENT_CYCLE_COMPLETED",
  "content-schema-failure.invalid.json": "CONTENT_SCHEMA_FAILURE",
  "content-pack-too-few-items.invalid.json": "CONTENT_SCHEMA_FAILURE",
  "content-pack-too-many-items.invalid.json": "CONTENT_SCHEMA_FAILURE",
  "content-provider-failure.invalid.json": "CONTENT_PROVIDER_FAILURE",
  "content-approval-blocked.invalid.json": "CONTENT_APPROVAL_BLOCKED",
  "content-version-conflict.invalid.json": "CONTENT_VERSION_CONFLICT",
  "content-alt-text-too-long.invalid.json": "CONTENT_SCHEMA_FAILURE",
  "content-pack-strategy-version-mismatch.invalid.json":
    "CONTENT_VERSION_CONFLICT",
  "content-trace-week-mismatch.invalid.json": "CONTENT_VERSION_CONFLICT",
  "content-item-pack-mismatch.invalid.json": "CONTENT_VERSION_CONFLICT",
  "content-trace-channel-mismatch.invalid.json": "CONTENT_CHANNEL_MISMATCH",
  "content-asset-owner-mismatch.invalid.json": "CONTENT_VERSION_CONFLICT",
  "content-decision-item-mismatch.invalid.json": "CONTENT_VERSION_CONFLICT",
} as const;

const allStableCodes = [
  "CONTENT_STRATEGY_NOT_APPROVED",
  "CONTENT_PROFILE_STALE",
  "CONTENT_CYCLE_PAUSED",
  "CONTENT_CYCLE_COMPLETED",
  "CONTENT_WEEK_OUT_OF_RANGE",
  "CONTENT_WEEK_ALREADY_CLAIMED",
  "CONTENT_CHANNEL_MISMATCH",
  "CONTENT_UNSUPPORTED_CLAIM",
  "CONTENT_OFFER_UNAPPROVED",
  "CONTENT_POLICY_VIOLATION",
  "CONTENT_ASSET_REQUIRED",
  "CONTENT_SCHEMA_FAILURE",
  "CONTENT_VERSION_CONFLICT",
  "CONTENT_APPROVAL_BLOCKED",
  "CONTENT_PROVIDER_FAILURE",
  "CONTENT_CANDIDATE_TAMPERED",
  "CONTENT_CANDIDATE_REVOKED",
] as const;

const valid = validateContentPolicyFixture(
  await load("content-pack-week-1-ar.example.json"),
);
assert.deepEqual(
  valid.issues,
  [],
  `valid fixture failed: ${JSON.stringify(valid.issues)}`,
);

for (const [name, expectedCode] of Object.entries(expectedCodes)) {
  const result = validateContentPolicyFixture(await loadInvalidCase(name));
  assert(
    result.issues.some((issue) => issue.code === expectedCode),
    `${name}: expected ${expectedCode}, got ${JSON.stringify(result.issues)}`,
  );
}

const week13 = validateContentSchema(
  JSON.parse(
    await readFile(
      new URL("content-week-13.invalid.json", examplesUrl),
      "utf8",
    ),
  ),
);
assert(
  week13.issues.some((issue) => issue.code === "CONTENT_WEEK_OUT_OF_RANGE"),
  `content-week-13.invalid.json: expected CONTENT_WEEK_OUT_OF_RANGE, got ${JSON.stringify(week13.issues)}`,
);

const emptyAlt = validateContentSchema(
  JSON.parse(
    await readFile(
      new URL("content-empty-alt-text.invalid.json", examplesUrl),
      "utf8",
    ),
  ),
);
assert(
  emptyAlt.issues.some((issue) => issue.code === "CONTENT_ASSET_REQUIRED"),
  `content-empty-alt-text.invalid.json: expected CONTENT_ASSET_REQUIRED, got ${JSON.stringify(emptyAlt.issues)}`,
);

const schemaFailure = validateContentPolicyFixture(
  await loadInvalidCase("content-schema-failure.invalid.json"),
);
assert(
  schemaFailure.issues.some((issue) => issue.code === "CONTENT_SCHEMA_FAILURE"),
  `content-schema-failure.invalid.json: expected CONTENT_SCHEMA_FAILURE, got ${JSON.stringify(schemaFailure.issues)}`,
);

const strategyPlan = JSON.parse(
  await readFile(new URL("strategy-plan.example.json", examplesUrl), "utf8"),
);
const journey = JSON.parse(
  await readFile(
    new URL("cafe-full-journey.example.json", examplesUrl),
    "utf8",
  ),
);
const generateRequest = {
  contract_version: "content-v1",
  content_pack_id: "77777777-7777-4777-8777-777777777777",
  business_id: journey.confirmed_business_profile.business_id,
  strategy_id: strategyPlan.strategy_id,
  strategy_version: strategyPlan.version,
  strategy_decision_id: "55555555-5555-4555-8555-555555555555",
  strategy_plan: strategyPlan,
  business_profile: journey.confirmed_business_profile,
  week_context: JSON.parse(
    await readFile(
      new URL("content-week-context-safe-default.example.json", examplesUrl),
      "utf8",
    ),
  ),
  selected_channels: ["instagram"],
  allowed_formats: ["static_image_post"],
  language_mode: strategyPlan.plan_language,
} as InternalContentGenerateRequest;
assert.deepEqual(
  validateInternalContentGenerateRequest(generateRequest).issues,
  [],
  "grounded generation request must bind exact Strategy and profile snapshots",
);
const staleGenerateRequest = {
  ...generateRequest,
  strategy_version: 99,
} as InternalContentGenerateRequest;
assert(
  validateInternalContentGenerateRequest(staleGenerateRequest).issues.some(
    (issue) => issue.code === "CONTENT_VERSION_CONFLICT",
  ),
  "stale Strategy generation request must produce CONTENT_VERSION_CONFLICT",
);

const approvedCandidate = JSON.parse(
  await readFile(
    new URL("publication-candidate-approved.example.json", examplesUrl),
    "utf8",
  ),
) as PublicationCandidateV1;
assert(
  isPublicationCandidateChecksumValid(approvedCandidate),
  "approved candidate checksum must be valid",
);
assert.equal(
  validatePublicationCandidateV1(approvedCandidate).valid,
  true,
  "approved candidate boundary must be valid",
);

const tamperedCandidate = structuredClone(approvedCandidate);
tamperedCandidate.caption =
  "Tampered caption that no longer matches the stored checksum.";
assert(
  !isPublicationCandidateChecksumValid(tamperedCandidate),
  "tampered candidate checksum must be invalid (CONTENT_CANDIDATE_TAMPERED)",
);
assert(
  validatePublicationCandidateV1(tamperedCandidate).issues.some(
    (issue) => issue.code === "CONTENT_CANDIDATE_TAMPERED",
  ),
  "tampered candidate must produce CONTENT_CANDIDATE_TAMPERED",
);

const producedCodes = new Set<string>(Object.values(expectedCodes));
producedCodes.add("CONTENT_WEEK_OUT_OF_RANGE");
producedCodes.add("CONTENT_CANDIDATE_TAMPERED");
producedCodes.add("CONTENT_CANDIDATE_REVOKED");
const missing = allStableCodes.filter((code) => !producedCodes.has(code));
assert.deepEqual(
  missing,
  [],
  `content policy must assert all stable codes; missing: ${missing.join(", ")}`,
);

console.log("Content cross-object policy fixtures are valid.");

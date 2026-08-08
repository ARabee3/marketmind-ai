import type { Prisma } from "@prisma/client";
import type {
  ContentCtaLibraryEntryV2,
  ContentEditorialProfileV2,
  ContentItemVersionV2,
  ContentMediaLibraryEntryV2,
  ContentPostPlanV2,
  ContentWeekPlanV2,
} from "@marketmind/contracts";
import type { ContentCtaDestination } from "@marketmind/contracts";
import { toContentItemVersion as toV1ItemVersion } from "../content.service";

type PrismaEditorialProfile = Prisma.ContentEditorialProfileGetPayload<
  Record<string, never>
>;
type PrismaCtaEntry = Prisma.ContentCtaLibraryEntryGetPayload<
  Record<string, never>
>;
type PrismaMediaEntry = Prisma.ContentMediaLibraryEntryGetPayload<
  Record<string, never>
>;
type PrismaPostPlan = Prisma.ContentPostPlanGetPayload<Record<string, never>>;
type PrismaWeekPlan = Prisma.ContentWeekPlanGetPayload<{
  include: { postPlans: true };
}>;
type PrismaVersion = Prisma.ContentItemVersionGetPayload<Record<string, never>>;

function toIso(iso: Date | string): string {
  return iso instanceof Date ? iso.toISOString() : String(iso);
}

function toJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return [];
}

export function toEditorialProfileV2(
  row: PrismaEditorialProfile,
): ContentEditorialProfileV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    content_cycle_id: row.contentCycleId,
    audience_nuance: row.audienceNuance,
    voice: row.voice,
    language: row.language as ContentEditorialProfileV2["language"],
    writing_guardrails: toJsonStringArray(row.writingGuardrails),
    default_visual_guidance: row.defaultVisualGuidance,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export function toCtaLibraryEntryV2(
  row: PrismaCtaEntry,
): ContentCtaLibraryEntryV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    content_cycle_id: row.contentCycleId,
    label: row.label,
    destination: row.destination as ContentCtaDestination,
    campaign_context: row.campaignContext,
    active: row.active,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export function toMediaLibraryEntryV2(
  row: PrismaMediaEntry,
): ContentMediaLibraryEntryV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    business_id: row.businessId,
    content_cycle_id: row.contentCycleId,
    owner_user_id: row.ownerUserId,
    kind: row.kind as ContentMediaLibraryEntryV2["kind"],
    status: row.status as ContentMediaLibraryEntryV2["status"],
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    storage_key: row.storageKey,
    failure_code: row.failureCode as ContentMediaLibraryEntryV2["failure_code"],
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export function toPostPlanV2(row: PrismaPostPlan): ContentPostPlanV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    content_week_plan_id: row.contentWeekPlanId,
    position: row.position,
    purpose: row.purpose,
    intended_audience: row.intendedAudience,
    channel: row.channel as ContentPostPlanV2["channel"],
    format: row.format as ContentPostPlanV2["format"],
    cta_library_entry_id: row.ctaLibraryEntryId,
    owner_instructions: row.ownerInstructions,
    visual_direction: row.visualDirection,
    selected_media_ids: toJsonStringArray(row.selectedMediaIds),
    plan_state: row.planState as ContentPostPlanV2["plan_state"],
    source: row.source as ContentPostPlanV2["source"],
    content_item_id: row.contentItemId,
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

export function toWeekPlanV2(row: PrismaWeekPlan): ContentWeekPlanV2 {
  return {
    id: row.id,
    contract_version: "content-v2",
    content_cycle_id: row.contentCycleId,
    week_number: row.weekNumber,
    status: row.status as ContentWeekPlanV2["status"],
    post_plans: row.postPlans
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(toPostPlanV2),
    frozen_input:
      row.frozenInput as unknown as ContentWeekPlanV2["frozen_input"],
    created_at: toIso(row.createdAt),
    updated_at: toIso(row.updatedAt),
  };
}

/**
 * v2 item versions keep the v1 surface and add immutable edit metadata.
 * Legacy v1 rows (null edit metadata) are mapped without the metadata block;
 * callers gate on `contract_version` before using the v2 shape.
 */
export function toItemVersionV2(row: PrismaVersion): ContentItemVersionV2 {
  const base = toV1ItemVersion(row);
  if (row.editKind === null) {
    throw new Error(
      `Content item version ${row.id} is content-v1; refusing to map as v2`,
    );
  }
  return {
    ...base,
    contract_version: "content-v2",
    edit_metadata: {
      edit_kind:
        row.editKind as ContentItemVersionV2["edit_metadata"]["edit_kind"],
      base_version_id: row.baseVersionId,
      base_version_checksum: row.baseVersionChecksum,
      edited_by_user_id: row.editedByUserId,
      validation_state: "validated",
      edited_at: toIso(row.editedAt ?? row.createdAt),
    },
  };
}

import type {
  CairoTimezone,
  ContentContractVersion,
  IsoDate,
  IsoDateTime,
  UUID,
} from "./content-types";

export const CONTENT_CYCLE_STATUSES = [
  "active",
  "paused",
  "completed",
] as const;
export type ContentCycleStatus = (typeof CONTENT_CYCLE_STATUSES)[number];

export type ContentCycle = {
  readonly id: UUID;
  readonly contract_version: ContentContractVersion;
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  readonly profile_version_id: UUID;
  readonly status: ContentCycleStatus;
  readonly current_week_number: number;
  readonly next_generation_at: IsoDateTime | null;
  readonly timezone: CairoTimezone;
  readonly pause_reason: string | null;
  readonly completed_at: IsoDateTime | null;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type ContentPromotion = {
  readonly text: string;
  readonly terms: readonly string[];
  readonly valid_from: IsoDateTime;
  readonly valid_until: IsoDateTime;
};

export type ContentCtaDestination = {
  readonly type: "phone" | "whatsapp" | "website" | "address" | "none";
  readonly value: string | null;
};

export type ContentWeekContextSource = "owner_confirmed" | "system_defaulted";

type ContentWeekContextBase = {
  readonly id: UUID;
  readonly contract_version: ContentContractVersion;
  readonly content_cycle_id: UUID;
  readonly week_number: number;
  readonly week_start_date: IsoDate;
  readonly promotion_mode: "none" | "owner_approved";
  readonly promotion: ContentPromotion | null;
  readonly must_include: readonly string[];
  readonly must_avoid: readonly string[];
  readonly approved_asset_ids: readonly UUID[];
  readonly cta_destination: ContentCtaDestination;
  readonly generation_cutoff_at: IsoDateTime;
  readonly weekly_claim_id: UUID;
};

export type ContentWeekContext = ContentWeekContextBase &
  (
    | {
        readonly context_source: "owner_confirmed";
        readonly confirmed_by_user_id: UUID;
        readonly confirmed_at: IsoDateTime;
        readonly system_defaulted_at: null;
      }
    | {
        readonly context_source: "system_defaulted";
        readonly confirmed_by_user_id: null;
        readonly confirmed_at: null;
        readonly system_defaulted_at: IsoDateTime;
      }
  );

export type ContentWeekContextOwnerInput = Pick<
  ContentWeekContextBase,
  | "week_number"
  | "week_start_date"
  | "promotion_mode"
  | "promotion"
  | "must_include"
  | "must_avoid"
  | "approved_asset_ids"
  | "cta_destination"
>;

export const CONTENT_PACK_STATUSES = [
  "queued",
  "generating",
  "validating",
  "draft",
  "partially_approved",
  "approved",
  "failed",
] as const;
export type ContentPackStatus = (typeof CONTENT_PACK_STATUSES)[number];

export type ContentPack = {
  readonly id: UUID;
  readonly contract_version: ContentContractVersion;
  readonly content_cycle_id: UUID;
  readonly weekly_claim_id: UUID;
  readonly week_number: number;
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly strategy_decision_id: UUID;
  readonly profile_version_id: UUID;
  readonly week_context_id: UUID;
  readonly status: ContentPackStatus;
  readonly retry_eligible: boolean;
  readonly item_ids: readonly UUID[];
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export const CONTENT_PACK_ALLOWED_TRANSITIONS: Record<
  ContentPackStatus,
  readonly ContentPackStatus[]
> = {
  queued: ["generating", "failed"],
  generating: ["validating", "failed"],
  validating: ["draft", "failed"],
  draft: ["partially_approved", "approved"],
  partially_approved: ["approved"],
  approved: [],
  failed: ["queued"],
};

export function canTransitionContentPack(
  from: ContentPackStatus,
  to: ContentPackStatus,
): boolean {
  return CONTENT_PACK_ALLOWED_TRANSITIONS[from].includes(to);
}

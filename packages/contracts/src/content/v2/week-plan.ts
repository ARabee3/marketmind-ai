import type {
  ContentChannel,
  ContentFormat,
  IsoDateTime,
  UUID,
} from "../content-types";
import type { ContentCtaLibraryEntryV2 } from "./cta-library";
import type {
  ContentV2PlanSource,
  ContentV2PostPlanState,
  ContentV2WeekPlanState,
} from "./content-v2-types";
import type { ContentEditorialProfileV2 } from "./editorial-profile";
import type { ContentMediaLibraryEntryV2 } from "./media-library";

/**
 * Week plan and ordered post plans (content-v2, issue #187).
 *
 * The planner produces exactly 3–5 high-level post cards for the actionable
 * week; full draft copy is only generated after the owner reviews the cards
 * and triggers explicit generation. Plan edits are possible while the week
 * plan is `draft`; once frozen, generation uses the frozen snapshot only.
 */
export type ContentPostPlanV2 = {
  readonly id: UUID;
  readonly contract_version: "content-v2";
  readonly content_week_plan_id: UUID;
  /** 1-based ordering inside the week plan (1..5). */
  readonly position: number;
  /** What the post sets out to do. */
  readonly purpose: string;
  /** Intended audience or expected result for this post. */
  readonly intended_audience: string | null;
  /** Constrained by the approved Strategy v2 handoff. */
  readonly channel: ContentChannel;
  /** Constrained by the approved Strategy v2 handoff. */
  readonly format: ContentFormat;
  /** Zero-or-one primary CTA from the cycle CTA library. */
  readonly cta_library_entry_id: UUID | null;
  /** Owner posting instructions and optional constraints. */
  readonly owner_instructions: string | null;
  readonly visual_direction: string | null;
  /** Selected media-library entries (uploaded or generated). */
  readonly selected_media_ids: readonly UUID[];
  readonly plan_state: ContentV2PostPlanState;
  readonly source: ContentV2PlanSource;
  /** Set once full generation produced the matching content item. */
  readonly content_item_id: UUID | null;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type ContentWeekPlanV2 = {
  readonly id: UUID;
  readonly contract_version: "content-v2";
  readonly content_cycle_id: UUID;
  readonly week_number: number;
  readonly status: ContentV2WeekPlanState;
  /** Exactly 3–5 ordered post plans when the week is actionable. */
  readonly post_plans: readonly ContentPostPlanV2[];
  readonly frozen_input: ContentV2FrozenInput | null;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type ContentWeekPlanListResponse = {
  readonly week_plans: readonly ContentWeekPlanV2[];
};

/**
 * Transactionally frozen inputs handed to the full-draft worker when it
 * claims the week. The worker never re-reads live owner state; it consumes
 * this snapshot, preserving idempotency and cutoff guarantees.
 */
export type ContentV2FrozenInput = {
  readonly week_plan_id: UUID;
  readonly content_cycle_id: UUID;
  readonly week_number: number;
  readonly editorial_profile: ContentEditorialProfileV2;
  /** Active CTA entries at freeze time (frozen copies). */
  readonly cta_entries: readonly ContentCtaLibraryEntryV2[];
  /** Referenced media entries at freeze time (frozen copies). */
  readonly media_entries: readonly ContentMediaLibraryEntryV2[];
  /** Frozen, ordered post plans (exactly 3–5). */
  readonly post_plans: readonly ContentPostPlanV2[];
  readonly weekly_claim_id: UUID;
  readonly frozen_at: IsoDateTime;
};

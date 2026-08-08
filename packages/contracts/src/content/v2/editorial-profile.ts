import type { IsoDateTime, LanguageMode, UUID } from "../content-types";

/**
 * Cycle-wide editorial profile (content-v2, issue #187).
 *
 * Editorial voice belongs to the cycle: one compact profile covers audience
 * nuance, voice, language, writing guardrails, and optional default visual
 * guidance. Per-post overrides live on each post plan. Strategy v2 never
 * supplies deprecated v1 `pillars`/`tone` fields; those stay out of v2.
 */
export type ContentEditorialProfileV2 = {
  readonly id: UUID;
  readonly contract_version: "content-v2";
  readonly content_cycle_id: UUID;
  /** Who the content speaks to and the nuance the owner wants to protect. */
  readonly audience_nuance: string;
  /** Owner-defined editorial voice for the whole cycle. */
  readonly voice: string;
  readonly language: LanguageMode;
  /** Short, explicit writing guardrails (claims, tone, banned phrasing). */
  readonly writing_guardrails: readonly string[];
  /** Optional default visual direction used when a post has no own one. */
  readonly default_visual_guidance: string | null;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type ContentEditorialProfileUpsertRequest = {
  readonly audience_nuance: string;
  readonly voice: string;
  readonly language: LanguageMode;
  readonly writing_guardrails: readonly string[];
  readonly default_visual_guidance: string | null;
};

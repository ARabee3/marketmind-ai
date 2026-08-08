import type { ContentCtaDestination } from "../content-cycle";
import type { IsoDateTime, UUID } from "../content-types";

/**
 * Reusable CTA library entries (content-v2, issue #187).
 *
 * Owners maintain reusable calls to action; each post selects zero or one
 * primary CTA by referencing an entry. Deactivation is a soft removal so
 * frozen snapshots keep a truthful copy of what was used.
 */
export type ContentCtaLibraryEntryV2 = {
  readonly id: UUID;
  readonly contract_version: "content-v2";
  readonly content_cycle_id: UUID;
  /** Owner-facing label shown on plan cards. */
  readonly label: string;
  readonly destination: ContentCtaDestination;
  /** Optional campaign/context note, never a credential or secret. */
  readonly campaign_context: string | null;
  readonly active: boolean;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

export type ContentCtaLibraryEntryInput = {
  readonly label: string;
  readonly destination: ContentCtaDestination;
  readonly campaign_context: string | null;
  readonly active: boolean;
};

export type ContentCtaLibraryListResponse = {
  readonly entries: readonly ContentCtaLibraryEntryV2[];
};

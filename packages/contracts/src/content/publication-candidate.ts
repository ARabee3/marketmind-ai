import { createHash } from "node:crypto";

import type {
  CairoTimezone,
  ContentChannel,
  ContentFormat,
  ContentLocale,
  IsoDateTime,
  UUID,
} from "./content-types";

export const PUBLICATION_CANDIDATE_STATES = [
  "active",
  "revoked",
  "replaced",
] as const;
export type PublicationCandidateState =
  (typeof PUBLICATION_CANDIDATE_STATES)[number];

export type PublicationCandidateAssetV1 = {
  readonly asset_id: UUID;
  readonly kind: "owner_supplied" | "generated_static";
  readonly mime_type: string;
  readonly storage_key: string;
  readonly checksum: string;
};

export type PublicationCandidateV1 = {
  readonly contract_version: "publication-candidate-v1";
  readonly candidate_id: UUID;
  readonly business_id: UUID;
  readonly strategy_id: UUID;
  readonly strategy_version: number;
  readonly content_cycle_id: UUID;
  readonly strategy_week_number: number;
  readonly content_pack_id: UUID;
  readonly content_item_id: UUID;
  readonly content_item_version_id: UUID;
  readonly content_item_version: number;
  readonly content_item_version_checksum: string;
  readonly target_channel: ContentChannel;
  readonly content_format: ContentFormat;
  readonly selected_locale: ContentLocale;
  readonly caption: string;
  readonly cta: string | null;
  readonly hashtags: readonly string[];
  readonly alt_text: string;
  readonly assets: readonly PublicationCandidateAssetV1[];
  readonly recommended_publish_window: {
    readonly starts_at: IsoDateTime;
    readonly ends_at: IsoDateTime;
    readonly timezone: CairoTimezone;
  };
  readonly approval: {
    readonly decision_id: UUID;
    readonly decision: "approved";
    readonly content_item_version_id: UUID;
    readonly content_item_version_checksum: string;
    readonly decided_by_user_id: UUID;
    readonly decided_at: IsoDateTime;
  };
  readonly candidate_state: PublicationCandidateState;
  readonly candidate_checksum: string;
  readonly created_at: IsoDateTime;
};

export type PublicationCandidateCreatedEventV1 = {
  readonly event_id: UUID;
  readonly event_type: "content.publication_candidate.created.v1";
  readonly occurred_at: IsoDateTime;
  readonly correlation_id: UUID;
  readonly payload: PublicationCandidateV1;
};

export const PUBLICATION_CANDIDATE_CHECKSUM_VERSION =
  "publication-candidate-checksum-v1" as const;

type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalize(value: unknown): CanonicalJson {
  if (value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return null;
}

export function canonicalPublicationCandidatePayload(
  candidate: PublicationCandidateV1,
): string {
  const { candidate_checksum: _excluded, ...payload } = candidate;
  return JSON.stringify(canonicalize(payload));
}

export function computePublicationCandidateChecksum(
  candidate: PublicationCandidateV1,
): string {
  return createHash("sha256")
    .update(canonicalPublicationCandidatePayload(candidate), "utf8")
    .digest("hex");
}

export function isPublicationCandidateChecksumValid(
  candidate: PublicationCandidateV1,
): boolean {
  return computePublicationCandidateChecksum(candidate) === candidate.candidate_checksum;
}

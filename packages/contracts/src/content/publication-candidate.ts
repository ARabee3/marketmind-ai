import { createHash } from "node:crypto";

import type {
  CairoTimezone,
  ContentChannel,
  ContentDayPreference,
  ContentErrorCode,
  ContentFormat,
  ContentLocale,
  ContentTimeOfDayHint,
  ContentValidationIssue,
  ContentValidationResult,
  IsoDateTime,
  UUID,
} from "./content-types";
import {
  CONTENT_ALT_TEXT_MAX_LENGTH,
  CONTENT_CHANNELS,
  CONTENT_FORMATS,
  isSha256Checksum,
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
    readonly day_preference?: ContentDayPreference;
    readonly time_of_day_hint?: ContentTimeOfDayHint;
    readonly rationale?: string;
  };
  readonly approval: {
    readonly decision_id: UUID;
    readonly decision: "approved";
    readonly content_item_version_id: UUID;
    readonly content_item_version_checksum: string;
    readonly decided_by_user_id: UUID;
    readonly decided_at: IsoDateTime;
  };
  readonly candidate_checksum: string;
  readonly created_at: IsoDateTime;
};

type PublicationCandidateStatusBaseV1 = {
  readonly contract_version: "publication-candidate-status-v1";
  readonly candidate_id: UUID;
  readonly business_id: UUID;
  readonly candidate_checksum: string;
  readonly state_version: number;
  readonly changed_by_user_id: UUID | null;
  readonly changed_at: IsoDateTime;
};

export type PublicationCandidateStatusV1 = PublicationCandidateStatusBaseV1 &
  (
    | {
        readonly candidate_state: "active";
        readonly replacement_candidate_id: null;
      }
    | {
        readonly candidate_state: "revoked";
        readonly replacement_candidate_id: null;
      }
    | {
        readonly candidate_state: "replaced";
        readonly replacement_candidate_id: UUID;
      }
  );

export type PublicationCandidateCreatedEventV1 = {
  readonly event_id: UUID;
  readonly event_type: "content.publication_candidate.created.v1";
  readonly occurred_at: IsoDateTime;
  readonly correlation_id: UUID;
  readonly payload: PublicationCandidateV1;
};

export type PublicationCandidateStateChangedEventV1 = {
  readonly event_id: UUID;
  readonly event_type: "content.publication_candidate.state_changed.v1";
  readonly occurred_at: IsoDateTime;
  readonly correlation_id: UUID;
  readonly payload: Exclude<
    PublicationCandidateStatusV1,
    { readonly candidate_state: "active" }
  >;
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
  return (
    computePublicationCandidateChecksum(candidate) ===
    candidate.candidate_checksum
  );
}

const CANDIDATE_FIELDS = new Set([
  "contract_version",
  "candidate_id",
  "business_id",
  "strategy_id",
  "strategy_version",
  "content_cycle_id",
  "strategy_week_number",
  "content_pack_id",
  "content_item_id",
  "content_item_version_id",
  "content_item_version",
  "content_item_version_checksum",
  "target_channel",
  "content_format",
  "selected_locale",
  "caption",
  "cta",
  "hashtags",
  "alt_text",
  "assets",
  "recommended_publish_window",
  "approval",
  "candidate_checksum",
  "created_at",
]);

const CANDIDATE_STATUS_FIELDS = new Set([
  "contract_version",
  "candidate_id",
  "business_id",
  "candidate_checksum",
  "state_version",
  "candidate_state",
  "replacement_candidate_id",
  "changed_by_user_id",
  "changed_at",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDateTime(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function addCandidateIssue(
  issues: ContentValidationIssue[],
  code: ContentErrorCode,
  field: string,
  message: string,
): void {
  issues.push({ code, field, message, retryable: false });
}

export function validatePublicationCandidateV1(
  value: unknown,
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];
  if (!isRecord(value)) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate",
      "Publication candidate must be an object.",
    );
    return { valid: false, issues };
  }

  const candidate = value;
  const extraFields = Object.keys(candidate).filter(
    (field) => !CANDIDATE_FIELDS.has(field),
  );
  if (extraFields.length > 0) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      extraFields[0],
      "Publication candidate contains fields outside the frozen v1 boundary.",
    );
  }

  if (candidate.contract_version !== "publication-candidate-v1") {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "contract_version",
      "Publication candidate contract version is unsupported.",
    );
  }

  for (const field of [
    "candidate_id",
    "business_id",
    "strategy_id",
    "content_cycle_id",
    "content_pack_id",
    "content_item_id",
    "content_item_version_id",
    "content_item_version_checksum",
    "caption",
  ]) {
    if (!isNonEmptyString(candidate[field])) {
      addCandidateIssue(
        issues,
        "CONTENT_SCHEMA_FAILURE",
        field,
        `Publication candidate ${field} is required.`,
      );
    }
  }

  if (
    !Number.isInteger(candidate.strategy_version) ||
    Number(candidate.strategy_version) < 1
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "strategy_version",
      "Strategy version must be a positive integer.",
    );
  }
  if (
    !Number.isInteger(candidate.strategy_week_number) ||
    Number(candidate.strategy_week_number) < 1 ||
    Number(candidate.strategy_week_number) > 12
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_WEEK_OUT_OF_RANGE",
      "strategy_week_number",
      "Strategy week number must be an integer from 1 through 12.",
    );
  }
  if (
    !Number.isInteger(candidate.content_item_version) ||
    Number(candidate.content_item_version) < 1
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "content_item_version",
      "Content item version must be a positive integer.",
    );
  }

  if (
    !(CONTENT_CHANNELS as readonly unknown[]).includes(candidate.target_channel)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_CHANNEL_MISMATCH",
      "target_channel",
      "Publication candidate channel is unsupported.",
    );
  }
  if (
    !(CONTENT_FORMATS as readonly unknown[]).includes(candidate.content_format)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "content_format",
      "Publication candidate format is unsupported.",
    );
  }
  if (
    candidate.selected_locale !== "ar" &&
    candidate.selected_locale !== "en"
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "selected_locale",
      "Publication candidate locale must be ar or en.",
    );
  }
  if (candidate.cta !== null && typeof candidate.cta !== "string") {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "cta",
      "Publication candidate CTA must be text or null.",
    );
  }
  if (
    !Array.isArray(candidate.hashtags) ||
    !candidate.hashtags.every((tag) => typeof tag === "string")
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "hashtags",
      "Publication candidate hashtags must be an array of strings.",
    );
  }
  const textOnlyCandidate = candidate.content_format === "text_post";
  if (
    typeof candidate.alt_text !== "string" ||
    candidate.alt_text.length > CONTENT_ALT_TEXT_MAX_LENGTH ||
    (!textOnlyCandidate && candidate.alt_text.trim().length === 0)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_ASSET_REQUIRED",
      "alt_text",
      textOnlyCandidate
        ? `Text-only candidate alt text must contain at most ${CONTENT_ALT_TEXT_MAX_LENGTH} characters.`
        : `Publication candidate alt text must contain 1-${CONTENT_ALT_TEXT_MAX_LENGTH} characters.`,
    );
  }

  if (
    !Array.isArray(candidate.assets) ||
    (!textOnlyCandidate && candidate.assets.length === 0)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_ASSET_REQUIRED",
      "assets",
      "Publication candidate requires at least one ready immutable asset unless it is a text-only post.",
    );
  } else {
    for (const [index, asset] of candidate.assets.entries()) {
      if (
        !isRecord(asset) ||
        !isNonEmptyString(asset.asset_id) ||
        (asset.kind !== "owner_supplied" &&
          asset.kind !== "generated_static") ||
        !isNonEmptyString(asset.mime_type) ||
        !isNonEmptyString(asset.storage_key)
      ) {
        addCandidateIssue(
          issues,
          "CONTENT_ASSET_REQUIRED",
          `assets[${index}]`,
          "Every candidate asset must be ready, immutable, and checksum-addressed.",
        );
      } else if (!isSha256Checksum(asset.checksum)) {
        addCandidateIssue(
          issues,
          "CONTENT_ASSET_REQUIRED",
          `assets[${index}].checksum`,
          "Every candidate asset checksum must be a lowercase SHA-256 digest.",
        );
      }
    }
  }

  const window = candidate.recommended_publish_window;
  if (
    !isRecord(window) ||
    !isIsoDateTime(window.starts_at) ||
    !isIsoDateTime(window.ends_at) ||
    window.timezone !== "Africa/Cairo" ||
    Date.parse(String(window.starts_at)) >= Date.parse(String(window.ends_at))
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "recommended_publish_window",
      "Recommended publish window must be a valid increasing Cairo time range.",
    );
  }

  const approval = candidate.approval;
  if (
    !isRecord(approval) ||
    approval.decision !== "approved" ||
    !isNonEmptyString(approval.decision_id) ||
    !isNonEmptyString(approval.decided_by_user_id) ||
    !isIsoDateTime(approval.decided_at)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_APPROVAL_BLOCKED",
      "approval",
      "Publication candidate requires exact owner content approval.",
    );
  } else if (
    approval.content_item_version_id !== candidate.content_item_version_id ||
    approval.content_item_version_checksum !==
      candidate.content_item_version_checksum
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_VERSION_CONFLICT",
      "approval.content_item_version_id",
      "Candidate approval must reference the exact immutable item version and checksum.",
    );
  }

  if (!isIsoDateTime(candidate.created_at)) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "created_at",
      "Publication candidate creation time is invalid.",
    );
  }
  if (!isSha256Checksum(candidate.candidate_checksum)) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_checksum",
      "Publication candidate checksum must be a lowercase SHA-256 digest.",
    );
  } else if (
    !isPublicationCandidateChecksumValid(candidate as PublicationCandidateV1)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_CANDIDATE_TAMPERED",
      "candidate_checksum",
      "Publication candidate checksum does not match its immutable payload.",
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validatePublicationCandidateStatusV1(
  value: unknown,
): ContentValidationResult {
  const issues: ContentValidationIssue[] = [];
  if (!isRecord(value)) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status",
      "Publication candidate status must be an object.",
    );
    return { valid: false, issues };
  }

  const extraFields = Object.keys(value).filter(
    (field) => !CANDIDATE_STATUS_FIELDS.has(field),
  );
  if (extraFields.length > 0) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      extraFields[0],
      "Publication candidate status contains fields outside the frozen v1 boundary.",
    );
  }
  if (value.contract_version !== "publication-candidate-status-v1") {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.contract_version",
      "Publication candidate status contract version is unsupported.",
    );
  }
  for (const field of ["candidate_id", "business_id"]) {
    if (!isNonEmptyString(value[field])) {
      addCandidateIssue(
        issues,
        "CONTENT_SCHEMA_FAILURE",
        `candidate_status.${field}`,
        `Publication candidate status ${field} is required.`,
      );
    }
  }
  if (!isSha256Checksum(value.candidate_checksum)) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.candidate_checksum",
      "Publication candidate status checksum must bind a lowercase SHA-256 digest.",
    );
  }
  if (
    !Number.isInteger(value.state_version) ||
    Number(value.state_version) < 1
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.state_version",
      "Publication candidate status version must be a positive integer.",
    );
  }
  if (
    !(PUBLICATION_CANDIDATE_STATES as readonly unknown[]).includes(
      value.candidate_state,
    )
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.candidate_state",
      "Publication candidate status is unsupported.",
    );
  }
  if (
    (value.candidate_state === "replaced" &&
      !isNonEmptyString(value.replacement_candidate_id)) ||
    (value.candidate_state !== "replaced" &&
      value.replacement_candidate_id !== null)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.replacement_candidate_id",
      "Only a replaced candidate may name its replacement.",
    );
  }
  if (
    value.changed_by_user_id !== null &&
    !isNonEmptyString(value.changed_by_user_id)
  ) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.changed_by_user_id",
      "Candidate status actor must be a user identity or null.",
    );
  }
  if (!isIsoDateTime(value.changed_at)) {
    addCandidateIssue(
      issues,
      "CONTENT_SCHEMA_FAILURE",
      "candidate_status.changed_at",
      "Candidate status change time is invalid.",
    );
  }

  return { valid: issues.length === 0, issues };
}

export function validatePublicationCandidateHandoff(
  candidateValue: unknown,
  statusValue: unknown,
): ContentValidationResult {
  const candidateResult = validatePublicationCandidateV1(candidateValue);
  if (!candidateResult.valid) return candidateResult;

  const statusResult = validatePublicationCandidateStatusV1(statusValue);
  if (!statusResult.valid) return statusResult;

  const candidate = candidateValue as PublicationCandidateV1;
  const status = statusValue as PublicationCandidateStatusV1;
  if (
    status.candidate_id !== candidate.candidate_id ||
    status.business_id !== candidate.business_id ||
    status.candidate_checksum !== candidate.candidate_checksum
  ) {
    return {
      valid: false,
      issues: [
        {
          code: "CONTENT_CANDIDATE_TAMPERED",
          field: "candidate_status.candidate_checksum",
          message:
            "Candidate status does not bind the exact immutable candidate.",
          retryable: false,
        },
      ],
    };
  }

  if (
    status.candidate_state === "revoked" ||
    status.candidate_state === "replaced"
  ) {
    return {
      valid: false,
      issues: [
        {
          code: "CONTENT_CANDIDATE_REVOKED",
          field: "candidate_status.candidate_state",
          message: "Candidate is no longer active for publishing.",
          retryable: false,
        },
      ],
    };
  }

  return { valid: true, issues: [] };
}

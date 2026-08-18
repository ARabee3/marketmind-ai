import type { IsoDateTime, UUID } from "../content/content-types";

export type { IsoDateTime, UUID };

export const PUBLISHING_CONTRACT_VERSION = "publishing-v1" as const;

export const PUBLISHING_MODES = [
  "real",
  "manual_export",
  "simulation",
] as const;
export type PublishingMode = (typeof PUBLISHING_MODES)[number];

export const PUBLICATION_INTENT_STATES = [
  "draft",
  "awaiting_approval",
  "scheduled",
  "dispatching",
  "succeeded",
  "failed",
  "action_required",
  "cancelled",
] as const;
export type PublicationIntentState = (typeof PUBLICATION_INTENT_STATES)[number];

export const PUBLICATION_ATTEMPT_STATES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "unknown",
  "cancelled",
] as const;
export type PublicationAttemptState =
  (typeof PUBLICATION_ATTEMPT_STATES)[number];

export const PUBLICATION_OUTCOMES = [
  "published",
  "exported",
  "simulated",
  "failed",
  "cancelled",
  "unknown",
] as const;
export type PublicationOutcome = (typeof PUBLICATION_OUTCOMES)[number];

export const PUBLISHING_TARGET_CONNECTION_STATES = [
  "connected",
  "expired",
  "revoked",
  "error",
] as const;
export type PublishingTargetConnectionState =
  (typeof PUBLISHING_TARGET_CONNECTION_STATES)[number];

export const PUBLISHING_CAPABILITIES = ["static_image", "text"] as const;
export type PublishingCapability = (typeof PUBLISHING_CAPABILITIES)[number];

export const PUBLISHING_OPERATIONS = [
  "meta.publish_static_image",
  "meta.publish_text",
  "manual_export.build",
  "simulation.run",
] as const;
export type PublishingOperation = (typeof PUBLISHING_OPERATIONS)[number];

export const PUBLISHING_SIGNATURE_ALGORITHM = "hmac-sha256" as const;
export const PUBLISHING_SIGNATURE_TOLERANCE_SECONDS = 300;

export const PUBLISHING_ERROR_CODES = [
  "PUBLISHING_CONTRACT_UNSUPPORTED",
  "PUBLISHING_CANDIDATE_INVALID",
  "PUBLISHING_CANDIDATE_TAMPERED",
  "PUBLISHING_CANDIDATE_REVOKED",
  "PUBLISHING_TARGET_NOT_CONNECTED",
  "PUBLISHING_TARGET_UNAUTHORIZED",
  "PUBLISHING_FORMAT_UNSUPPORTED",
  "PUBLISHING_ASSET_UNAVAILABLE",
  "PUBLISHING_ASSET_TAMPERED",
  "PUBLISHING_SCHEDULE_IN_PAST",
  "PUBLISHING_APPROVAL_REQUIRED",
  "PUBLISHING_STATE_CONFLICT",
  "PUBLISHING_IDEMPOTENCY_CONFLICT",
  "PUBLISHING_DUPLICATE_DISPATCH",
  "PUBLISHING_WEBHOOK_UNAUTHORIZED",
  "PUBLISHING_WEBHOOK_TIMESTAMP_INVALID",
  "PUBLISHING_WEBHOOK_NONCE_REPLAYED",
  "PUBLISHING_PROVIDER_RATE_LIMITED",
  "PUBLISHING_PROVIDER_FAILURE",
  "PUBLISHING_MEDIA_ORIGIN_NOT_REACHABLE",
  "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
  "PUBLISHING_CALLBACK_INVALID",
  "PUBLISHING_CALLBACK_CONFLICT",
] as const;
export type PublishingErrorCode = (typeof PUBLISHING_ERROR_CODES)[number];

export type PublishingValidationIssue = {
  readonly code: PublishingErrorCode;
  readonly field: string;
  readonly message: string;
  readonly retryable: boolean;
};

export type PublishingValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly PublishingValidationIssue[];
};

export type PublishingReplayDisposition =
  | "new"
  | "identical_replay"
  | "conflict";

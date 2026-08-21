import type {
  PublicationCandidateStatusV1,
  PublicationCandidateV1,
} from "../content/publication-candidate";
import { validatePublicationCandidateHandoff } from "../content/publication-candidate";
import { validateAuthoritativePublicationCandidateV1 } from "./publication-candidate-state";
import {
  computePublishingSha256,
  isPublishingSignatureValid,
} from "./publishing-canonical";
import type {
  PublicationApprovalSnapshotV1,
  PublicationIntentV1,
  PublishingTargetV1,
} from "./publication-intent";
import { isPublicationApprovalFingerprintValid } from "./publication-intent";
import type {
  PublicationAttemptV1,
  PublicationResultV1,
} from "./publication-result";
import type {
  PublicationCallbackBodyV1,
  PublicationDispatchBodyV1,
  SignedPublicationCallbackEnvelopeV1,
  SignedPublicationDispatchEnvelopeV1,
} from "./publishing-envelope";
import type { PublicationCandidateRecordV1 } from "./publishing-interfaces";
import {
  PUBLICATION_ATTEMPT_STATES,
  PUBLICATION_INTENT_STATES,
  PUBLISHING_CAPABILITIES,
  PUBLISHING_ERROR_CODES,
  PUBLISHING_MODES,
  PUBLISHING_SIGNATURE_TOLERANCE_SECONDS,
  PUBLISHING_TARGET_CONNECTION_STATES,
  type PublishingErrorCode,
  type PublishingReplayDisposition,
  type PublishingValidationIssue,
  type PublishingValidationResult,
} from "./publishing-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const TARGET_FIELDS = new Set([
  "contract_version",
  "target_id",
  "version",
  "business_id",
  "provider",
  "channel",
  "external_account_id",
  "display_name",
  "connection_state",
  "credential_ref",
  "capabilities",
  "last_verified_at",
]);

const INTENT_FIELDS = new Set([
  "contract_version",
  "intent_id",
  "version",
  "business_id",
  "candidate_id",
  "candidate_checksum",
  "mode",
  "target_id",
  "scheduled_local",
  "time_zone",
  "scheduled_utc",
  "state",
  "approved_decision_id",
  "created_by_user_id",
  "created_at",
  "updated_at",
  "published_post_url",
]);

const APPROVAL_FIELDS = new Set([
  "contract_version",
  "decision_id",
  "intent_id",
  "intent_version",
  "candidate_id",
  "candidate_checksum",
  "mode",
  "target_id",
  "scheduled_local",
  "time_zone",
  "scheduled_utc",
  "decided_by_user_id",
  "decided_at",
  "approval_fingerprint",
]);

const ATTEMPT_FIELDS = new Set([
  "contract_version",
  "attempt_id",
  "intent_id",
  "intent_version",
  "attempt_number",
  "idempotency_key",
  "workflow_version",
  "request_fingerprint",
  "state",
  "started_at",
  "finished_at",
  "created_at",
]);

const RESULT_FIELDS = new Set([
  "contract_version",
  "result_id",
  "attempt_id",
  "intent_id",
  "intent_version",
  "mode",
  "outcome",
  "provider",
  "remote_publication_id",
  "remote_url",
  "export_artifact_id",
  "simulation_reference_id",
  "simulation_label",
  "error_code",
  "retryable",
  "reconciliation_required",
  "occurred_at",
]);

const ENVELOPE_FIELDS = new Set([
  "contract_version",
  "message_id",
  "sent_at",
  "nonce",
  "key_id",
  "signature_algorithm",
  "body_sha256",
  "signature",
  "body",
]);

const DISPATCH_BODY_FIELDS = new Set([
  "contract_version",
  "attempt_id",
  "intent_id",
  "intent_version",
  "business_id",
  "correlation_id",
  "idempotency_key",
  "workflow_version",
  "candidate",
  "candidate_status",
  "assets",
  "callback_url",
  "mode",
  "operation",
  "target",
  "approval",
  "scheduled_utc",
]);

const CALLBACK_BODY_FIELDS = new Set([
  "contract_version",
  "callback_id",
  "attempt_id",
  "intent_id",
  "intent_version",
  "request_fingerprint",
  "workflow_version",
  "result",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isIsoDateTime(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isLocalDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
  );
}

function isSafeInternalUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
}

export function isCairoSchedulePairConsistent(
  scheduledLocal: string,
  scheduledUtc: string,
): boolean {
  if (!isLocalDateTime(scheduledLocal) || !isIsoDateTime(scheduledUtc)) {
    return false;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(scheduledUtc))
    .reduce<Record<string, string>>((values, part) => {
      if (part.type !== "literal") values[part.type] = part.value;
      return values;
    }, {});
  return (
    scheduledLocal ===
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function addIssue(
  issues: PublishingValidationIssue[],
  code: PublishingErrorCode,
  field: string,
  message: string,
  retryable = false,
): void {
  issues.push({ code, field, message, retryable });
}

function firstIssue(
  code: PublishingErrorCode,
  field: string,
  message: string,
  retryable = false,
): PublishingValidationResult {
  return {
    valid: false,
    issues: [{ code, field, message, retryable }],
  };
}

function rejectExtraFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  issues: PublishingValidationIssue[],
  fieldPrefix: string,
): void {
  const extra = Object.keys(value).find((field) => !allowed.has(field));
  if (extra) {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      `${fieldPrefix}${extra}`,
      "Document contains a field outside the frozen publishing-v1 boundary.",
    );
  }
}

export function classifyPublishingReplay(
  existingFingerprint: string | null,
  incomingFingerprint: string,
): PublishingReplayDisposition {
  if (existingFingerprint === null) return "new";
  return existingFingerprint === incomingFingerprint
    ? "identical_replay"
    : "conflict";
}

export function publicationIntentJobKey(
  intentId: string,
  intentVersion: number,
): string {
  return `publishing:intent:${intentId}:v${intentVersion}`;
}

export function publicationAttemptIdempotencyKey(
  intentId: string,
  intentVersion: number,
  attemptNumber: number,
): string {
  return `publishing:${intentId}:v${intentVersion}:attempt:${attemptNumber}`;
}

export function validatePublicationScheduleInstant(
  scheduledUtc: string,
  now: string,
): PublishingValidationResult {
  if (!isIsoDateTime(scheduledUtc) || !isIsoDateTime(now)) {
    return firstIssue(
      "PUBLISHING_STATE_CONFLICT",
      "scheduled_utc",
      "Schedule and comparison time must be valid ISO date-times.",
    );
  }
  if (Date.parse(scheduledUtc) <= Date.parse(now)) {
    return firstIssue(
      "PUBLISHING_SCHEDULE_IN_PAST",
      "scheduled_utc",
      "Publication schedule must be in the future.",
    );
  }
  return { valid: true, issues: [] };
}

export function requiresPublicationApprovalInvalidation(
  current: Pick<
    PublicationIntentV1,
    | "candidate_id"
    | "candidate_checksum"
    | "mode"
    | "target_id"
    | "scheduled_local"
    | "time_zone"
    | "scheduled_utc"
  >,
  next: Pick<
    PublicationIntentV1,
    | "candidate_id"
    | "candidate_checksum"
    | "mode"
    | "target_id"
    | "scheduled_local"
    | "time_zone"
    | "scheduled_utc"
  >,
): boolean {
  return (
    current.candidate_id !== next.candidate_id ||
    current.candidate_checksum !== next.candidate_checksum ||
    current.mode !== next.mode ||
    current.target_id !== next.target_id ||
    current.scheduled_local !== next.scheduled_local ||
    current.time_zone !== next.time_zone ||
    current.scheduled_utc !== next.scheduled_utc
  );
}

export function validateCandidateForPublishing(
  candidate: unknown,
  status: unknown,
): PublishingValidationResult {
  const contentResult = validatePublicationCandidateHandoff(candidate, status);
  if (contentResult.valid) return { valid: true, issues: [] };

  const contentCode = contentResult.issues[0]?.code;
  if (contentCode === "CONTENT_CANDIDATE_TAMPERED") {
    return firstIssue(
      "PUBLISHING_CANDIDATE_TAMPERED",
      contentResult.issues[0].field,
      contentResult.issues[0].message,
    );
  }
  if (contentCode === "CONTENT_CANDIDATE_REVOKED") {
    return firstIssue(
      "PUBLISHING_CANDIDATE_REVOKED",
      contentResult.issues[0].field,
      contentResult.issues[0].message,
    );
  }
  return firstIssue(
    "PUBLISHING_CANDIDATE_INVALID",
    contentResult.issues[0]?.field ?? "candidate",
    contentResult.issues[0]?.message ?? "Candidate is invalid.",
  );
}

export function validatePublishingTargetV1(
  value: unknown,
): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_TARGET_NOT_CONNECTED",
      "target",
      "Publishing target must be an object.",
    );
  }
  rejectExtraFields(value, TARGET_FIELDS, issues, "target.");
  if (value.contract_version !== "publishing-target-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "target.contract_version",
      "Publishing target contract version is unsupported.",
    );
  }
  for (const field of ["target_id", "business_id"] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_TARGET_NOT_CONNECTED",
        `target.${field}`,
        `Publishing target ${field} must be a UUID.`,
      );
    }
  }
  if (!isPositiveInteger(value.version)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "target.version",
      "Publishing target version must be a positive integer.",
    );
  }
  for (const field of [
    "external_account_id",
    "display_name",
    "credential_ref",
  ] as const) {
    if (!isNonEmptyString(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_TARGET_NOT_CONNECTED",
        `target.${field}`,
        `Publishing target ${field} is required.`,
      );
    }
  }
  if (value.provider !== "meta") {
    addIssue(
      issues,
      "PUBLISHING_FORMAT_UNSUPPORTED",
      "target.provider",
      "Sprint 5 publishing supports the Meta provider only.",
    );
  }
  if (value.channel !== "facebook" && value.channel !== "instagram") {
    addIssue(
      issues,
      "PUBLISHING_FORMAT_UNSUPPORTED",
      "target.channel",
      "Publishing target channel is unsupported.",
    );
  }
  if (
    !(PUBLISHING_TARGET_CONNECTION_STATES as readonly unknown[]).includes(
      value.connection_state,
    )
  ) {
    addIssue(
      issues,
      "PUBLISHING_TARGET_NOT_CONNECTED",
      "target.connection_state",
      "Publishing target connection state is unsupported.",
    );
  }
  if (
    !Array.isArray(value.capabilities) ||
    value.capabilities.length === 0 ||
    value.capabilities.some(
      (capability) =>
        !(PUBLISHING_CAPABILITIES as readonly unknown[]).includes(capability),
    ) ||
    new Set(value.capabilities).size !== value.capabilities.length
  ) {
    addIssue(
      issues,
      "PUBLISHING_FORMAT_UNSUPPORTED",
      "target.capabilities",
      "Publishing target capabilities must be unique supported values.",
    );
  }
  if (
    value.last_verified_at !== null &&
    !isIsoDateTime(value.last_verified_at)
  ) {
    addIssue(
      issues,
      "PUBLISHING_TARGET_NOT_CONNECTED",
      "target.last_verified_at",
      "Target verification time is invalid.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validatePublicationIntentV1(
  value: unknown,
): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_STATE_CONFLICT",
      "intent",
      "Publication intent must be an object.",
    );
  }
  rejectExtraFields(value, INTENT_FIELDS, issues, "intent.");
  if (value.contract_version !== "publication-intent-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "intent.contract_version",
      "Publication intent contract version is unsupported.",
    );
  }
  for (const field of [
    "intent_id",
    "business_id",
    "candidate_id",
    "created_by_user_id",
  ] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        `intent.${field}`,
        `Publication intent ${field} must be a UUID.`,
      );
    }
  }
  if (!isPositiveInteger(value.version)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.version",
      "Publication intent version must be a positive integer.",
    );
  }
  if (!isSha256(value.candidate_checksum)) {
    addIssue(
      issues,
      "PUBLISHING_CANDIDATE_TAMPERED",
      "intent.candidate_checksum",
      "Intent must bind the exact candidate checksum.",
    );
  }
  if (!(PUBLISHING_MODES as readonly unknown[]).includes(value.mode)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.mode",
      "Publication mode is unsupported.",
    );
  }
  if (
    !(PUBLICATION_INTENT_STATES as readonly unknown[]).includes(value.state)
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.state",
      "Publication intent state is unsupported.",
    );
  }

  const completeRealSchedule =
    isUuid(value.target_id) &&
    isLocalDateTime(value.scheduled_local) &&
    value.time_zone === "Africa/Cairo" &&
    isIsoDateTime(value.scheduled_utc);
  const emptySchedule =
    value.target_id === null &&
    value.scheduled_local === null &&
    value.time_zone === null &&
    value.scheduled_utc === null;
  if (value.mode === "real") {
    if (!completeRealSchedule && !(value.state === "draft" && emptySchedule)) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        "intent.scheduled_utc",
        "A real intent outside its initial draft must have one complete Cairo schedule and target.",
      );
    }
    if (
      completeRealSchedule &&
      !isCairoSchedulePairConsistent(
        String(value.scheduled_local),
        String(value.scheduled_utc),
      )
    ) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        "intent.scheduled_utc",
        "Cairo-local schedule does not match its normalized UTC instant.",
      );
    }
  } else if (!emptySchedule) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.target_id",
      "Export and simulation intents cannot carry a real target or schedule.",
    );
  }

  const approvalRequiredStates = new Set([
    "scheduled",
    "dispatching",
    "succeeded",
    "failed",
    "action_required",
  ]);
  if (
    value.mode === "real" &&
    approvalRequiredStates.has(String(value.state)) &&
    !isUuid(value.approved_decision_id)
  ) {
    addIssue(
      issues,
      "PUBLISHING_APPROVAL_REQUIRED",
      "intent.approved_decision_id",
      "Real dispatch and result states require an exact approval decision.",
    );
  }
  if (value.mode !== "real" && value.approved_decision_id !== null) {
    addIssue(
      issues,
      "PUBLISHING_APPROVAL_REQUIRED",
      "intent.approved_decision_id",
      "Export and simulation cannot claim real-publication approval.",
    );
  }
  if (
    value.mode !== "real" &&
    (value.state === "awaiting_approval" ||
      value.state === "scheduled" ||
      value.state === "action_required")
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.state",
      "Export and simulation do not use real-publication approval states.",
    );
  }
  if (!isIsoDateTime(value.created_at) || !isIsoDateTime(value.updated_at)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.updated_at",
      "Intent timestamps must be valid ISO date-times.",
    );
  } else if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "intent.updated_at",
      "Intent update time cannot precede creation.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validatePublicationApprovalSnapshotV1(
  value: unknown,
): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_APPROVAL_REQUIRED",
      "approval",
      "Publication approval must be an object.",
    );
  }
  rejectExtraFields(value, APPROVAL_FIELDS, issues, "approval.");
  if (value.contract_version !== "publication-approval-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "approval.contract_version",
      "Publication approval contract version is unsupported.",
    );
  }
  for (const field of [
    "decision_id",
    "intent_id",
    "candidate_id",
    "target_id",
    "decided_by_user_id",
  ] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_APPROVAL_REQUIRED",
        `approval.${field}`,
        `Publication approval ${field} must be a UUID.`,
      );
    }
  }
  if (!isPositiveInteger(value.intent_version)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "approval.intent_version",
      "Approval intent version must be a positive integer.",
    );
  }
  if (!isSha256(value.candidate_checksum)) {
    addIssue(
      issues,
      "PUBLISHING_CANDIDATE_TAMPERED",
      "approval.candidate_checksum",
      "Approval must bind a candidate checksum.",
    );
  }
  if (
    value.mode !== "real" ||
    !isLocalDateTime(value.scheduled_local) ||
    value.time_zone !== "Africa/Cairo" ||
    !isIsoDateTime(value.scheduled_utc) ||
    !isIsoDateTime(value.decided_at)
  ) {
    addIssue(
      issues,
      "PUBLISHING_APPROVAL_REQUIRED",
      "approval.scheduled_utc",
      "Approval must bind the exact real mode and complete Cairo schedule.",
    );
  } else if (
    !isCairoSchedulePairConsistent(
      String(value.scheduled_local),
      String(value.scheduled_utc),
    )
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "approval.scheduled_utc",
      "Approval Cairo-local time does not match its normalized UTC instant.",
    );
  }
  if (!isSha256(value.approval_fingerprint)) {
    addIssue(
      issues,
      "PUBLISHING_APPROVAL_REQUIRED",
      "approval.approval_fingerprint",
      "Approval fingerprint must be a lowercase SHA-256 digest.",
    );
  } else if (
    !isPublicationApprovalFingerprintValid(
      value as PublicationApprovalSnapshotV1,
    )
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "approval.approval_fingerprint",
      "Approval fingerprint does not match the exact approved action.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validateExactPublicationApproval(input: {
  readonly intent: unknown;
  readonly candidate: unknown;
  readonly status: unknown;
  readonly target: unknown;
  readonly approval: unknown;
}): PublishingValidationResult {
  for (const result of [
    validatePublicationIntentV1(input.intent),
    validateCandidateForPublishing(input.candidate, input.status),
    validatePublishingTargetV1(input.target),
    validatePublicationApprovalSnapshotV1(input.approval),
  ]) {
    if (!result.valid) return result;
  }

  const intent = input.intent as PublicationIntentV1;
  const candidate = input.candidate as PublicationCandidateV1;
  const target = input.target as PublishingTargetV1;
  const approval = input.approval as PublicationApprovalSnapshotV1;
  if (
    intent.mode !== "real" ||
    approval.intent_id !== intent.intent_id ||
    approval.intent_version !== intent.version ||
    approval.candidate_id !== intent.candidate_id ||
    approval.candidate_id !== candidate.candidate_id ||
    approval.candidate_checksum !== intent.candidate_checksum ||
    approval.candidate_checksum !== candidate.candidate_checksum ||
    approval.target_id !== intent.target_id ||
    approval.target_id !== target.target_id ||
    approval.scheduled_local !== intent.scheduled_local ||
    approval.time_zone !== intent.time_zone ||
    approval.scheduled_utc !== intent.scheduled_utc ||
    intent.approved_decision_id !== approval.decision_id
  ) {
    return firstIssue(
      "PUBLISHING_STATE_CONFLICT",
      "approval.intent_version",
      "Approval does not bind the exact current candidate, target, mode, schedule, and intent version.",
    );
  }
  if (
    target.business_id !== intent.business_id ||
    candidate.business_id !== intent.business_id ||
    target.channel !== candidate.target_channel
  ) {
    return firstIssue(
      "PUBLISHING_STATE_CONFLICT",
      "target.business_id",
      "Candidate, target, and intent must belong to the same business and channel.",
    );
  }
  if (target.connection_state !== "connected") {
    return firstIssue(
      "PUBLISHING_TARGET_UNAUTHORIZED",
      "target.connection_state",
      "Real publication requires a currently connected target.",
    );
  }
  const requiredCapability =
    candidate.content_format === "static_image_post"
      ? "static_image"
      : candidate.content_format === "text_post"
        ? "text"
        : null;
  if (
    !requiredCapability ||
    !target.capabilities.includes(requiredCapability)
  ) {
    return firstIssue(
      "PUBLISHING_FORMAT_UNSUPPORTED",
      "candidate.content_format",
      "Real publishing requires a target capability matching the approved post format.",
    );
  }
  return { valid: true, issues: [] };
}

export function validatePublicationAttemptV1(
  value: unknown,
): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_STATE_CONFLICT",
      "attempt",
      "Publication attempt must be an object.",
    );
  }
  rejectExtraFields(value, ATTEMPT_FIELDS, issues, "attempt.");
  if (value.contract_version !== "publication-attempt-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "attempt.contract_version",
      "Publication attempt contract version is unsupported.",
    );
  }
  for (const field of ["attempt_id", "intent_id"] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        `attempt.${field}`,
        `Publication attempt ${field} must be a UUID.`,
      );
    }
  }
  for (const field of ["intent_version", "attempt_number"] as const) {
    if (!isPositiveInteger(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        `attempt.${field}`,
        `Publication attempt ${field} must be a positive integer.`,
      );
    }
  }
  if (
    !isNonEmptyString(value.idempotency_key) ||
    !isNonEmptyString(value.workflow_version) ||
    !isSha256(value.request_fingerprint)
  ) {
    addIssue(
      issues,
      "PUBLISHING_IDEMPOTENCY_CONFLICT",
      "attempt.request_fingerprint",
      "Attempt requires stable idempotency, workflow, and request-fingerprint identities.",
    );
  }
  if (
    !(PUBLICATION_ATTEMPT_STATES as readonly unknown[]).includes(value.state)
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "attempt.state",
      "Publication attempt state is unsupported.",
    );
  }
  if (
    !isIsoDateTime(value.created_at) ||
    (value.started_at !== null && !isIsoDateTime(value.started_at)) ||
    (value.finished_at !== null && !isIsoDateTime(value.finished_at))
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "attempt.created_at",
      "Attempt timestamps must be valid ISO date-times or null.",
    );
  }
  if (
    (value.state === "queued" &&
      (value.started_at !== null || value.finished_at !== null)) ||
    (value.state === "running" &&
      (!isIsoDateTime(value.started_at) || value.finished_at !== null)) ||
    (["succeeded", "failed", "unknown", "cancelled"].includes(
      String(value.state),
    ) &&
      !isIsoDateTime(value.finished_at))
  ) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "attempt.finished_at",
      "Attempt timestamps do not match its lifecycle state.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validatePublicationResultV1(
  value: unknown,
): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_CALLBACK_INVALID",
      "result",
      "Publication result must be an object.",
    );
  }
  rejectExtraFields(value, RESULT_FIELDS, issues, "result.");
  if (value.contract_version !== "publication-result-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "result.contract_version",
      "Publication result contract version is unsupported.",
    );
  }
  for (const field of ["result_id", "attempt_id", "intent_id"] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        `result.${field}`,
        `Publication result ${field} must be a UUID.`,
      );
    }
  }
  if (!isPositiveInteger(value.intent_version)) {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "result.intent_version",
      "Result intent version must be positive.",
    );
  }
  if (!isIsoDateTime(value.occurred_at)) {
    addIssue(
      issues,
      "PUBLISHING_CALLBACK_INVALID",
      "result.occurred_at",
      "Result occurrence time is invalid.",
    );
  }

  const mode = value.mode;
  const outcome = value.outcome;
  const emptyRemote =
    value.remote_publication_id === null && value.remote_url === null;
  const noArtifact = value.export_artifact_id === null;
  const noSimulation =
    value.simulation_reference_id === null && value.simulation_label === null;
  const commonSuccess =
    value.error_code === null &&
    value.retryable === false &&
    value.reconciliation_required === false;

  if (outcome === "published") {
    if (
      mode !== "real" ||
      value.provider !== "meta" ||
      !isNonEmptyString(value.remote_publication_id) ||
      (value.remote_url !== null && !isNonEmptyString(value.remote_url)) ||
      !noArtifact ||
      !noSimulation ||
      !commonSuccess
    ) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        "result.outcome",
        "Published means only a provider-confirmed real Meta publication.",
      );
    }
  } else if (outcome === "exported") {
    if (
      mode !== "manual_export" ||
      value.provider !== null ||
      !emptyRemote ||
      !isUuid(value.export_artifact_id) ||
      !noSimulation ||
      !commonSuccess
    ) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        "result.outcome",
        "Exported means only a generated checksum-addressed export artifact.",
      );
    }
  } else if (outcome === "simulated") {
    if (
      mode !== "simulation" ||
      value.provider !== null ||
      !emptyRemote ||
      !noArtifact ||
      !isNonEmptyString(value.simulation_reference_id) ||
      value.simulation_label !== "SIMULATION" ||
      !commonSuccess
    ) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        "result.simulation_label",
        "Simulated results require a permanent SIMULATION label and cannot claim remote publication.",
      );
    }
  } else if (outcome === "unknown") {
    if (
      mode !== "real" ||
      value.provider !== "meta" ||
      !emptyRemote ||
      !noArtifact ||
      !noSimulation ||
      value.error_code !== "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN" ||
      value.retryable !== false ||
      value.reconciliation_required !== true
    ) {
      addIssue(
        issues,
        "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
        "result.outcome",
        "Unknown is a non-retryable ambiguous real-provider outcome requiring reconciliation.",
      );
    }
  } else if (outcome === "failed") {
    if (
      !(PUBLISHING_MODES as readonly unknown[]).includes(mode) ||
      !emptyRemote ||
      !noArtifact ||
      value.simulation_reference_id !== null ||
      (mode === "simulation"
        ? value.simulation_label !== "SIMULATION"
        : value.simulation_label !== null) ||
      !(PUBLISHING_ERROR_CODES as readonly unknown[]).includes(
        value.error_code,
      ) ||
      value.error_code === "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN" ||
      typeof value.retryable !== "boolean" ||
      value.reconciliation_required !== false ||
      (mode === "real"
        ? value.provider !== "meta" && value.provider !== null
        : value.provider !== null)
    ) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        "result.error_code",
        "Failed must be a proven, sanitized failure and cannot carry success artifacts.",
      );
    }
  } else if (outcome === "cancelled") {
    if (
      !(PUBLISHING_MODES as readonly unknown[]).includes(mode) ||
      value.provider !== null ||
      !emptyRemote ||
      !noArtifact ||
      value.simulation_reference_id !== null ||
      (mode === "simulation"
        ? value.simulation_label !== "SIMULATION"
        : value.simulation_label !== null) ||
      !commonSuccess
    ) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        "result.outcome",
        "Cancelled cannot claim an external, export, or simulation success.",
      );
    }
  } else {
    addIssue(
      issues,
      "PUBLISHING_CALLBACK_INVALID",
      "result.outcome",
      "Publication outcome is unsupported.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export type PublishingEnvelopeValidationContext = {
  readonly secret: string;
  readonly expected_key_id: string;
  readonly now: IsoDateTimeString;
  readonly seen_nonces?: ReadonlySet<string>;
};

type IsoDateTimeString = string;

function validateEnvelopeCommon(
  value: unknown,
  expectedContract: string,
  context: PublishingEnvelopeValidationContext,
): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "envelope",
      "Signed publishing envelope must be an object.",
    );
  }
  rejectExtraFields(value, ENVELOPE_FIELDS, issues, "envelope.");
  if (value.contract_version !== expectedContract) {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "envelope.contract_version",
      "Signed envelope contract version is unsupported.",
    );
  }
  if (!isUuid(value.message_id)) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "envelope.message_id",
      "Signed envelope message identity must be a UUID.",
    );
  }
  if (
    !isIsoDateTime(value.sent_at) ||
    !isIsoDateTime(context.now) ||
    Math.abs(Date.parse(context.now) - Date.parse(String(value.sent_at))) >
      PUBLISHING_SIGNATURE_TOLERANCE_SECONDS * 1000
  ) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_TIMESTAMP_INVALID",
      "envelope.sent_at",
      "Signed envelope timestamp is outside the five-minute acceptance window.",
    );
  }
  if (!isNonEmptyString(value.nonce) || value.nonce.length < 16) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "envelope.nonce",
      "Signed envelope nonce must contain at least 16 characters.",
    );
  } else if (context.seen_nonces?.has(value.nonce)) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_NONCE_REPLAYED",
      "envelope.nonce",
      "Signed envelope nonce has already been consumed.",
    );
  }
  if (
    !isNonEmptyString(value.key_id) ||
    value.key_id !== context.expected_key_id ||
    value.signature_algorithm !== "hmac-sha256" ||
    !isSha256(value.body_sha256) ||
    !isSha256(value.signature)
  ) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "envelope.signature",
      "Signed envelope authentication fields are incomplete.",
    );
  } else if (computePublishingSha256(value.body) !== value.body_sha256) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "envelope.body_sha256",
      "Signed envelope body checksum does not match its canonical body.",
    );
  } else if (
    !isPublishingSignatureValid(
      {
        contract_version: String(value.contract_version),
        sent_at: String(value.sent_at),
        nonce: String(value.nonce),
        body_sha256: value.body_sha256,
      },
      value.signature,
      context.secret,
    )
  ) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "envelope.signature",
      "Signed envelope signature is invalid.",
    );
  }
  return { valid: issues.length === 0, issues };
}

function validateDispatchBody(value: unknown): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_STATE_CONFLICT",
      "dispatch.body",
      "Dispatch body must be an object.",
    );
  }
  rejectExtraFields(value, DISPATCH_BODY_FIELDS, issues, "dispatch.body.");
  if (value.contract_version !== "publication-dispatch-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "dispatch.body.contract_version",
      "Dispatch body contract version is unsupported.",
    );
  }
  for (const field of [
    "attempt_id",
    "intent_id",
    "business_id",
    "correlation_id",
  ] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        `dispatch.body.${field}`,
        `Dispatch ${field} must be a UUID.`,
      );
    }
  }
  if (
    !isPositiveInteger(value.intent_version) ||
    !isNonEmptyString(value.idempotency_key) ||
    !isNonEmptyString(value.workflow_version)
  ) {
    addIssue(
      issues,
      "PUBLISHING_IDEMPOTENCY_CONFLICT",
      "dispatch.body.idempotency_key",
      "Dispatch requires an intent version, idempotency key, and workflow version.",
    );
  }
  const candidateResult = validateCandidateForPublishing(
    value.candidate,
    value.candidate_status,
  );
  if (!candidateResult.valid) return candidateResult;
  const candidate = value.candidate as PublicationCandidateV1;
  const status = value.candidate_status as PublicationCandidateStatusV1;
  if (candidate.business_id !== value.business_id || status.state_version < 1) {
    addIssue(
      issues,
      "PUBLISHING_CANDIDATE_TAMPERED",
      "dispatch.body.business_id",
      "Dispatch identities must bind the active immutable candidate.",
    );
  }
  if (!Array.isArray(value.assets)) {
    addIssue(
      issues,
      "PUBLISHING_ASSET_UNAVAILABLE",
      "dispatch.body.assets",
      "Dispatch assets must be an array.",
    );
  } else {
    const candidateAssets = new Map(
      candidate.assets.map((asset) => [asset.asset_id, asset]),
    );
    const seenAssetIds = new Set<string>();
    if (value.assets.length !== candidate.assets.length) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_TAMPERED",
        "dispatch.body.assets",
        "Dispatch asset count must match the immutable candidate.",
      );
    }
    if (candidate.content_format !== "text_post" && value.assets.length === 0) {
      addIssue(
        issues,
        "PUBLISHING_ASSET_UNAVAILABLE",
        "dispatch.body.assets",
        "Media publishing requires short-lived retrieval data for every candidate asset.",
      );
    }
    for (const [index, rawAsset] of value.assets.entries()) {
      if (!isRecord(rawAsset)) {
        addIssue(
          issues,
          "PUBLISHING_ASSET_UNAVAILABLE",
          `dispatch.body.assets[${index}]`,
          "Dispatch asset must be an object.",
        );
        continue;
      }
      const assetId = String(rawAsset.asset_id);
      const candidateAsset = candidateAssets.get(assetId);
      if (
        !candidateAsset ||
        seenAssetIds.has(assetId) ||
        !isSha256(rawAsset.checksum) ||
        candidateAsset.checksum !== rawAsset.checksum ||
        candidateAsset.mime_type !== rawAsset.mime_type
      ) {
        addIssue(
          issues,
          "PUBLISHING_ASSET_TAMPERED",
          `dispatch.body.assets[${index}].checksum`,
          "Dispatch asset identity, MIME type, and checksum must match the candidate.",
        );
      }
      seenAssetIds.add(assetId);
      if (
        !isSafeInternalUrl(rawAsset.retrieval_url) ||
        !isIsoDateTime(rawAsset.retrieval_expires_at)
      ) {
        addIssue(
          issues,
          "PUBLISHING_ASSET_UNAVAILABLE",
          `dispatch.body.assets[${index}].retrieval_url`,
          "Dispatch asset requires a short-lived retrieval URL and expiry.",
        );
      }
    }
  }
  if (!isSafeInternalUrl(value.callback_url)) {
    addIssue(
      issues,
      "PUBLISHING_WEBHOOK_UNAUTHORIZED",
      "dispatch.body.callback_url",
      "Callback URL must use HTTPS outside localhost.",
    );
  }

  if (value.mode === "real") {
    const expectedOperation =
      candidate.content_format === "text_post"
        ? "meta.publish_text"
        : "meta.publish_static_image";
    if (
      value.operation !== expectedOperation ||
      value.scheduled_utc === null ||
      value.target === null ||
      value.approval === null
    ) {
      addIssue(
        issues,
        "PUBLISHING_APPROVAL_REQUIRED",
        "dispatch.body.approval",
        "Real dispatch requires the Meta operation, target, schedule, and exact approval.",
      );
    } else {
      const targetResult = validatePublishingTargetV1(value.target);
      if (!targetResult.valid) return targetResult;
      const approvalResult = validatePublicationApprovalSnapshotV1(
        value.approval,
      );
      if (!approvalResult.valid) return approvalResult;

      const target = value.target as PublishingTargetV1;
      const approval = value.approval as PublicationApprovalSnapshotV1;
      if (
        approval.intent_id !== value.intent_id ||
        approval.intent_version !== value.intent_version ||
        approval.candidate_id !== candidate.candidate_id ||
        approval.candidate_checksum !== candidate.candidate_checksum ||
        approval.target_id !== target.target_id ||
        approval.scheduled_utc !== value.scheduled_utc
      ) {
        addIssue(
          issues,
          "PUBLISHING_STATE_CONFLICT",
          "dispatch.body.approval",
          "Dispatch approval must bind the exact intent version, candidate, target, and schedule.",
        );
      }
      if (
        target.business_id !== value.business_id ||
        target.channel !== candidate.target_channel
      ) {
        addIssue(
          issues,
          "PUBLISHING_STATE_CONFLICT",
          "dispatch.body.target",
          "Dispatch target must belong to the candidate business and channel.",
        );
      }
      if (target.connection_state !== "connected") {
        addIssue(
          issues,
          "PUBLISHING_TARGET_UNAUTHORIZED",
          "dispatch.body.target.connection_state",
          "Real dispatch requires a currently connected target.",
        );
      }
      const requiredCapability =
        candidate.content_format === "static_image_post"
          ? "static_image"
          : candidate.content_format === "text_post"
            ? "text"
            : null;
      if (
        !requiredCapability ||
        !target.capabilities.includes(requiredCapability)
      ) {
        addIssue(
          issues,
          "PUBLISHING_FORMAT_UNSUPPORTED",
          "dispatch.body.candidate.content_format",
          "Real dispatch requires a target capability matching the approved post format.",
        );
      }
    }
  } else if (value.mode === "manual_export") {
    if (
      value.operation !== "manual_export.build" ||
      value.target !== null ||
      value.approval !== null ||
      value.scheduled_utc !== null
    ) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        "dispatch.body.operation",
        "Manual export cannot carry a provider target, schedule, or real approval.",
      );
    }
  } else if (value.mode === "simulation") {
    if (
      value.operation !== "simulation.run" ||
      value.target !== null ||
      value.approval !== null ||
      value.scheduled_utc !== null
    ) {
      addIssue(
        issues,
        "PUBLISHING_STATE_CONFLICT",
        "dispatch.body.operation",
        "Simulation cannot carry a provider target, schedule, or real approval.",
      );
    }
  } else {
    addIssue(
      issues,
      "PUBLISHING_STATE_CONFLICT",
      "dispatch.body.mode",
      "Dispatch mode is unsupported.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validateSignedPublicationDispatchEnvelopeV1(
  value: unknown,
  context: PublishingEnvelopeValidationContext,
): PublishingValidationResult {
  const envelopeResult = validateEnvelopeCommon(
    value,
    "publishing-dispatch-envelope-v1",
    context,
  );
  if (!envelopeResult.valid) return envelopeResult;
  return validateDispatchBody(
    (value as SignedPublicationDispatchEnvelopeV1).body,
  );
}

function validateCallbackBody(value: unknown): PublishingValidationResult {
  const issues: PublishingValidationIssue[] = [];
  if (!isRecord(value)) {
    return firstIssue(
      "PUBLISHING_CALLBACK_INVALID",
      "callback.body",
      "Callback body must be an object.",
    );
  }
  rejectExtraFields(value, CALLBACK_BODY_FIELDS, issues, "callback.body.");
  if (value.contract_version !== "publication-callback-v1") {
    addIssue(
      issues,
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "callback.body.contract_version",
      "Callback body contract version is unsupported.",
    );
  }
  for (const field of ["callback_id", "attempt_id", "intent_id"] as const) {
    if (!isUuid(value[field])) {
      addIssue(
        issues,
        "PUBLISHING_CALLBACK_INVALID",
        `callback.body.${field}`,
        `Callback ${field} must be a UUID.`,
      );
    }
  }
  if (
    !isPositiveInteger(value.intent_version) ||
    !isSha256(value.request_fingerprint) ||
    !isNonEmptyString(value.workflow_version)
  ) {
    addIssue(
      issues,
      "PUBLISHING_CALLBACK_INVALID",
      "callback.body.request_fingerprint",
      "Callback must bind the exact request fingerprint and workflow version.",
    );
  }
  const resultValidation = validatePublicationResultV1(value.result);
  if (!resultValidation.valid) return resultValidation;
  const result = value.result as PublicationResultV1;
  if (
    result.attempt_id !== value.attempt_id ||
    result.intent_id !== value.intent_id ||
    result.intent_version !== value.intent_version
  ) {
    addIssue(
      issues,
      "PUBLISHING_CALLBACK_INVALID",
      "callback.body.result.attempt_id",
      "Callback result identities must match the callback boundary.",
    );
  }
  return { valid: issues.length === 0, issues };
}

export function validateSignedPublicationCallbackEnvelopeV1(
  value: unknown,
  context: PublishingEnvelopeValidationContext,
): PublishingValidationResult {
  const envelopeResult = validateEnvelopeCommon(
    value,
    "publishing-callback-envelope-v1",
    context,
  );
  if (!envelopeResult.valid) return envelopeResult;
  return validateCallbackBody(
    (value as SignedPublicationCallbackEnvelopeV1).body,
  );
}

export function validatePublicationDispatchContext(input: {
  readonly envelope: unknown;
  readonly intent: unknown;
  readonly attempt: unknown;
  readonly candidate_record: PublicationCandidateRecordV1 | unknown;
  readonly context: PublishingEnvelopeValidationContext;
}): PublishingValidationResult {
  for (const result of [
    validateSignedPublicationDispatchEnvelopeV1(input.envelope, input.context),
    validatePublicationIntentV1(input.intent),
    validatePublicationAttemptV1(input.attempt),
  ]) {
    if (!result.valid) return result;
  }
  const envelope = input.envelope as SignedPublicationDispatchEnvelopeV1;
  const body = envelope.body;
  const intent = input.intent as PublicationIntentV1;
  const attempt = input.attempt as PublicationAttemptV1;
  const candidateResult = validateAuthoritativePublicationCandidateV1({
    record: input.candidate_record,
    candidate: body.candidate,
    status: body.candidate_status,
  });
  if (!candidateResult.valid) return candidateResult;
  if (
    body.attempt_id !== attempt.attempt_id ||
    body.intent_id !== intent.intent_id ||
    body.intent_id !== attempt.intent_id ||
    body.intent_version !== intent.version ||
    body.intent_version !== attempt.intent_version ||
    body.idempotency_key !== attempt.idempotency_key ||
    body.workflow_version !== attempt.workflow_version ||
    body.mode !== intent.mode ||
    body.candidate.candidate_id !== intent.candidate_id ||
    body.candidate.candidate_checksum !== intent.candidate_checksum ||
    attempt.request_fingerprint !== envelope.body_sha256
  ) {
    return firstIssue(
      "PUBLISHING_IDEMPOTENCY_CONFLICT",
      "dispatch.body.attempt_id",
      "Dispatch, intent, attempt, candidate, workflow, and request fingerprint must bind one exact operation.",
    );
  }
  if (body.mode === "real") {
    return validateExactPublicationApproval({
      intent,
      candidate: body.candidate,
      status: body.candidate_status,
      target: body.target,
      approval: body.approval,
    });
  }
  return { valid: true, issues: [] };
}

export function validatePublicationCallbackContext(input: {
  readonly envelope: unknown;
  readonly attempt: unknown;
  readonly context: PublishingEnvelopeValidationContext;
}): PublishingValidationResult {
  for (const result of [
    validateSignedPublicationCallbackEnvelopeV1(input.envelope, input.context),
    validatePublicationAttemptV1(input.attempt),
  ]) {
    if (!result.valid) return result;
  }
  const body = (input.envelope as SignedPublicationCallbackEnvelopeV1).body;
  const attempt = input.attempt as PublicationAttemptV1;
  if (
    body.attempt_id !== attempt.attempt_id ||
    body.intent_id !== attempt.intent_id ||
    body.intent_version !== attempt.intent_version ||
    body.request_fingerprint !== attempt.request_fingerprint ||
    body.workflow_version !== attempt.workflow_version
  ) {
    return firstIssue(
      "PUBLISHING_CALLBACK_CONFLICT",
      "callback.body.request_fingerprint",
      "Callback must bind the exact accepted attempt, request fingerprint, and workflow version.",
    );
  }
  return { valid: true, issues: [] };
}

export function computeDispatchRequestFingerprint(
  body: PublicationDispatchBodyV1,
): string {
  return computePublishingSha256(body);
}

export function computeCallbackFingerprint(
  body: PublicationCallbackBodyV1,
): string {
  return computePublishingSha256(body);
}

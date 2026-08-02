import type {
  PublicationCandidateCreatedEventV1,
  PublicationCandidateStateChangedEventV1,
  PublicationCandidateStatusV1,
  PublicationCandidateV1,
} from "../content/publication-candidate";
import {
  validatePublicationCandidateHandoff,
  validatePublicationCandidateStatusV1,
  validatePublicationCandidateV1,
} from "../content/publication-candidate";
import { isSha256Checksum } from "../content/content-types";
import { computePublishingSha256 } from "./publishing-canonical";
import type { PublicationCandidateRecordV1 } from "./publishing-interfaces";
import type {
  PublishingErrorCode,
  PublishingValidationIssue,
  PublishingValidationResult,
} from "./publishing-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_FIELDS = new Set([
  "event_id",
  "event_type",
  "occurred_at",
  "correlation_id",
  "payload",
]);
const CANDIDATE_RECORD_FIELDS = new Set([
  "contract_version",
  "candidate_id",
  "event_id",
  "business_id",
  "candidate_checksum",
  "event_fingerprint",
  "source_state",
  "source_state_version",
  "source_status",
  "received_at",
  "payload",
]);

export type PublicationCandidateIntakeDisposition =
  | "applied"
  | "identical_replay"
  | "rejected_stale"
  | "rejected_conflict"
  | "rejected_invalid";

export type PublicationCandidateIntakeResultV1 = {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly disposition: PublicationCandidateIntakeDisposition;
  readonly record: PublicationCandidateRecordV1 | null;
  readonly validation: PublishingValidationResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

function issue(
  code: PublishingErrorCode,
  field: string,
  message: string,
): PublishingValidationIssue {
  return { code, field, message, retryable: false };
}

function failure(
  disposition: Exclude<
    PublicationCandidateIntakeDisposition,
    "applied" | "identical_replay"
  >,
  record: PublicationCandidateRecordV1 | null,
  validationIssue: PublishingValidationIssue,
): PublicationCandidateIntakeResultV1 {
  return {
    accepted: false,
    changed: false,
    disposition,
    record,
    validation: { valid: false, issues: [validationIssue] },
  };
}

function success(
  disposition: "applied" | "identical_replay",
  record: PublicationCandidateRecordV1,
): PublicationCandidateIntakeResultV1 {
  return {
    accepted: true,
    changed: disposition === "applied",
    disposition,
    record,
    validation: { valid: true, issues: [] },
  };
}

function mapContentValidation(
  result: ReturnType<typeof validatePublicationCandidateV1>,
): PublishingValidationResult {
  if (result.valid) return { valid: true, issues: [] };
  const contentIssue = result.issues[0];
  const code =
    contentIssue?.code === "CONTENT_CANDIDATE_TAMPERED"
      ? "PUBLISHING_CANDIDATE_TAMPERED"
      : contentIssue?.code === "CONTENT_CANDIDATE_REVOKED"
        ? "PUBLISHING_CANDIDATE_REVOKED"
        : "PUBLISHING_CANDIDATE_INVALID";
  return {
    valid: false,
    issues: [
      issue(
        code,
        contentIssue?.field ?? "candidate",
        contentIssue?.message ?? "Publication candidate is invalid.",
      ),
    ],
  };
}

function validateEventEnvelope(
  value: Record<string, unknown>,
  receivedAt: string,
): PublishingValidationResult {
  const extraField = Object.keys(value).find(
    (field) => !EVENT_FIELDS.has(field),
  );
  if (extraField) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CONTRACT_UNSUPPORTED",
          `event.${extraField}`,
          "Candidate event contains a field outside the frozen v1 boundary.",
        ),
      ],
    };
  }
  if (
    !isUuid(value.event_id) ||
    !isUuid(value.correlation_id) ||
    !isIsoDateTime(value.occurred_at) ||
    !isIsoDateTime(receivedAt)
  ) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CANDIDATE_INVALID",
          "event",
          "Candidate event requires UUID identities and valid occurrence/receipt times.",
        ),
      ],
    };
  }
  return { valid: true, issues: [] };
}

function activeStatusForCandidate(
  candidate: PublicationCandidateV1,
): PublicationCandidateStatusV1 {
  return {
    contract_version: "publication-candidate-status-v1",
    candidate_id: candidate.candidate_id,
    business_id: candidate.business_id,
    candidate_checksum: candidate.candidate_checksum,
    state_version: 1,
    candidate_state: "active",
    replacement_candidate_id: null,
    changed_by_user_id: null,
    changed_at: candidate.created_at,
  };
}

export function validatePublicationCandidateRecordV1(
  value: unknown,
): PublishingValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CANDIDATE_INVALID",
          "candidate_record",
          "Authoritative publication candidate record must be an object.",
        ),
      ],
    };
  }
  const extraField = Object.keys(value).find(
    (field) => !CANDIDATE_RECORD_FIELDS.has(field),
  );
  if (extraField) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CONTRACT_UNSUPPORTED",
          `candidate_record.${extraField}`,
          "Authoritative candidate record contains a field outside the frozen v1 boundary.",
        ),
      ],
    };
  }
  if (
    value.contract_version !== "publishing-candidate-record-v1" ||
    !isUuid(value.candidate_id) ||
    !isUuid(value.event_id) ||
    !isUuid(value.business_id) ||
    !isSha256Checksum(value.candidate_checksum) ||
    !isSha256Checksum(value.event_fingerprint) ||
    !Number.isInteger(value.source_state_version) ||
    Number(value.source_state_version) < 1 ||
    !isIsoDateTime(value.received_at)
  ) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CANDIDATE_INVALID",
          "candidate_record",
          "Authoritative publication candidate record metadata is invalid.",
        ),
      ],
    };
  }

  const candidateResult = mapContentValidation(
    validatePublicationCandidateV1(value.payload),
  );
  if (!candidateResult.valid) return candidateResult;
  const statusResult = mapContentValidation(
    validatePublicationCandidateStatusV1(value.source_status),
  );
  if (!statusResult.valid) return statusResult;

  const candidate = value.payload as PublicationCandidateV1;
  const status = value.source_status as PublicationCandidateStatusV1;
  if (
    value.candidate_id !== candidate.candidate_id ||
    value.business_id !== candidate.business_id ||
    value.candidate_checksum !== candidate.candidate_checksum ||
    status.candidate_id !== candidate.candidate_id ||
    status.business_id !== candidate.business_id ||
    status.candidate_checksum !== candidate.candidate_checksum
  ) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CANDIDATE_TAMPERED",
          "candidate_record.candidate_checksum",
          "Authoritative record identities must bind the immutable candidate payload.",
        ),
      ],
    };
  }
  if (
    value.source_state !== status.candidate_state ||
    value.source_state_version !== status.state_version
  ) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_STATE_CONFLICT",
          "candidate_record.source_state_version",
          "Authoritative record state must match its complete stored status snapshot.",
        ),
      ],
    };
  }
  return { valid: true, issues: [] };
}

function reduceCreatedEvent(
  existing: PublicationCandidateRecordV1 | null,
  event: PublicationCandidateCreatedEventV1,
  receivedAt: string,
): PublicationCandidateIntakeResultV1 {
  const candidateResult = mapContentValidation(
    validatePublicationCandidateV1(event.payload),
  );
  if (!candidateResult.valid) {
    return failure("rejected_invalid", existing, candidateResult.issues[0]);
  }

  const eventFingerprint = computePublishingSha256(event);
  const sourceStatus = activeStatusForCandidate(event.payload);
  if (existing === null) {
    return success("applied", {
      contract_version: "publishing-candidate-record-v1",
      candidate_id: event.payload.candidate_id,
      event_id: event.event_id,
      business_id: event.payload.business_id,
      candidate_checksum: event.payload.candidate_checksum,
      event_fingerprint: eventFingerprint,
      source_state: "active",
      source_state_version: 1,
      source_status: sourceStatus,
      received_at: receivedAt,
      payload: event.payload,
    });
  }

  if (
    existing.candidate_id !== event.payload.candidate_id ||
    existing.business_id !== event.payload.business_id
  ) {
    return failure(
      "rejected_conflict",
      existing,
      issue(
        "PUBLISHING_CANDIDATE_TAMPERED",
        "event.payload.candidate_id",
        "Created event identity conflicts with the authoritative candidate record.",
      ),
    );
  }
  if (existing.source_state_version > 1) {
    return failure(
      "rejected_stale",
      existing,
      issue(
        "PUBLISHING_STATE_CONFLICT",
        "event.payload.state_version",
        "Implicit active candidate state v1 is stale against a newer authoritative state.",
      ),
    );
  }
  if (existing.event_fingerprint === eventFingerprint) {
    return success("identical_replay", existing);
  }
  return failure(
    "rejected_conflict",
    existing,
    issue(
      "PUBLISHING_CANDIDATE_TAMPERED",
      "event.event_id",
      "Created event conflicts with the accepted candidate delivery at state version 1.",
    ),
  );
}

function reduceStateChangedEvent(
  existing: PublicationCandidateRecordV1 | null,
  event: PublicationCandidateStateChangedEventV1,
  receivedAt: string,
): PublicationCandidateIntakeResultV1 {
  if (existing === null) {
    return failure(
      "rejected_conflict",
      null,
      issue(
        "PUBLISHING_STATE_CONFLICT",
        "event.payload.candidate_id",
        "Candidate status cannot be applied before the immutable candidate is stored.",
      ),
    );
  }
  const statusResult = mapContentValidation(
    validatePublicationCandidateStatusV1(event.payload),
  );
  if (!statusResult.valid) {
    return failure("rejected_invalid", existing, statusResult.issues[0]);
  }
  if (
    (event.payload as PublicationCandidateStatusV1).candidate_state === "active"
  ) {
    return failure(
      "rejected_invalid",
      existing,
      issue(
        "PUBLISHING_CANDIDATE_INVALID",
        "event.payload.candidate_state",
        "A state-changed event must revoke or replace a candidate.",
      ),
    );
  }
  if (
    event.payload.candidate_id !== existing.candidate_id ||
    event.payload.business_id !== existing.business_id ||
    event.payload.candidate_checksum !== existing.candidate_checksum
  ) {
    return failure(
      "rejected_conflict",
      existing,
      issue(
        "PUBLISHING_CANDIDATE_TAMPERED",
        "event.payload.candidate_checksum",
        "Candidate status does not bind the authoritative immutable candidate.",
      ),
    );
  }

  const incomingVersion = event.payload.state_version;
  if (incomingVersion < existing.source_state_version) {
    return failure(
      "rejected_stale",
      existing,
      issue(
        "PUBLISHING_STATE_CONFLICT",
        "event.payload.state_version",
        "Candidate status event is stale against the authoritative stored version.",
      ),
    );
  }
  const eventFingerprint = computePublishingSha256(event);
  if (incomingVersion === existing.source_state_version) {
    return existing.event_fingerprint === eventFingerprint
      ? success("identical_replay", existing)
      : failure(
          "rejected_conflict",
          existing,
          issue(
            "PUBLISHING_STATE_CONFLICT",
            "event.payload.state_version",
            "Candidate status conflicts with an accepted event at the same state version.",
          ),
        );
  }

  return success("applied", {
    ...existing,
    event_id: event.event_id,
    event_fingerprint: eventFingerprint,
    source_state: event.payload.candidate_state,
    source_state_version: incomingVersion,
    source_status: event.payload,
    received_at: receivedAt,
  });
}

export function reducePublicationCandidateEventV1(
  existing: PublicationCandidateRecordV1 | null,
  eventValue: unknown,
  receivedAt: string,
): PublicationCandidateIntakeResultV1 {
  if (!isRecord(eventValue)) {
    return failure(
      "rejected_invalid",
      existing,
      issue(
        "PUBLISHING_CANDIDATE_INVALID",
        "event",
        "Candidate intake event must be an object.",
      ),
    );
  }
  const envelopeResult = validateEventEnvelope(eventValue, receivedAt);
  if (!envelopeResult.valid) {
    return failure("rejected_invalid", existing, envelopeResult.issues[0]);
  }
  if (existing !== null) {
    const recordResult = validatePublicationCandidateRecordV1(existing);
    if (!recordResult.valid) {
      return failure("rejected_invalid", existing, recordResult.issues[0]);
    }
  }

  if (eventValue.event_type === "content.publication_candidate.created.v1") {
    return reduceCreatedEvent(
      existing,
      eventValue as PublicationCandidateCreatedEventV1,
      receivedAt,
    );
  }
  if (
    eventValue.event_type === "content.publication_candidate.state_changed.v1"
  ) {
    return reduceStateChangedEvent(
      existing,
      eventValue as PublicationCandidateStateChangedEventV1,
      receivedAt,
    );
  }
  return failure(
    "rejected_invalid",
    existing,
    issue(
      "PUBLISHING_CONTRACT_UNSUPPORTED",
      "event.event_type",
      "Candidate intake event type is unsupported.",
    ),
  );
}

export function validateAuthoritativePublicationCandidateV1(input: {
  readonly record: unknown;
  readonly candidate: unknown;
  readonly status: unknown;
}): PublishingValidationResult {
  const recordResult = validatePublicationCandidateRecordV1(input.record);
  if (!recordResult.valid) return recordResult;
  const handoffResult = mapContentValidation(
    validatePublicationCandidateHandoff(input.candidate, input.status),
  );
  if (!handoffResult.valid) return handoffResult;

  const record = input.record as PublicationCandidateRecordV1;
  const candidate = input.candidate as PublicationCandidateV1;
  const status = input.status as PublicationCandidateStatusV1;
  if (
    record.candidate_id !== candidate.candidate_id ||
    record.business_id !== candidate.business_id ||
    record.candidate_checksum !== candidate.candidate_checksum ||
    computePublishingSha256(record.payload) !==
      computePublishingSha256(candidate)
  ) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CANDIDATE_TAMPERED",
          "candidate_record.payload",
          "Dispatch candidate does not match the authoritative immutable payload.",
        ),
      ],
    };
  }
  if (record.source_state !== "active") {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_CANDIDATE_REVOKED",
          "candidate_record.source_state",
          "The authoritative candidate state is no longer active for execution.",
        ),
      ],
    };
  }
  if (
    record.source_state_version !== status.state_version ||
    computePublishingSha256(record.source_status) !==
      computePublishingSha256(status)
  ) {
    return {
      valid: false,
      issues: [
        issue(
          "PUBLISHING_STATE_CONFLICT",
          "candidate_status.state_version",
          "Dispatch status is not the latest authoritative candidate status.",
        ),
      ],
    };
  }
  return { valid: true, issues: [] };
}

import { ProviderError } from "../../../common/errors/provider-error";
import {
  AiDiscoveryResult,
  BusinessProfileDraft,
  ProfileUncertainty,
  ResearchObservation,
  SourceRef,
} from "../discovery-state";

export function parseAiDiscoveryResult(value: unknown): AiDiscoveryResult {
  if (typeof value !== "object" || value === null) {
    throw invalidOutput();
  }

  const candidate = value as {
    readonly action?: unknown;
    readonly next_question?: unknown;
    readonly updated_known_facts?: unknown;
    readonly updated_uncertainties?: unknown;
    readonly research_observations?: unknown;
    readonly source_refs?: unknown;
    readonly domain_scores?: unknown;
    readonly profile_draft?: unknown;
    readonly safe_error?: unknown;
  };

  if (!isAction(candidate.action)) {
    throw invalidOutput();
  }

  return {
    action: candidate.action,
    next_question:
      typeof candidate.next_question === "string"
        ? candidate.next_question
        : undefined,
    updated_known_facts: objectRecord(candidate.updated_known_facts),
    updated_uncertainties: uncertainties(candidate.updated_uncertainties),
    research_observations: researchObservations(
      candidate.research_observations,
    ),
    source_refs: sourceRefs(candidate.source_refs),
    domain_scores: numberRecord(candidate.domain_scores),
    profile_draft: profileDraft(candidate.profile_draft),
    safe_error: safeError(candidate.safe_error),
  };
}

function isAction(value: unknown): value is AiDiscoveryResult["action"] {
  return (
    value === "ask_next_question" ||
    value === "ask_clarification" ||
    value === "produce_profile_draft" ||
    value === "safe_failure"
  );
}

function invalidOutput(): ProviderError {
  return new ProviderError(
    "AI_DISCOVERY_INVALID_OUTPUT",
    "AI discovery returned invalid output.",
    true,
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function numberRecord(value: unknown): Record<string, number> {
  const record = objectRecord(value);

  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number";
    }),
  );
}

function uncertainties(value: unknown): readonly ProfileUncertainty[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isProfileUncertainty);
}

function profileDraft(value: unknown): BusinessProfileDraft | undefined {
  if (!isProfileDraft(value)) {
    return undefined;
  }

  return value;
}

function sourceRefs(value: unknown): readonly SourceRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isSourceRef);
}

function researchObservations(value: unknown): readonly ResearchObservation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isResearchObservation);
}

function safeError(value: unknown): AiDiscoveryResult["safe_error"] {
  const record = objectRecord(value);
  if (
    typeof record["code"] !== "string" ||
    typeof record["message"] !== "string" ||
    typeof record["retryable"] !== "boolean"
  ) {
    return undefined;
  }

  return {
    code: record["code"],
    message: record["message"],
    retryable: record["retryable"],
  };
}

function isProfileUncertainty(value: unknown): value is ProfileUncertainty {
  const record = objectRecord(value);

  return (
    typeof record["field_key"] === "string" &&
    typeof record["description"] === "string" &&
    isSeverity(record["severity"])
  );
}

function isSourceRef(value: unknown): value is SourceRef {
  const record = objectRecord(value);

  return (
    typeof record["id"] === "string" &&
    isSourceType(record["source_type"]) &&
    optionalString(record["platform"]) &&
    optionalString(record["url"]) &&
    optionalString(record["title"]) &&
    optionalString(record["snippet"]) &&
    optionalString(record["fetched_at"]) &&
    typeof record["confidence"] === "number" &&
    typeof record["metadata"] === "object" &&
    record["metadata"] !== null &&
    !Array.isArray(record["metadata"])
  );
}

function isResearchObservation(value: unknown): value is ResearchObservation {
  const record = objectRecord(value);

  return (
    typeof record["id"] === "string" &&
    optionalString(record["source_ref_id"]) &&
    isObservationKind(record["kind"]) &&
    typeof record["statement"] === "string" &&
    typeof record["confidence"] === "number" &&
    isObservationVisibility(record["visibility"]) &&
    isObservationStatus(record["status"]) &&
    optionalString(record["discard_reason"]) &&
    typeof record["metadata"] === "object" &&
    record["metadata"] !== null &&
    !Array.isArray(record["metadata"])
  );
}

function isProfileDraft(value: unknown): value is BusinessProfileDraft {
  const record = objectRecord(value);

  return (
    typeof record["id"] === "string" &&
    typeof record["session_id"] === "string" &&
    typeof record["version"] === "number" &&
    typeof record["confirmed_facts"] === "object" &&
    Array.isArray(record["research_observations"]) &&
    Array.isArray(record["uncertainties"]) &&
    Array.isArray(record["owner_goals"]) &&
    Array.isArray(record["strategy_relevant_notes"]) &&
    typeof record["raw_ai_output"] === "object"
  );
}

function isSeverity(value: unknown): value is ProfileUncertainty["severity"] {
  return value === "low" || value === "medium" || value === "high";
}

function isSourceType(value: unknown): value is SourceRef["source_type"] {
  return (
    value === "owner_link" ||
    value === "metadata" ||
    value === "search_result" ||
    value === "manual_owner_answer"
  );
}

function isObservationKind(
  value: unknown,
): value is ResearchObservation["kind"] {
  return (
    value === "digital_presence" ||
    value === "competitor" ||
    value === "market_context" ||
    value === "social_signal" ||
    value === "metadata"
  );
}

function isObservationVisibility(
  value: unknown,
): value is ResearchObservation["visibility"] {
  return value === "owner_visible" || value === "internal";
}

function isObservationStatus(
  value: unknown,
): value is ResearchObservation["status"] {
  return value === "accepted" || value === "discarded";
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

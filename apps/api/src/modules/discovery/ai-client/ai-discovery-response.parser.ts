import { ProviderError } from "../../../common/errors/provider-error";
import {
  AiDiscoveryResult,
  BusinessProfileDraft,
  DiscoveryDomainScores,
  MarketAwareBusinessFacts,
  MarketContextSnapshot,
  MarketEvidence,
  ProfileUncertainty,
  ResearchObservation,
  SourceRef,
} from "../discovery-state";

export function parseAiDiscoveryResult(value: unknown): AiDiscoveryResult {
  if (!isRecord(value)) {
    throw invalidOutput();
  }

  if (
    !isAction(value["action"]) ||
    !isMarketAwareBusinessFacts(value["updated_known_facts"]) ||
    !isRecord(value["domain_scores"])
  ) {
    throw invalidOutput();
  }

  const result: AiDiscoveryResult = {
    action: value["action"],
    next_question:
      typeof value["next_question"] === "string"
        ? value["next_question"]
        : undefined,
    updated_known_facts: value["updated_known_facts"],
    updated_uncertainties: uncertainties(value["updated_uncertainties"]),
    research_observations: researchObservations(value["research_observations"]),
    source_refs: sourceRefs(value["source_refs"]),
    domain_scores: numberRecord(value["domain_scores"]),
    profile_draft: profileDraft(value["profile_draft"]),
    safe_error: safeError(value["safe_error"]),
  };

  assertActionInvariants(result);
  return result;
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

function numberRecord(value: unknown): DiscoveryDomainScores {
  if (!isDiscoveryDomainScores(value)) {
    throw invalidOutput();
  }

  return value;
}

function uncertainties(value: unknown): ProfileUncertainty[] {
  if (!Array.isArray(value) || !value.every(isProfileUncertainty)) {
    throw invalidOutput();
  }

  return value;
}

function profileDraft(value: unknown): BusinessProfileDraft | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isProfileDraft(value)) {
    throw invalidOutput();
  }

  return value;
}

function sourceRefs(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || !value.every(isSourceRef)) {
    throw invalidOutput();
  }

  return value;
}

function researchObservations(value: unknown): ResearchObservation[] {
  if (!Array.isArray(value) || !value.every(isResearchObservation)) {
    throw invalidOutput();
  }

  return value;
}

function safeError(value: unknown): AiDiscoveryResult["safe_error"] {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value["code"] !== "string" ||
    typeof value["message"] !== "string" ||
    typeof value["retryable"] !== "boolean"
  ) {
    throw invalidOutput();
  }

  return {
    code: value["code"],
    message: value["message"],
    retryable: value["retryable"],
  };
}

function isProfileUncertainty(value: unknown): value is ProfileUncertainty {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["field_key"] === "string" &&
    typeof value["description"] === "string" &&
    isSeverity(value["severity"]) &&
    isUncertaintyCategory(value["category"]) &&
    isUncertaintySource(value["source"]) &&
    optionalString(value["source_ref_id"]) &&
    optionalString(value["owner_stated_value"]) &&
    optionalString(value["research_suggested_value"]) &&
    optionalString(value["contradiction_detail"])
  );
}

function isSourceRef(value: unknown): value is SourceRef {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["id"] === "string" &&
    isSourceType(value["source_type"]) &&
    optionalString(value["platform"]) &&
    optionalString(value["url"]) &&
    optionalString(value["title"]) &&
    optionalString(value["snippet"]) &&
    optionalString(value["fetched_at"]) &&
    isConfidence(value["confidence"]) &&
    isRecord(value["metadata"])
  );
}

function isResearchObservation(value: unknown): value is ResearchObservation {
  if (!isRecord(value)) {
    return false;
  }

  const baseIsValid =
    typeof value["id"] === "string" &&
    optionalString(value["source_ref_id"]) &&
    isObservationKind(value["kind"]) &&
    typeof value["statement"] === "string" &&
    isConfidence(value["confidence"]) &&
    isObservationVisibility(value["visibility"]) &&
    isObservationStatus(value["status"]) &&
    optionalString(value["discard_reason"]) &&
    isRecord(value["metadata"]);
  if (!baseIsValid) {
    return false;
  }

  const hasSource =
    typeof value["source_ref_id"] === "string" ||
    typeof value["metadata"]["source_label"] === "string";

  return (
    (value["status"] !== "discarded" ||
      nonEmptyString(value["discard_reason"])) &&
    (value["visibility"] !== "owner_visible" || hasSource)
  );
}

function isProfileDraft(value: unknown): value is BusinessProfileDraft {
  if (!isRecord(value)) {
    return false;
  }

  const baseIsValid =
    typeof value["id"] === "string" &&
    typeof value["session_id"] === "string" &&
    Number.isInteger(value["version"]) &&
    (value["version"] as number) > 0 &&
    isDraftStatus(value["status"]) &&
    isMarketAwareBusinessFacts(value["confirmed_facts"]) &&
    isMarketContext(value["market_context"]) &&
    Array.isArray(value["research_observations"]) &&
    value["research_observations"].every(isResearchObservation) &&
    Array.isArray(value["uncertainties"]) &&
    value["uncertainties"].every(isResolvedUncertainty) &&
    isStringArray(value["owner_goals"]) &&
    isStringArray(value["strategy_relevant_notes"]) &&
    isRecord(value["raw_ai_output"]);
  if (!baseIsValid) {
    return false;
  }

  const observations = value["research_observations"] as ResearchObservation[];
  const marketContext = value["market_context"] as MarketContextSnapshot;
  const observationsById = new Map(
    observations.map((observation) => [observation.id, observation]),
  );
  return marketEvidenceItems(marketContext).every((evidence) => {
    const observation = observationsById.get(evidence.observation_id);
    return (
      observation?.status === "accepted" &&
      observation.source_ref_id === evidence.source_ref_id &&
      observation.statement === evidence.statement &&
      observation.confidence === evidence.confidence
    );
  });
}

function isSeverity(value: unknown): value is ProfileUncertainty["severity"] {
  return value === "low" || value === "medium" || value === "high";
}

function isUncertaintyCategory(
  value: unknown,
): value is ProfileUncertainty["category"] {
  return (
    value === "missing_information" ||
    value === "contradiction" ||
    value === "low_confidence" ||
    value === "owner_unknown" ||
    value === "research_gap" ||
    value === "ambiguous_answer"
  );
}

function isUncertaintySource(
  value: unknown,
): value is ProfileUncertainty["source"] {
  return (
    value === "owner_answer" ||
    value === "owner_unknown" ||
    value === "research_observation" ||
    value === "metadata_extraction" ||
    value === "search_result" ||
    value === "intake_form" ||
    value === "ai_inference"
  );
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

function isResolvedUncertainty(
  value: unknown,
): value is BusinessProfileDraft["uncertainties"][number] {
  return (
    isProfileUncertainty(value) &&
    isRecord(value) &&
    typeof value["resolved"] === "boolean" &&
    optionalString(value["resolved_at"]) &&
    (value["resolved_by_action"] === undefined ||
      value["resolved_by_action"] === "owner_clarified" ||
      value["resolved_by_action"] === "research_confirmed" ||
      value["resolved_by_action"] === "discarded" ||
      value["resolved_by_action"] === "skipped")
  );
}

function isDraftStatus(
  value: unknown,
): value is BusinessProfileDraft["status"] {
  return (
    value === "draft" ||
    value === "ready_for_confirmation" ||
    value === "confirmed" ||
    value === "superseded"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isDiscoveryDomainScores(
  value: unknown,
): value is DiscoveryDomainScores {
  if (!isRecord(value)) {
    return false;
  }

  return [
    "identity",
    "offer",
    "customers",
    "differentiation",
    "current_marketing",
    "goals_and_constraints",
    "market_context",
    "research_confidence",
    "profile_readiness",
  ].every((field) => isConfidence(value[field]));
}

function isMarketAwareBusinessFacts(
  value: unknown,
): value is MarketAwareBusinessFacts {
  if (!isRecord(value)) {
    return false;
  }

  const identity = value["identity"];
  const offer = value["offer"];
  const customers = value["customers"];
  const differentiation = value["differentiation"];
  const currentMarketing = value["current_marketing"];
  const goalsAndConstraints = value["goals_and_constraints"];

  return (
    isRecord(identity) &&
    optionalString(identity["business_name"]) &&
    optionalString(identity["business_type"]) &&
    optionalString(identity["city"]) &&
    optionalString(identity["area"]) &&
    isRecord(offer) &&
    isStringArray(offer["core_offerings"]) &&
    isStringArray(offer["best_sellers"]) &&
    optionalString(offer["price_range"]) &&
    isStringArray(offer["purchase_occasions"]) &&
    isRecord(customers) &&
    isStringArray(customers["primary_segments"]) &&
    isStringArray(customers["visit_or_order_occasions"]) &&
    isStringArray(customers["peak_periods"]) &&
    isStringArray(customers["customer_needs"]) &&
    isRecord(differentiation) &&
    isStringArray(differentiation["owner_claimed_strengths"]) &&
    isStringArray(differentiation["customer_choice_reasons"]) &&
    isStringArray(differentiation["proof_points"]) &&
    isRecord(currentMarketing) &&
    isStringArray(currentMarketing["active_channels"]) &&
    isStringArray(currentMarketing["current_activities"]) &&
    isStringArray(currentMarketing["delivery_platforms"]) &&
    isStringArray(currentMarketing["available_assets"]) &&
    isRecord(goalsAndConstraints) &&
    isStringArray(goalsAndConstraints["growth_goals"]) &&
    optionalString(goalsAndConstraints["timeframe"]) &&
    optionalString(goalsAndConstraints["marketing_budget_range"]) &&
    optionalString(goalsAndConstraints["team_capacity"]) &&
    isStringArray(goalsAndConstraints["operational_constraints"])
  );
}

function isMarketContext(value: unknown): value is MarketContextSnapshot {
  return (
    isRecord(value) &&
    isMarketEvidenceArray(value["competitor_landscape"]) &&
    isMarketEvidenceArray(value["local_demand_signals"]) &&
    isMarketEvidenceArray(value["digital_presence_signals"]) &&
    isMarketEvidenceArray(value["other_signals"])
  );
}

function isMarketEvidenceArray(value: unknown): value is MarketEvidence[] {
  return Array.isArray(value) && value.every(isMarketEvidence);
}

function isMarketEvidence(value: unknown): value is MarketEvidence {
  return (
    isRecord(value) &&
    typeof value["observation_id"] === "string" &&
    optionalString(value["source_ref_id"]) &&
    typeof value["statement"] === "string" &&
    isConfidence(value["confidence"])
  );
}

function marketEvidenceItems(context: MarketContextSnapshot): MarketEvidence[] {
  return [
    ...context.competitor_landscape,
    ...context.local_demand_signals,
    ...context.digital_presence_signals,
    ...context.other_signals,
  ];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertActionInvariants(result: AiDiscoveryResult): void {
  const asksQuestion =
    result.action === "ask_next_question" ||
    result.action === "ask_clarification";
  if (asksQuestion && !nonEmptyString(result.next_question)) {
    throw invalidOutput();
  }
  if (asksQuestion && result.profile_draft) {
    throw invalidOutput();
  }
  if (result.action === "produce_profile_draft" && !result.profile_draft) {
    throw invalidOutput();
  }
  if (
    result.action === "produce_profile_draft" &&
    result.next_question !== undefined
  ) {
    throw invalidOutput();
  }
  if (result.action === "safe_failure" && !result.safe_error) {
    throw invalidOutput();
  }
  if (
    result.action === "safe_failure" &&
    (result.next_question !== undefined || result.profile_draft !== undefined)
  ) {
    throw invalidOutput();
  }
  if (result.action !== "safe_failure" && result.safe_error) {
    throw invalidOutput();
  }
}

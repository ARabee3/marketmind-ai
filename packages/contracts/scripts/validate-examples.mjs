import { readFile } from "node:fs/promises";

const examplesUrl = new URL("../examples/", import.meta.url);

const discoveryStatuses = new Set([
  "not_started",
  "researching",
  "partial_ready",
  "ready_for_chat",
  "in_progress",
  "summary_ready",
  "confirmed",
  "research_failed",
  "failed",
  "cancelled",
]);

const progressStages = new Set([
  "queued",
  "query_planning",
  "metadata",
  "competitor_searching",
  "search",
  "filtering",
  "persisting",
  "ai_start",
  "ready",
  "failed",
]);
const progressStatuses = new Set(["started", "progress", "complete", "failed"]);
const aiActions = new Set([
  "ask_next_question",
  "ask_clarification",
  "produce_profile_draft",
  "safe_failure",
]);
const uncertaintyCategories = new Set([
  "missing_information",
  "contradiction",
  "low_confidence",
  "owner_unknown",
  "research_gap",
  "ambiguous_answer",
]);
const uncertaintySources = new Set([
  "owner_answer",
  "owner_unknown",
  "research_observation",
  "metadata_extraction",
  "search_result",
  "intake_form",
  "ai_inference",
]);
const profileDomains = new Set([
  "identity",
  "offer",
  "customers",
  "differentiation",
  "current_marketing",
  "goals_and_constraints",
  "market_context",
]);
const completionReasons = new Set([
  "sufficient",
  "owner_finished_early",
  "turn_limit",
]);
const agentRunTypes = new Set([
  "discovery_start",
  "discovery_turn",
  "discovery_summary",
]);
const agentRunStatuses = new Set(["success", "schema_retry_success", "failed"]);
const providerModes = new Set(["openai", "gemini_dev", "mock"]);
const errorCodes = new Set([
  "DISCOVERY_SESSION_NOT_FOUND",
  "DISCOVERY_SESSION_STATE_CONFLICT",
  "DISCOVERY_RESEARCH_CAP_EXCEEDED",
  "DISCOVERY_AI_SERVICE_UNAVAILABLE",
  "DISCOVERY_AI_BAD_RESPONSE",
  "DISCOVERY_PROFILE_ALREADY_CONFIRMED",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "STRATEGY_PROFILE_STALE",
  "STRATEGY_PROFILE_UNCONFIRMED",
  "STRATEGY_KNOWLEDGE_GAP",
  "STRATEGY_RETRIEVAL_FAILURE",
  "STRATEGY_PROVIDER_FAILURE",
  "STRATEGY_SCHEMA_FAILURE",
  "STRATEGY_INVALID_CITATION",
  "STRATEGY_INVALID_BENCHMARK",
  "STRATEGY_ARITHMETIC_FAILURE",
  "STRATEGY_RULE_VIOLATION",
  "STRATEGY_BRIEF_INCOMPLETE",
  "STRATEGY_NOT_FOUND",
  "STRATEGY_STATE_CONFLICT",
]);

const strategyObjectives = new Set([
  "awareness", "acquisition", "conversion", "retention", "launch",
]);
const strategyBudgetModes = new Set([
  "organic_only", "monthly_amount", "three_month_amount", "scenario_only",
]);
const strategyStatuses = new Set([
  "needs_brief", "ready", "retrieving", "queued", "generating",
  "validating", "draft", "approved", "rejected", "failed",
]);
const evidenceTiers = new Set([
  "verified_benchmark", "reviewed_guidance", "contextual_note", "model_synthesis",
]);
const claimSources = new Set([
  "confirmed_fact", "owner_input", "retrieved_evidence", "deterministic_result", "model_synthesis",
]);
const channelRoles = new Set(["primary", "supporting"]);
const kpiTargetModes = new Set([
  "establish_baseline", "owner_target", "baseline_improvement", "verified_benchmark_range",
]);
const blockerSeverities = new Set(["blocking", "warning"]);
const gapSeverities = new Set(["blocking", "non_critical"]);
const strategyProgressStages = new Set([
  "queued", "query_planning", "retrieval", "generating", "validating", "ready", "failed",
]);
const strategyProgressStatuses = new Set(["started", "progress", "complete", "failed"]);
const languageModes = new Set(["ar-EG", "en", "mixed"]);
const reviewStatuses = new Set(["approved", "retired", "expired"]);
const scenarioTypes = new Set(["conservative", "base", "growth"]);
const decisionTypes = new Set(["approved", "rejected", "revision_requested"]);

async function loadJson(name) {
  const raw = await readFile(new URL(name, examplesUrl), "utf8");
  return JSON.parse(raw);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertString(value, label) {
  assert(
    typeof value === "string" && value.length > 0,
    `${label} must be a non-empty string`,
  );
}

function assertNullableString(value, label) {
  assert(
    value === null || typeof value === "string",
    `${label} must be a string or null`,
  );
}

function assertOptionalString(value, label) {
  assert(
    value === undefined || (typeof value === "string" && value.length > 0),
    `${label} must be a non-empty string when provided`,
  );
}

function assertStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  value.forEach((item, index) => assertString(item, `${label}[${index}]`));
}

function assertStatus(value, label) {
  assert(
    discoveryStatuses.has(value),
    `${label} has unsupported status: ${value}`,
  );
}

function assertUncertainty(uncertainty, label, persisted = true) {
  assert(
    profileDomains.has(uncertainty.domain),
    `${label}.domain is invalid`,
  );
  assertString(uncertainty.field_key, `${label}.field_key`);
  assertString(uncertainty.description, `${label}.description`);
  assert(
    ["low", "medium", "high"].includes(uncertainty.severity),
    `${label}.severity is invalid`,
  );
  assert(
    uncertaintyCategories.has(uncertainty.category),
    `${label}.category is invalid`,
  );
  assert(
    uncertaintySources.has(uncertainty.source),
    `${label}.source is invalid`,
  );
  if (persisted) {
    assert(
      typeof uncertainty.resolved === "boolean",
      `${label}.resolved must be boolean`,
    );
  }
}

function assertResearchObservation(observation, label) {
  assertString(observation.id, `${label}.id`);
  assertString(observation.statement, `${label}.statement`);
  assert(
    observation.status === "accepted" || observation.status === "discarded",
    `${label}.status is invalid`,
  );
  if (observation.status === "discarded") {
    assertString(observation.discard_reason, `${label}.discard_reason`);
  }
  if (observation.visibility === "owner_visible") {
    assert(
      observation.source_ref_id || observation.metadata?.source_label,
      `${label} needs a source ref or label`,
    );
  }
}

function assertProgressEvent(event, index, expectedSessionId) {
  assert(event.type === "progress", `progress[${index}] type must be progress`);
  assert(
    event.session_id === expectedSessionId,
    `progress[${index}] session id mismatch`,
  );
  assert(
    event.seq === index + 1,
    `progress[${index}] seq must be ${index + 1}`,
  );
  assert(
    progressStages.has(event.stage),
    `progress[${index}] has invalid stage ${event.stage}`,
  );
  assert(
    progressStatuses.has(event.status),
    `progress[${index}] has invalid status ${event.status}`,
  );
  assertString(event.message_key, `progress[${index}].message_key`);
  assertString(event.message_text, `progress[${index}].message_text`);
}

function assertProfileDraft(draft, label) {
  assertString(draft.id, `${label}.id`);
  assertString(draft.session_id, `${label}.session_id`);
  assert(
    Number.isInteger(draft.version),
    `${label}.version must be an integer`,
  );
  assert(
    draft.completeness === "complete" ||
      draft.completeness === "incomplete",
    `${label}.completeness is invalid`,
  );
  assert(
    completionReasons.has(draft.completion_reason),
    `${label}.completion_reason is invalid`,
  );
  assertReadiness(draft.readiness, `${label}.readiness`);
  assert(
    ["draft", "ready_for_confirmation", "confirmed", "superseded"].includes(
      draft.status,
    ),
    `${label}.status is invalid`,
  );
  assertMarketAwareFacts(draft.confirmed_facts, `${label}.confirmed_facts`);
  assert(
    Array.isArray(draft.research_observations),
    `${label}.research_observations must be an array`,
  );
  assert(
    Array.isArray(draft.uncertainties),
    `${label}.uncertainties must be an array`,
  );
  assert(
    Array.isArray(draft.owner_goals),
    `${label}.owner_goals must be an array`,
  );
  assert(
    Array.isArray(draft.strategy_relevant_notes),
    `${label}.strategy_relevant_notes must be an array`,
  );
  draft.research_observations.forEach((observation, index) =>
    assertResearchObservation(
      observation,
      `${label}.research_observations[${index}]`,
    ),
  );
  draft.uncertainties.forEach((uncertainty, index) =>
    assertUncertainty(uncertainty, `${label}.uncertainties[${index}]`),
  );
  assertMarketContext(
    draft.market_context,
    draft.research_observations,
    `${label}.market_context`,
  );
}

function assertMarketAwareFacts(facts, label) {
  assert(
    typeof facts === "object" && facts !== null && !Array.isArray(facts),
    `${label} must be an object`,
  );
  const identity = facts.identity;
  assert(
    typeof identity === "object" && identity !== null,
    `${label}.identity must be an object`,
  );
  ["business_name", "business_type", "city", "area"].forEach((field) =>
    assertOptionalString(identity[field], `${label}.identity.${field}`),
  );

  const arrayFields = {
    offer: ["core_offerings", "best_sellers", "purchase_occasions"],
    customers: [
      "primary_segments",
      "visit_or_order_occasions",
      "peak_periods",
      "customer_needs",
    ],
    differentiation: [
      "owner_claimed_strengths",
      "customer_choice_reasons",
      "proof_points",
    ],
    current_marketing: [
      "active_channels",
      "current_activities",
      "delivery_platforms",
      "available_assets",
    ],
    goals_and_constraints: ["growth_goals", "operational_constraints"],
  };
  for (const [section, fields] of Object.entries(arrayFields)) {
    assert(
      typeof facts[section] === "object" && facts[section] !== null,
      `${label}.${section} must be an object`,
    );
    fields.forEach((field) =>
      assertStringArray(facts[section][field], `${label}.${section}.${field}`),
    );
  }
  assertOptionalString(facts.offer.price_range, `${label}.offer.price_range`);
  ["timeframe", "marketing_budget_range", "team_capacity"].forEach((field) =>
    assertOptionalString(
      facts.goals_and_constraints[field],
      `${label}.goals_and_constraints.${field}`,
    ),
  );
}

function assertMarketContext(context, observations, label) {
  assert(
    typeof context === "object" && context !== null && !Array.isArray(context),
    `${label} must be an object`,
  );
  const observationsById = new Map(observations.map((item) => [item.id, item]));
  [
    "competitor_landscape",
    "local_demand_signals",
    "digital_presence_signals",
    "other_signals",
  ].forEach((section) => {
    assert(
      Array.isArray(context[section]),
      `${label}.${section} must be an array`,
    );
    context[section].forEach((evidence, index) => {
      const evidenceLabel = `${label}.${section}[${index}]`;
      assertString(evidence.observation_id, `${evidenceLabel}.observation_id`);
      const observation = observationsById.get(evidence.observation_id);
      assert(
        observation,
        `${evidenceLabel} must reference a profile observation`,
      );
      assert(
        observation.status === "accepted" &&
          observation.source_ref_id === evidence.source_ref_id &&
          observation.statement === evidence.statement &&
          observation.confidence === evidence.confidence,
        `${evidenceLabel} must exactly mirror accepted cited evidence`,
      );
      assertOptionalString(
        evidence.source_ref_id,
        `${evidenceLabel}.source_ref_id`,
      );
      assertString(evidence.statement, `${evidenceLabel}.statement`);
      assert(
        typeof evidence.confidence === "number" &&
          evidence.confidence >= 0 &&
          evidence.confidence <= 1,
        `${evidenceLabel}.confidence is invalid`,
      );
    });
  });
}

function assertDomainScores(scores, label) {
  const requiredDomains = [
    "identity",
    "offer",
    "customers",
    "differentiation",
    "current_marketing",
    "goals_and_constraints",
    "market_context",
    "research_confidence",
    "profile_readiness",
  ];
  requiredDomains.forEach((domain) => {
    assert(
      typeof scores?.[domain] === "number" &&
        scores[domain] >= 0 &&
        scores[domain] <= 1,
      `${label}.${domain} must be between 0 and 1`,
    );
  });
}

function assertReadiness(readiness, label) {
  assert(
    typeof readiness?.ready === "boolean",
    `${label}.ready must be boolean`,
  );
  assert(
    typeof readiness?.llm_recommended === "boolean",
    `${label}.llm_recommended must be boolean`,
  );
  assert(
    typeof readiness?.profile_readiness === "number" &&
      readiness.profile_readiness >= 0 &&
      readiness.profile_readiness <= 1,
    `${label}.profile_readiness must be between 0 and 1`,
  );
  assertDomainScores(readiness.domain_scores, `${label}.domain_scores`);
  assert(
    Array.isArray(readiness.blocking_domains) &&
      readiness.blocking_domains.every((domain) => profileDomains.has(domain)),
    `${label}.blocking_domains is invalid`,
  );
  assert(
    Number.isInteger(readiness.owner_turn_count) &&
      readiness.owner_turn_count >= 0,
    `${label}.owner_turn_count is invalid`,
  );
  assert(
    Number.isInteger(readiness.max_owner_turns) &&
      readiness.max_owner_turns > 0,
    `${label}.max_owner_turns is invalid`,
  );
  if (readiness.completion_reason !== undefined) {
    assert(
      completionReasons.has(readiness.completion_reason),
      `${label}.completion_reason is invalid`,
    );
  }
}

function assertProfileState(state, label) {
  assertMarketAwareFacts(state.known_facts, `${label}.known_facts`);
  assert(
    Array.isArray(state.uncertainties),
    `${label}.uncertainties must be an array`,
  );
  state.uncertainties.forEach((uncertainty, index) =>
    assertUncertainty(
      uncertainty,
      `${label}.uncertainties[${index}]`,
      false,
    ),
  );
  assertReadiness(state.readiness, `${label}.readiness`);
}

function assertIntelligence(intelligence, label) {
  assert(
    ["running", "partial", "complete", "failed"].includes(intelligence.status),
    `${label}.status is invalid`,
  );
  assert(
    ["metadata_only", "free_search", "provider_later"].includes(
      intelligence.search_mode,
    ),
    `${label}.search_mode is invalid`,
  );
  assert(
    Array.isArray(intelligence.source_refs),
    `${label}.source_refs must be an array`,
  );
  assert(
    Array.isArray(intelligence.research_observations),
    `${label}.research_observations must be an array`,
  );
  assert(
    Array.isArray(intelligence.conversation_hooks),
    `${label}.conversation_hooks must be an array`,
  );
  assert(
    Array.isArray(intelligence.knowledge_gaps),
    `${label}.knowledge_gaps must be an array`,
  );

  intelligence.research_observations.forEach((observation, index) =>
    assertResearchObservation(
      observation,
      `${label}.research_observations[${index}]`,
    ),
  );
}

function assertAgentRun(run, label) {
  assertString(run.id, `${label}.id`);
  assertNullableString(run.session_id, `${label}.session_id`);
  assert(agentRunTypes.has(run.run_type), `${label}.run_type is invalid`);
  assert(
    providerModes.has(run.provider_mode),
    `${label}.provider_mode is invalid`,
  );
  assertNullableString(run.model_name, `${label}.model_name`);
  assertString(run.prompt_version, `${label}.prompt_version`);
  assert(agentRunStatuses.has(run.status), `${label}.status is invalid`);
  assertNullableString(run.input_hash, `${label}.input_hash`);
  assert(
    run.input_tokens === null || Number.isInteger(run.input_tokens),
    `${label}.input_tokens is invalid`,
  );
  assert(
    run.output_tokens === null || Number.isInteger(run.output_tokens),
    `${label}.output_tokens is invalid`,
  );
  assert(
    run.latency_ms === null || Number.isInteger(run.latency_ms),
    `${label}.latency_ms is invalid`,
  );
  assert(
    typeof run.output_json === "object" && !Array.isArray(run.output_json),
    `${label}.output_json must be an object`,
  );
  if (run.output_json.updated_known_facts) {
    assertMarketAwareFacts(
      run.output_json.updated_known_facts,
      `${label}.output_json.updated_known_facts`,
    );
  }
  if (run.output_json.domain_scores) {
    assertDomainScores(
      run.output_json.domain_scores,
      `${label}.output_json.domain_scores`,
    );
  }
  assertNullableString(run.error_code, `${label}.error_code`);
  assertNullableString(run.error_message, `${label}.error_message`);
  assert(
    !("retry_count" in run),
    `${label}.retry_count is not part of the persistence contract`,
  );
  assertString(run.created_at, `${label}.created_at`);
}

function assertDiscoverySession(session, label) {
  assertString(session.id, `${label}.id`);
  assertNullableString(session.business_id, `${label}.business_id`);
  assertString(session.owner_user_id, `${label}.owner_user_id`);
  assertStatus(session.status, `${label}.status`);
  assert(
    ["ar-EG", "en", "mixed"].includes(session.language_mode),
    `${label}.language_mode is invalid`,
  );
  assertNullableString(session.current_question, `${label}.current_question`);
  assertProfileState(session.profile_state, `${label}.profile_state`);
  assert(
    Number.isInteger(session.owner_turn_count) &&
      session.owner_turn_count >= 0,
    `${label}.owner_turn_count is invalid`,
  );
  assertNullableString(
    session.completion_reason,
    `${label}.completion_reason`,
  );
  assertNullableString(session.profile_draft_id, `${label}.profile_draft_id`);
  assertNullableString(
    session.confirmed_profile_version_id,
    `${label}.confirmed_profile_version_id`,
  );
  assertString(session.started_at, `${label}.started_at`);
  assertNullableString(session.completed_at, `${label}.completed_at`);
  assertString(session.created_at, `${label}.created_at`);
  assertString(session.updated_at, `${label}.updated_at`);
}

function assertBusinessProfile(profile, label) {
  assertString(profile.id, `${label}.id`);
  assertString(profile.business_id, `${label}.business_id`);
  assertNullableString(profile.draft_id, `${label}.draft_id`);
  assert(
    Number.isInteger(profile.version),
    `${label}.version must be an integer`,
  );
  assert(
    profile.profile.completeness === "complete" ||
      profile.profile.completeness === "incomplete",
    `${label}.profile.completeness is invalid`,
  );
  assert(
    completionReasons.has(profile.profile.completion_reason),
    `${label}.profile.completion_reason is invalid`,
  );
  assertReadiness(profile.profile.readiness, `${label}.profile.readiness`);
  assert(
    typeof profile.profile === "object" && !Array.isArray(profile.profile),
    `${label}.profile must be an object`,
  );
  assert(
    Array.isArray(profile.profile.research_observations),
    `${label}.profile.research_observations must be an array`,
  );
  assert(
    Array.isArray(profile.profile.uncertainties),
    `${label}.profile.uncertainties must be an array`,
  );
  assertMarketAwareFacts(
    profile.profile.confirmed_facts,
    `${label}.profile.confirmed_facts`,
  );
  assertMarketContext(
    profile.profile.market_context,
    profile.profile.research_observations,
    `${label}.profile.market_context`,
  );
  profile.profile.research_observations.forEach((observation, index) =>
    assertResearchObservation(
      observation,
      `${label}.profile.research_observations[${index}]`,
    ),
  );
  profile.profile.uncertainties.forEach((uncertainty, index) =>
    assertUncertainty(uncertainty, `${label}.profile.uncertainties[${index}]`),
  );
  assertString(profile.confirmed_by_user_id, `${label}.confirmed_by_user_id`);
  assertString(profile.confirmed_at, `${label}.confirmed_at`);
  assertString(profile.created_at, `${label}.created_at`);
}

// ---------------------------------------------------------------------------
// Strategy contract validators
// ---------------------------------------------------------------------------

function assertBusinessProfileVersionRef(ref, label) {
  assert(typeof ref === "object" && ref !== null, `${label} must be an object`);
  assertString(ref.business_profile_version_id, `${label}.business_profile_version_id`);
  assertString(ref.confirmed_at, `${label}.confirmed_at`);
  assert(
    Number.isInteger(ref.version) && ref.version > 0,
    `${label}.version must be a positive integer`,
  );
}

function assertStrategyBrief(brief, label) {
  assertString(brief.id, `${label}.id`);
  assertString(brief.strategy_id, `${label}.strategy_id`);
  assertBusinessProfileVersionRef(
    brief.business_profile_version,
    `${label}.business_profile_version`,
  );
  assert(
    strategyObjectives.has(brief.primary_objective),
    `${label}.primary_objective is invalid: ${brief.primary_objective}`,
  );
  assertString(brief.start_date, `${label}.start_date`);
  assert(
    languageModes.has(brief.plan_language),
    `${label}.plan_language is invalid`,
  );
  assert(
    typeof brief.paid_media_allowed === "boolean",
    `${label}.paid_media_allowed must be boolean`,
  );
  assert(
    strategyBudgetModes.has(brief.external_budget_mode),
    `${label}.external_budget_mode is invalid`,
  );
  if (
    brief.external_budget_mode === "monthly_amount" ||
    brief.external_budget_mode === "three_month_amount"
  ) {
    assert(
      brief.external_budget_egp !== null &&
        typeof brief.external_budget_egp === "number" &&
        brief.external_budget_egp > 0,
      `${label}.external_budget_egp must be a positive number when mode requires it`,
    );
  }
  if (brief.paid_media_allowed === false) {
    assert(
      brief.external_budget_mode === "organic_only" ||
        brief.external_budget_mode === "scenario_only",
      `${label}.paid_media_allowed is false but budget mode implies spend`,
    );
  }
  assertString(brief.team_capacity, `${label}.team_capacity`);
  assert(
    Array.isArray(brief.constraints),
    `${label}.constraints must be an array`,
  );
  assert(
    Array.isArray(brief.clarification_answers),
    `${label}.clarification_answers must be an array`,
  );
  brief.clarification_answers.forEach((answer, idx) => {
    assertString(answer.question_id, `${label}.clarification_answers[${idx}].question_id`);
    assertString(answer.question_text, `${label}.clarification_answers[${idx}].question_text`);
    assertString(answer.answer_text, `${label}.clarification_answers[${idx}].answer_text`);
    assertString(answer.answered_at, `${label}.clarification_answers[${idx}].answered_at`);
  });
  assertString(brief.created_at, `${label}.created_at`);
  assertString(brief.updated_at, `${label}.updated_at`);
}

function assertStrategyReadiness(readiness, label) {
  assert(
    typeof readiness.ready === "boolean",
    `${label}.ready must be boolean`,
  );
  assert(
    Array.isArray(readiness.blockers),
    `${label}.blockers must be an array`,
  );
  readiness.blockers.forEach((blocker, idx) => {
    assertString(blocker.code, `${label}.blockers[${idx}].code`);
    assertString(blocker.message, `${label}.blockers[${idx}].message`);
    assert(
      blockerSeverities.has(blocker.severity),
      `${label}.blockers[${idx}].severity is invalid`,
    );
  });
  assert(
    typeof readiness.profile_version_current === "boolean",
    `${label}.profile_version_current must be boolean`,
  );
}

function assertRetrievedKnowledgePack(pack, label) {
  assertString(pack.retrieval_run_id, `${label}.retrieval_run_id`);
  assertString(pack.query_summary, `${label}.query_summary`);
  assert(
    typeof pack.query_context === "object" && pack.query_context !== null,
    `${label}.query_context must be an object`,
  );
  assertString(pack.profile_version_id, `${label}.profile_version_id`);
  assertString(pack.brief_id, `${label}.brief_id`);
  assert(
    Array.isArray(pack.items),
    `${label}.items must be an array`,
  );
  pack.items.forEach((item, idx) => {
    const itemLabel = `${label}.items[${idx}]`;
    assertString(item.chunk_id, `${itemLabel}.chunk_id`);
    assertString(item.entry_id, `${itemLabel}.entry_id`);
    assert(
      Number.isInteger(item.entry_version),
      `${itemLabel}.entry_version must be an integer`,
    );
    assertString(item.title, `${itemLabel}.title`);
    assertString(item.excerpt, `${itemLabel}.excerpt`);
    assertString(item.kind, `${itemLabel}.kind`);
    assert(
      typeof item.tags === "object" && !Array.isArray(item.tags),
      `${itemLabel}.tags must be an object`,
    );
    assert(
      typeof item.relevance_score === "number" &&
        item.relevance_score >= 0 &&
        item.relevance_score <= 1,
      `${itemLabel}.relevance_score must be between 0 and 1`,
    );
    assert(
      typeof item.source_quality === "object" && item.source_quality !== null,
      `${itemLabel}.source_quality must be an object`,
    );
    assert(
      evidenceTiers.has(item.source_quality.evidence_tier),
      `${itemLabel}.source_quality.evidence_tier is invalid`,
    );
    assert(
      Array.isArray(item.source_quality.source_references),
      `${itemLabel}.source_quality.source_references must be an array`,
    );
    assertString(item.source_quality.effective_at, `${itemLabel}.source_quality.effective_at`);
    assert(
      reviewStatuses.has(item.source_quality.review_status),
      `${itemLabel}.source_quality.review_status is invalid`,
    );
    if (item.source_quality.expires_at) {
      const expiresTime = new Date(item.source_quality.expires_at).getTime();
      const retrievedTime = new Date(pack.retrieved_at).getTime();
      if (expiresTime < retrievedTime) {
        assert(
          item.source_quality.review_status === "expired" || item.source_quality.review_status === "retired",
          `${itemLabel}.source_quality.review_status must be expired or retired since expires_at (${item.source_quality.expires_at}) is before retrieved_at (${pack.retrieved_at})`
        );
      }
    }
  });
  assert(
    Array.isArray(pack.knowledge_gaps),
    `${label}.knowledge_gaps must be an array`,
  );
  pack.knowledge_gaps.forEach((gap, idx) => {
    assertString(gap.category, `${label}.knowledge_gaps[${idx}].category`);
    assertString(gap.description, `${label}.knowledge_gaps[${idx}].description`);
    assert(
      gapSeverities.has(gap.severity),
      `${label}.knowledge_gaps[${idx}].severity is invalid`,
    );
  });
  assert(
    typeof pack.retrieval_metadata === "object" && pack.retrieval_metadata !== null,
    `${label}.retrieval_metadata must be an object`,
  );
  assertString(pack.retrieved_at, `${label}.retrieved_at`);
  if (pack.items.length === 0) {
    assert(
      pack.retrieval_metadata.retrieval_latency_ms > 0,
      `${label}: empty items array with no latency indicates retrieval failure`
    );
  }
}

function assertSourcedClaim(claim, label) {
  assertString(claim.text, `${label}.text`);
  assert(claimSources.has(claim.source), `${label}.source is invalid: ${claim.source}`);
  assert(
    Array.isArray(claim.citation_ids),
    `${label}.citation_ids must be an array`,
  );
}

function assertChannelScorecard(channel, label) {
  assertString(channel.channel, `${label}.channel`);
  assert(channelRoles.has(channel.role), `${label}.role is invalid`);
  const scores = channel.scores;
  assert(typeof scores === "object" && scores !== null, `${label}.scores must be an object`);
  const dims = [
    "objective_fit", "audience_fit", "existing_presence",
    "asset_format_fit", "team_capacity", "budget_fit",
    "evidence_strength", "measurement_readiness",
  ];
  dims.forEach((dim) => {
    assert(
      typeof scores[dim] === "number" && scores[dim] >= 0 && scores[dim] <= 1,
      `${label}.scores.${dim} must be between 0 and 1`,
    );
  });
  assert(
    typeof channel.total_score === "number",
    `${label}.total_score must be a number`,
  );
  assertSourcedClaim(channel.rationale, `${label}.rationale`);
}

function assertKpiTarget(kpi, label) {
  assertString(kpi.metric, `${label}.metric`);
  assertString(kpi.funnel_stage, `${label}.funnel_stage`);
  assert(kpiTargetModes.has(kpi.target_mode), `${label}.target_mode is invalid`);
  if (kpi.target_mode === "verified_benchmark_range") {
    assertString(kpi.benchmark_citation_id, `${label}.benchmark_citation_id must be non-null when mode is verified_benchmark_range`);
  }
  assertString(kpi.measurement_method, `${label}.measurement_method`);
  assertSourcedClaim(kpi.notes, `${label}.notes`);
}

function assertBudgetScenario(scenario, label) {
  assert(scenarioTypes.has(scenario.scenario_type), `${label}.scenario_type is invalid`);
  assert(
    typeof scenario.total_egp === "number" && scenario.total_egp > 0,
    `${label}.total_egp must be a positive number`,
  );
  assert(scenario.currency === "EGP", `${label}.currency must be EGP`);
  assert(
    Array.isArray(scenario.channel_allocations),
    `${label}.channel_allocations must be an array`,
  );
  let totalAllocated = 0;
  scenario.channel_allocations.forEach((alloc, idx) => {
    assertString(alloc.channel, `${label}.channel_allocations[${idx}].channel`);
    assert(
      typeof alloc.amount_egp === "number" && alloc.amount_egp >= 0,
      `${label}.channel_allocations[${idx}].amount_egp must be a non-negative number`,
    );
    assert(
      typeof alloc.percentage === "number" && alloc.percentage >= 0 && alloc.percentage <= 100,
      `${label}.channel_allocations[${idx}].percentage must be between 0 and 100`,
    );
    totalAllocated += alloc.amount_egp;
  });
  assert(
    Math.abs(totalAllocated - scenario.total_egp) < 0.01,
    `${label}: channel allocations must sum to total_egp (${totalAllocated} !== ${scenario.total_egp})`,
  );
  assertSourcedClaim(scenario.notes, `${label}.notes`);
}

function assertContentStrategyRoadmap(cs, label) {
  assert(Array.isArray(cs.pillars), `${label}.pillars must be an array`);
  cs.pillars.forEach((p, i) => assertSourcedClaim(p, `${label}.pillars[${i}]`));
  assert(
    cs.pillars.length >= 3 && cs.pillars.length <= 5,
    `${label}.pillars length must be 3-5`,
  );
  assert(Array.isArray(cs.format_mix), `${label}.format_mix must be an array`);
  cs.format_mix.forEach((f, i) => assertSourcedClaim(f, `${label}.format_mix[${i}]`));
  assertString(cs.weekly_cadence, `${label}.weekly_cadence`);
  assert(Array.isArray(cs.weeks), `${label}.weeks must be an array`);
  assert(cs.weeks.length === 12, `${label}.weeks must have 12 entries`);
  cs.weeks.forEach((w, i) => {
    assert(
      Number.isInteger(w.week_number) && w.week_number >= 1 && w.week_number <= 12,
      `${label}.weeks[${i}].week_number is invalid`,
    );
    assertString(w.theme, `${label}.weeks[${i}].theme`);
    assert(Array.isArray(w.formats), `${label}.weeks[${i}].formats must be an array`);
  });
  assert(Array.isArray(cs.experiments), `${label}.experiments must be an array`);
  cs.experiments.forEach((e, i) => {
    assertString(e.id, `${label}.experiments[${i}].id`);
    assertString(e.hypothesis, `${label}.experiments[${i}].hypothesis`);
    assertString(e.method, `${label}.experiments[${i}].method`);
    assertString(e.success_criteria, `${label}.experiments[${i}].success_criteria`);
    assert(
      Array.isArray(e.week_range) && e.week_range.length === 2,
      `${label}.experiments[${i}].week_range must be a tuple of 2`,
    );
  });
}

function assertPlanCitation(citation, label) {
  assertString(citation.citation_id, `${label}.citation_id`);
  assertString(citation.chunk_id, `${label}.chunk_id`);
  assertString(citation.entry_id, `${label}.entry_id`);
  assert(
    Number.isInteger(citation.entry_version),
    `${label}.entry_version must be an integer`,
  );
  assertString(citation.title, `${label}.title`);
  assertString(citation.excerpt, `${label}.excerpt`);
  assert(
    evidenceTiers.has(citation.evidence_tier),
    `${label}.evidence_tier is invalid`,
  );
  assert(
    typeof citation.relevance_score === "number" &&
      citation.relevance_score >= 0 &&
      citation.relevance_score <= 1,
    `${label}.relevance_score must be between 0 and 1`,
  );
}

function assertStrategyPlan(plan, label) {
  assertString(plan.id, `${label}.id`);
  assertString(plan.strategy_id, `${label}.strategy_id`);
  assert(
    Number.isInteger(plan.version),
    `${label}.version must be an integer`,
  );
  assert(
    plan.contract_version === "strategy-v1",
    `${label}.contract_version must be strategy-v1`,
  );
  assertString(plan.brief_id, `${label}.brief_id`);
  assertBusinessProfileVersionRef(plan.profile_version, `${label}.profile_version`);
  assertString(plan.retrieval_run_id, `${label}.retrieval_run_id`);
  assertSourcedClaim(plan.executive_summary, `${label}.executive_summary`);
  assertSourcedClaim(plan.situation_diagnosis, `${label}.situation_diagnosis`);
  assert(
    strategyObjectives.has(plan.primary_objective),
    `${label}.primary_objective is invalid`,
  );
  assertString(plan.funnel_stage, `${label}.funnel_stage`);
  assertSourcedClaim(plan.target_audience, `${label}.target_audience`);
  assertSourcedClaim(plan.positioning, `${label}.positioning`);

  assert(Array.isArray(plan.selected_channels), `${label}.selected_channels must be an array`);
  const primaryCount = plan.selected_channels.filter(
    (ch) => ch.role === "primary",
  ).length;
  const supportingCount = plan.selected_channels.filter(
    (ch) => ch.role === "supporting",
  ).length;
  assert(
    primaryCount <= 2,
    `${label}: at most 2 primary channels allowed, got ${primaryCount}`,
  );
  assert(
    supportingCount <= 1,
    `${label}: at most 1 supporting channel allowed, got ${supportingCount}`,
  );
  plan.selected_channels.forEach((ch, i) =>
    assertChannelScorecard(ch, `${label}.selected_channels[${i}]`),
  );

  assert(Array.isArray(plan.all_channel_scores), `${label}.all_channel_scores must be an array`);
  plan.all_channel_scores.forEach((ch, i) =>
    assertChannelScorecard(ch, `${label}.all_channel_scores[${i}]`),
  );

  assertSourcedClaim(plan.tone, `${label}.tone`);
  assert(
    languageModes.has(plan.plan_language),
    `${label}.plan_language is invalid`,
  );
  assertContentStrategyRoadmap(plan.content_strategy, `${label}.content_strategy`);
  assert(
    strategyBudgetModes.has(plan.budget_mode),
    `${label}.budget_mode is invalid`,
  );

  if (plan.budget_mode === "organic_only") {
    assert(
      plan.budget_scenarios === null,
      `${label}.budget_scenarios must be null when mode is organic_only`,
    );
  } else {
    assert(
      Array.isArray(plan.budget_scenarios),
      `${label}.budget_scenarios must be an array when mode is not organic_only`,
    );
    plan.budget_scenarios.forEach((s, i) =>
      assertBudgetScenario(s, `${label}.budget_scenarios[${i}]`),
    );
  }

  assert(Array.isArray(plan.kpi_targets), `${label}.kpi_targets must be an array`);
  plan.kpi_targets.forEach((kpi, i) =>
    assertKpiTarget(kpi, `${label}.kpi_targets[${i}]`),
  );
  assert(Array.isArray(plan.assumptions), `${label}.assumptions must be an array`);
  plan.assumptions.forEach((a, i) => assertSourcedClaim(a, `${label}.assumptions[${i}]`));
  assert(Array.isArray(plan.risks), `${label}.risks must be an array`);
  plan.risks.forEach((r, i) => assertSourcedClaim(r, `${label}.risks[${i}]`));
  assert(Array.isArray(plan.knowledge_gaps), `${label}.knowledge_gaps must be an array`);
  plan.knowledge_gaps.forEach((g, i) => {
    assertString(g.category, `${label}.knowledge_gaps[${i}].category`);
    assertString(g.description, `${label}.knowledge_gaps[${i}].description`);
    assert(
      gapSeverities.has(g.severity),
      `${label}.knowledge_gaps[${i}].severity is invalid`,
    );
  });
  assert(Array.isArray(plan.blockers), `${label}.blockers must be an array`);
  plan.blockers.forEach((b, i) => {
    assertString(b.code, `${label}.blockers[${i}].code`);
    assertString(b.message, `${label}.blockers[${i}].message`);
    assert(
      blockerSeverities.has(b.severity),
      `${label}.blockers[${i}].severity is invalid`,
    );
  });

  assert(Array.isArray(plan.citations), `${label}.citations must be an array`);
  const citationIds = new Set(plan.citations.map((c) => c.citation_id));
  plan.citations.forEach((c, i) =>
    assertPlanCitation(c, `${label}.citations[${i}]`),
  );

  const allClaims = [
    plan.executive_summary,
    plan.situation_diagnosis,
    plan.target_audience,
    plan.positioning,
    plan.tone,
    ...plan.assumptions,
    ...plan.risks,
    ...plan.content_strategy.pillars,
    ...plan.content_strategy.format_mix,
    ...plan.kpi_targets.map((k) => k.notes),
    ...(plan.budget_scenarios || []).map((s) => s.notes),
    ...plan.selected_channels.map((ch) => ch.rationale),
    ...plan.all_channel_scores.map((ch) => ch.rationale),
  ];
  allClaims.forEach((claim, idx) => {
    if (claim && claim.citation_ids) {
      claim.citation_ids.forEach((cid) => {
        assert(
          citationIds.has(cid),
          `${label}: citation_id ${cid} in claim[${idx}] not found in citations[]`,
        );
      });
    }
  });

  assertString(plan.created_at, `${label}.created_at`);
}

function assertOwnerDecision(decision, label) {
  assertString(decision.id, `${label}.id`);
  assertString(decision.strategy_id, `${label}.strategy_id`);
  assert(
    Number.isInteger(decision.strategy_version),
    `${label}.strategy_version must be an integer`,
  );
  assert(
    decisionTypes.has(decision.decision),
    `${label}.decision is invalid`,
  );
  assertString(decision.decided_by_user_id, `${label}.decided_by_user_id`);
  assertString(decision.decided_at, `${label}.decided_at`);
}

function assertStrategyProgressEvent(event, index, expectedStrategyId) {
  assert(
    event.type === "strategy_progress",
    `progress[${index}] type must be strategy_progress`,
  );
  assert(
    event.strategy_id === expectedStrategyId,
    `progress[${index}] strategy_id mismatch`,
  );
  assert(
    event.seq === index + 1,
    `progress[${index}] seq must be ${index + 1}`,
  );
  assert(
    strategyProgressStages.has(event.stage),
    `progress[${index}] has invalid stage ${event.stage}`,
  );
  assert(
    strategyProgressStatuses.has(event.status),
    `progress[${index}] has invalid status ${event.status}`,
  );
  assertString(event.message_key, `progress[${index}].message_key`);
  assertString(event.message_text, `progress[${index}].message_text`);
}

const startRequest = await loadJson("discovery-start.request.json");
assertString(
  startRequest.intake?.business_name,
  "startRequest.intake.business_name",
);
assertString(
  startRequest.intake?.business_type,
  "startRequest.intake.business_type",
);
assertString(startRequest.intake?.city, "startRequest.intake.city");

const startResponse = await loadJson("discovery-start.response.json");
assert(
  startResponse.status === "researching",
  "start response must begin in researching",
);
assertString(startResponse.session_id, "startResponse.session_id");
assert(
  startResponse.progress_ws_url === "/ws/v1/discovery",
  "progress URL must identify the Socket.IO discovery namespace",
);
assert(
  startResponse.status_url.includes(startResponse.session_id),
  "status URL must include session id",
);

const progressTranscript = await loadJson("discovery-progress.transcript.json");
assert(
  Array.isArray(progressTranscript),
  "progress transcript must be an array",
);
progressTranscript.forEach((event, index) =>
  assertProgressEvent(event, index, startResponse.session_id),
);
assert(
  progressTranscript.at(-1).stage === "ready",
  "progress transcript should end at ready",
);

const statusResponse = await loadJson("discovery-status.response.json");
assert(
  statusResponse.session_id === startResponse.session_id,
  "status response session id mismatch",
);
assertStatus(statusResponse.status, "statusResponse.status");
assert(
  statusResponse.strategy_locked === true,
  "strategy must stay locked before confirmation",
);
assertIntelligence(statusResponse.intelligence, "statusResponse.intelligence");
assertProfileState(statusResponse.profile_state, "statusResponse.profile_state");

const respondResponse = await loadJson("discovery-respond.response.json");
assertStatus(respondResponse.status, "respondResponse.status");
assertMarketAwareFacts(
  respondResponse.updated_known_facts,
  "respondResponse.updated_known_facts",
);
assert(
  respondResponse.strategy_locked === true,
  "strategy must stay locked during chat",
);
assertReadiness(respondResponse.readiness, "respondResponse.readiness");

const summarizeRequest = await loadJson("discovery-summarize.request.json");
assert(
  typeof summarizeRequest.finish_anyway === "boolean",
  "summarize request finish_anyway must be boolean",
);

const summarizeResponse = await loadJson("discovery-summarize.response.json");
assert(
  summarizeResponse.status === "summary_ready",
  "summarize response must be summary_ready",
);
assert(
  summarizeResponse.strategy_locked === true,
  "strategy must stay locked at summary",
);
assertProfileDraft(
  summarizeResponse.profile_draft,
  "summarizeResponse.profile_draft",
);

const confirmRequest = await loadJson("discovery-confirm-profile.request.json");
assert(
  confirmRequest.owner_confirmation === true,
  "confirm request must explicitly confirm",
);
assert(
  confirmRequest.profile_draft_id === summarizeResponse.profile_draft.id,
  "confirm request must reference the draft",
);

const incompleteConfirmRequest = await loadJson(
  "discovery-confirm-incomplete-profile.request.json",
);
assert(
  incompleteConfirmRequest.owner_confirmation === true &&
    incompleteConfirmRequest.acknowledge_incomplete === true,
  "incomplete confirm request must explicitly confirm and acknowledge gaps",
);

const confirmResponse = await loadJson(
  "discovery-confirm-profile.response.json",
);
assert(
  confirmResponse.status === "confirmed",
  "confirm response must be confirmed",
);
assert(
  confirmResponse.strategy_locked === false,
  "strategy unlocks only after confirmation",
);

const aiStartResponse = await loadJson(
  "internal-ai-discovery-start.response.json",
);
assert(aiActions.has(aiStartResponse.action), "AI start action is invalid");
assertString(aiStartResponse.next_question, "aiStartResponse.next_question");
assertMarketAwareFacts(
  aiStartResponse.updated_known_facts,
  "aiStartResponse.updated_known_facts",
);
assertDomainScores(
  aiStartResponse.domain_scores,
  "aiStartResponse.domain_scores",
);
assert(
  typeof aiStartResponse.ready_to_summarize === "boolean",
  "AI start ready_to_summarize must be boolean",
);

const aiSummarizeRequest = await loadJson(
  "internal-ai-discovery-summarize.request.json",
);
assert(
  completionReasons.has(aiSummarizeRequest.completion_context?.reason),
  "AI summarize request completion reason is invalid",
);
assertReadiness(
  aiSummarizeRequest.completion_context?.readiness,
  "aiSummarizeRequest.completion_context.readiness",
);

const aiSummarizeResponse = await loadJson(
  "internal-ai-discovery-summarize.response.json",
);
assert(
  aiActions.has(aiSummarizeResponse.action),
  "AI summarize action is invalid",
);
assert(
  aiSummarizeResponse.action === "produce_profile_draft",
  "AI summarize should produce a profile draft",
);
assertMarketAwareFacts(
  aiSummarizeResponse.updated_known_facts,
  "aiSummarizeResponse.updated_known_facts",
);
assertDomainScores(
  aiSummarizeResponse.domain_scores,
  "aiSummarizeResponse.domain_scores",
);
assert(
  aiSummarizeResponse.ready_to_summarize === true,
  "AI summarize should mark readiness true",
);
assertProfileDraft(
  aiSummarizeResponse.profile_draft,
  "aiSummarizeResponse.profile_draft",
);

const errorEnvelope = await loadJson("error-envelope.response.json");
assert(
  errorCodes.has(errorEnvelope.error?.code),
  "error envelope code is invalid",
);
assertString(errorEnvelope.error.message, "errorEnvelope.error.message");
assertString(errorEnvelope.error.request_id, "errorEnvelope.error.request_id");
assert(
  typeof errorEnvelope.error.retryable === "boolean",
  "errorEnvelope.error.retryable must be boolean",
);

const profileDraftExample = await loadJson(
  "discovery-profile-draft.response.json",
);
assertProfileDraft(profileDraftExample, "profileDraftExample");

const discoverySessionExample = await loadJson(
  "discovery-session.example.json",
);
assertDiscoverySession(discoverySessionExample, "discoverySessionExample");

const agentRunExample = await loadJson("agent-run.example.json");
assertAgentRun(agentRunExample, "agentRunExample");

const fullJourneyExample = await loadJson("cafe-full-journey.example.json");
assertProfileDraft(
  fullJourneyExample.profile_draft,
  "fullJourneyExample.profile_draft",
);
assertBusinessProfile(
  fullJourneyExample.confirmed_business_profile,
  "fullJourneyExample.confirmed_business_profile",
);
assert(
  Array.isArray(fullJourneyExample.agent_runs),
  "fullJourneyExample.agent_runs must be an array",
);
fullJourneyExample.agent_runs.forEach((run, index) =>
  assertAgentRun(run, `fullJourneyExample.agent_runs[${index}]`),
);

// ---------------------------------------------------------------------------
// Strategy contract fixture validation
// ---------------------------------------------------------------------------

const strategyBrief = await loadJson("strategy-brief.example.json");
assertStrategyBrief(strategyBrief, "strategyBrief");

const strategyBriefEnglish = await loadJson("strategy-brief-english.example.json");
assertStrategyBrief(strategyBriefEnglish, "strategyBriefEnglish");

const strategyBriefMixed = await loadJson("strategy-brief-mixed.example.json");
assertStrategyBrief(strategyBriefMixed, "strategyBriefMixed");

const strategyReadiness = await loadJson("strategy-readiness.example.json");
assertStrategyReadiness(strategyReadiness, "strategyReadiness");

const retrievalPack = await loadJson("strategy-retrieval-pack.example.json");
assertRetrievedKnowledgePack(retrievalPack, "retrievalPack");

const strategyPlan = await loadJson("strategy-plan.example.json");
assertStrategyPlan(strategyPlan, "strategyPlan");

const strategyPlanOrganic = await loadJson("strategy-plan-organic.example.json");
assertStrategyPlan(strategyPlanOrganic, "strategyPlanOrganic");

const decisionApproved = await loadJson("strategy-decision-approved.example.json");
assertOwnerDecision(decisionApproved, "decisionApproved");

const decisionRejected = await loadJson("strategy-decision-rejected.example.json");
assertOwnerDecision(decisionRejected, "decisionRejected");

const versionHistory = await loadJson("strategy-version-history.example.json");
assert(Array.isArray(versionHistory), "versionHistory must be an array");
versionHistory.forEach((entry, index) => {
  if (entry.meta) return;
  assertString(entry.strategy_id, `versionHistory[${index}].strategy_id`);
  assert(
    Number.isInteger(entry.version),
    `versionHistory[${index}].version must be an integer`,
  );
  assert(
    strategyStatuses.has(entry.status),
    `versionHistory[${index}].status is invalid`,
  );
});

const progressTranscriptEvents = await loadJson("strategy-progress.transcript.json");
assert(
  Array.isArray(progressTranscriptEvents),
  "progressTranscriptEvents must be an array",
);
const progressStrategyId = "a0000000-0000-4000-8000-000000000001";
const progressEventsOnly = progressTranscriptEvents.filter((e) => e.type === "strategy_progress");
progressEventsOnly.forEach((event, index) =>
  assertStrategyProgressEvent(event, index, progressStrategyId),
);

// Invalid fixture tests
async function assertInvalidFixtureFails(filename, assertFn) {
  let failed = false;
  try {
    const fixture = await loadJson(filename);
    assertFn(fixture, filename);
  } catch (err) {
    failed = true;
  }
  assert(failed, `${filename} should have failed validation but passed`);
}

await assertInvalidFixtureFails("strategy-brief-missing-budget.invalid.json", assertStrategyBrief);
await assertInvalidFixtureFails("strategy-brief-paid-disallowed.invalid.json", assertStrategyBrief);
await assertInvalidFixtureFails("strategy-plan-too-many-channels.invalid.json", assertStrategyPlan);
await assertInvalidFixtureFails("strategy-plan-invalid-citation.invalid.json", assertStrategyPlan);
await assertInvalidFixtureFails("strategy-plan-invalid-benchmark.invalid.json", assertStrategyPlan);
await assertInvalidFixtureFails("strategy-retrieval-expired.invalid.json", assertRetrievedKnowledgePack);
await assertInvalidFixtureFails("strategy-plan-stale-profile.invalid.json", (plan, label) => {
  assertStrategyPlan(plan, label);
  const mockBriefProfileVersion = 1;
  assert(
    plan.profile_version.version === mockBriefProfileVersion,
    "profile_version must match the version referenced in the brief"
  );
});
await assertInvalidFixtureFails("strategy-retrieval-failed.invalid.json", assertRetrievedKnowledgePack);

console.log("Prepared Discovery and Strategy contract examples are valid.");

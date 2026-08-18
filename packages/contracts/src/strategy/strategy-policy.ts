import type { BusinessProfile } from "../discovery/business-profile.schema";
import { CONTENT_CHANNELS, CONTENT_FORMATS } from "../content/content-types";
import type { StrategyBrief } from "./strategy-brief";
import type { OwnerDecision } from "./strategy-lifecycle";
import {
  CHANNEL_SCORE_DIMENSIONS,
  CHANNEL_SCORE_RULE_VERSION,
  type DeterministicChannelScorecard,
  type StrategyPlan,
} from "./strategy-plan";
import type { RetrievedKnowledgePack } from "./strategy-retrieval";
import type {
  StrategyValidationIssue,
  StrategyValidationResult,
} from "./strategy-interfaces";
import {
  CHANNEL_SETUP_STATES,
  CHANNEL_CAPABILITY_STATES,
  STRATEGY_V2_CHANNELS,
  STRATEGY_WEEKLY_CAPACITY_PRESETS,
  OWNER_ADVICE_CATEGORIES,
  CONTENT_HANDOFF_UNAVAILABLE_REASONS,
  type ChannelCommitment,
  type StrategyBriefV2,
  type StrategyChannelChoice,
  type StrategyPlanV2,
} from "./strategy-v2";

export interface StrategyValidationBundle {
  business_profile: BusinessProfile;
  brief: StrategyBrief;
  retrieval_pack: RetrievedKnowledgePack;
  deterministic_channel_scores: DeterministicChannelScorecard[];
  plan: StrategyPlan;
  decision?: OwnerDecision;
}

const roundScore = (value: number): number => Math.round(value * 100) / 100;

export function calculateChannelTotal(
  scorecard: DeterministicChannelScorecard,
): number {
  return roundScore(
    CHANNEL_SCORE_DIMENSIONS.reduce(
      (total, dimension) => total + scorecard.scores[dimension],
      0,
    ),
  );
}

function scorecardsMatch(
  a: DeterministicChannelScorecard,
  b: DeterministicChannelScorecard,
): boolean {
  return (
    a.channel === b.channel &&
    a.role === b.role &&
    CHANNEL_SCORE_DIMENSIONS.every(
      (dimension) => a.scores[dimension] === b.scores[dimension],
    ) &&
    a.total_score === b.total_score &&
    a.excluded_reason === b.excluded_reason
  );
}

const contentAgentLeakagePatterns = [
  /#\w+/u,
  /\bCaption\s*:/iu,
  /\bScript\s*:/iu,
  /\bPost\s*\d+\s*:/iu,
  /\bStory\s*\d+\s*:/iu,
  /\bReel\s*\d+\s*:/iu,
  /\b(?:caption|script|post|story|reel)\b/iu,
] as const;

const executionLanguagePatterns = [
  /\bscheduled\s+for\s+publishing\b/iu,
  /\bads?\s+have\s+been\s+launched\b/iu,
  /\bbudget\s+has\s+been\s+spent\b/iu,
  /\bhas\s+been\s+published\b/iu,
  /\bwe\s+will\s+run\s+the\s+ads?\b/iu,
  /\bauto-?approve\b/iu,
  // Keep Arabic execution checks phrase-based. The previous expression used
  // an unbounded `.*` and matched `تم` inside ordinary words such as
  // `تعتمد`, so safe evidence summaries were rejected when they mentioned an
  // advertisement or publishing as a planning topic.
  /(?<![\u0600-\u06FF])(?:تم|سيتم|هيتم)\s+(?:نشر|إطلاق|اطلاق)(?![\u0600-\u06FF])/u,
  /(?<![\u0600-\u06FF])(?:هننشر|انشر)\s+(?:ال)?(?:بوست|منشور|إعلان|اعلان)(?![\u0600-\u06FF])/u,
] as const;

const paidTacticPatterns = [
  /\bboost(?:ed|ing)?\s+posts?\b/iu,
  /\bpaid\s+(?:ads?|campaign|media|promotion)\b/iu,
  /\bsponsored\s+(?:post|promotion|ad)\b/iu,
  /\bad\s+budget\b/iu,
  /(?:إعلان|اعلان|بوست|منشور)\s+ممول/u,
  /(?:هنشغل|تشغيل|إطلاق|اطلاق).*(?:إعلانات|اعلانات)/u,
  /ميزانية\s+(?:إعلانات|اعلانات)/u,
] as const;

function claimTexts(plan: StrategyPlan): readonly { field: string; text: string }[] {
  return [
    { field: "executive_summary", text: plan.executive_summary.text },
    { field: "situation_diagnosis", text: plan.situation_diagnosis.text },
    { field: "target_audience", text: plan.target_audience.text },
    { field: "positioning", text: plan.positioning.text },
    { field: "tone", text: plan.tone.text },
    ...plan.assumptions.map((claim, index) => ({
      field: `assumptions[${index}]`,
      text: claim.text,
    })),
    ...plan.risks.map((claim, index) => ({
      field: `risks[${index}]`,
      text: claim.text,
    })),
    ...plan.content_strategy.pillars.map((claim, index) => ({
      field: `content_strategy.pillars[${index}]`,
      text: claim.text,
    })),
    ...plan.content_strategy.format_mix.map((claim, index) => ({
      field: `content_strategy.format_mix[${index}]`,
      text: claim.text,
    })),
  ];
}

export function validateStrategyBundle(
  bundle: StrategyValidationBundle,
): StrategyValidationResult {
  const issues: StrategyValidationIssue[] = [];
  const add = (
    code: StrategyValidationIssue["code"],
    field: string,
    message: string,
  ): void => {
    issues.push({ code, field, message });
  };

  const {
    business_profile: profile,
    brief,
    retrieval_pack: pack,
    deterministic_channel_scores: deterministicScores,
    plan,
  } = bundle;

  if (!profile.confirmed_at || !profile.confirmed_by_user_id) {
    add(
      "STRATEGY_PROFILE_UNCONFIRMED",
      "business_profile",
      "Strategy requires a confirmed immutable Business Profile.",
    );
  }

  const profileRefs = [brief.business_profile_version, plan.profile_version];
  if (
    profileRefs.some(
      (reference) =>
        reference.business_profile_version_id !== profile.id ||
        reference.version !== profile.version ||
        reference.confirmed_at !== profile.confirmed_at,
    ) ||
    pack.profile_version_id !== profile.id
  ) {
    add(
      "STRATEGY_PROFILE_STALE",
      "business_profile_version",
      "Profile, brief, retrieval pack, and plan must reference the same confirmed version.",
    );
  }

  if (pack.brief_id !== brief.id || plan.brief_id !== brief.id) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "brief_id",
      "Retrieval pack and plan must reference the supplied Strategy Brief.",
    );
  }
  if (plan.retrieval_run_id !== pack.retrieval_run_id) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "retrieval_run_id",
      "Plan must reference the supplied persisted retrieval run.",
    );
  }
  if (
    bundle.decision &&
    (bundle.decision.strategy_id !== plan.strategy_id ||
      bundle.decision.strategy_version !== plan.version)
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "decision.strategy_version",
      "An owner decision must reference the exact immutable Strategy version being reviewed.",
    );
  }
  if (
    bundle.decision?.decision === "revision_requested" &&
    !bundle.decision.revision_notes?.trim()
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "decision.revision_notes",
      "A revision request must explain what the owner wants changed.",
    );
  }

  const retrievedAt = Date.parse(pack.retrieved_at);
  pack.items.forEach((item, index) => {
    const quality = item.source_quality as {
      review_status: string;
      effective_at: string;
      expires_at: string | null;
    };
    const unavailable =
      quality.review_status !== "approved" ||
      Date.parse(quality.effective_at) > retrievedAt ||
      (quality.expires_at !== null &&
        Date.parse(quality.expires_at) < retrievedAt);
    if (unavailable) {
      add(
        "STRATEGY_EVIDENCE_NOT_APPROVED",
        `retrieval_pack.items[${index}].source_quality`,
        "Retrieved knowledge must be approved, effective, and unexpired.",
      );
    }
  });

  const packItemsByChunk = new Map(
    pack.items.map((item) => [item.chunk_id, item]),
  );
  const citationsById = new Map(
    plan.citations.map((item) => [item.citation_id, item]),
  );
  plan.citations.forEach((citation, index) => {
    const item = packItemsByChunk.get(citation.chunk_id);
    if (
      !item ||
      item.entry_id !== citation.entry_id ||
      item.entry_version !== citation.entry_version ||
      item.source_quality.evidence_tier !== citation.evidence_tier
    ) {
      add(
        "STRATEGY_INVALID_CITATION",
        `plan.citations[${index}]`,
        "Every plan citation must resolve exactly to the persisted retrieval pack.",
      );
    }
  });

  plan.kpi_targets.forEach((target, index) => {
    if (target.target_mode !== "verified_benchmark_range") return;
    const citation = target.benchmark_citation_id
      ? citationsById.get(target.benchmark_citation_id)
      : undefined;
    if (
      !target.target_value ||
      !citation ||
      citation.evidence_tier !== "verified_benchmark"
    ) {
      add(
        "STRATEGY_INVALID_BENCHMARK",
        `plan.kpi_targets[${index}]`,
        "A numeric benchmark needs a target value and a verified citation from the retrieval pack.",
      );
    }
  });

  if (plan.channel_score_rule_version !== CHANNEL_SCORE_RULE_VERSION) {
    add(
      "STRATEGY_SCORE_MISMATCH",
      "plan.channel_score_rule_version",
      "Unsupported deterministic channel score rule version.",
    );
  }
  const deterministicChannels = deterministicScores.map(
    (scorecard) => scorecard.channel,
  );
  const allScoreChannels = plan.all_channel_scores.map(
    (scorecard) => scorecard.channel,
  );
  const selectedChannels = plan.selected_channels.map(
    (scorecard) => scorecard.channel,
  );
  if (
    new Set(deterministicChannels).size !== deterministicChannels.length ||
    new Set(allScoreChannels).size !== allScoreChannels.length ||
    new Set(selectedChannels).size !== selectedChannels.length
  ) {
    add(
      "STRATEGY_SCORE_MISMATCH",
      "plan.selected_channels",
      "Deterministic, all-channel, and selected-channel lists must use unique channel names.",
    );
  }
  plan.all_channel_scores.forEach((scorecard, index) => {
    const dimensionsValid = CHANNEL_SCORE_DIMENSIONS.every((dimension) => {
      const score = scorecard.scores[dimension];
      return Number.isFinite(score) && score >= 0 && score <= 1;
    });
    if (
      !dimensionsValid ||
      calculateChannelTotal(scorecard) !== scorecard.total_score
    ) {
      add(
        "STRATEGY_SCORE_MISMATCH",
        `plan.all_channel_scores[${index}]`,
        "Channel total must be reproducible from eight bounded deterministic dimensions.",
      );
    }
  });
  if (
    deterministicScores.length !== plan.all_channel_scores.length ||
    deterministicScores.some((expected) => {
      const actual = plan.all_channel_scores.find(
        (scorecard) => scorecard.channel === expected.channel,
      );
      return !actual || !scorecardsMatch(expected, actual);
    })
  ) {
    add(
      "STRATEGY_SCORE_MISMATCH",
      "plan.all_channel_scores",
      "The plan must preserve the deterministic channel score input unchanged.",
    );
  }
  plan.selected_channels.forEach((selected, index) => {
    const canonical = plan.all_channel_scores.find(
      (scorecard) => scorecard.channel === selected.channel,
    );
    if (!canonical || !scorecardsMatch(selected, canonical)) {
      add(
        "STRATEGY_SCORE_MISMATCH",
        `plan.selected_channels[${index}]`,
        "Selected channels must exactly reuse deterministic all-channel results.",
      );
    }
  });

  const primaryCount = plan.selected_channels.filter(
    (channel) => channel.role === "primary",
  ).length;
  const supportingCount = plan.selected_channels.filter(
    (channel) => channel.role === "supporting",
  ).length;
  if (primaryCount > 2 || supportingCount > 1) {
    add(
      "STRATEGY_CHANNEL_LIMIT_EXCEEDED",
      "plan.selected_channels",
      "A plan may contain at most two primary and one supporting channel.",
    );
  }

  if (plan.budget_mode !== brief.external_budget_mode) {
    add(
      "STRATEGY_BUDGET_MISMATCH",
      "plan.budget_mode",
      "Plan and brief budget modes must match.",
    );
  }
  if (!brief.paid_media_allowed && plan.budget_scenarios?.length) {
    add(
      "STRATEGY_BUDGET_MISMATCH",
      "plan.budget_scenarios",
      "Paid-spend scenarios are excluded when paid media is disallowed.",
    );
  }
  plan.budget_scenarios?.forEach((scenario, index) => {
    const amountTotal = roundScore(
      scenario.channel_allocations.reduce(
        (total, allocation) => total + allocation.amount_egp,
        0,
      ),
    );
    const percentageTotal = roundScore(
      scenario.channel_allocations.reduce(
        (total, allocation) => total + allocation.percentage,
        0,
      ),
    );
    if (amountTotal !== scenario.total_egp || percentageTotal !== 100) {
      add(
        "STRATEGY_ARITHMETIC_FAILURE",
        `plan.budget_scenarios[${index}].channel_allocations`,
        "Allocations must equal the scenario total and percentages must equal 100.",
      );
    }
    const expectedPeriod =
      brief.external_budget_mode === "monthly_amount"
        ? "monthly"
        : brief.external_budget_mode === "three_month_amount"
          ? "twelve_week"
          : scenario.period;
    if (scenario.period !== expectedPeriod) {
      add(
        "STRATEGY_BUDGET_MISMATCH",
        `plan.budget_scenarios[${index}].period`,
        "Budget scenario period must match the owner-confirmed budget mode.",
      );
    }
    const approvedMaximum =
      brief.external_budget_egp === null
        ? null
        : typeof brief.external_budget_egp === "number"
          ? brief.external_budget_egp
          : brief.external_budget_egp.max_egp;
    const expectedApproval =
      approvedMaximum === null || scenario.total_egp > approvedMaximum;
    if (scenario.requires_owner_budget_approval !== expectedApproval) {
      add(
        "STRATEGY_BUDGET_MISMATCH",
        `plan.budget_scenarios[${index}].requires_owner_budget_approval`,
        "Scenarios outside the confirmed budget must be marked for owner budget approval.",
      );
    }
  });
  const baseScenario = plan.budget_scenarios?.find(
    (scenario) => scenario.scenario_type === "base",
  );
  const scenarioTypes =
    plan.budget_scenarios?.map((scenario) => scenario.scenario_type) ?? [];
  if (
    plan.budget_mode !== "organic_only" &&
    (!plan.budget_scenarios?.length ||
      !baseScenario ||
      new Set(scenarioTypes).size !== scenarioTypes.length)
  ) {
    add(
      "STRATEGY_BUDGET_MISMATCH",
      "plan.budget_scenarios",
      "A paid or scenario plan needs one unique base scenario.",
    );
  }
  const budgetMatches =
    brief.external_budget_egp === null ||
    !baseScenario ||
    (typeof brief.external_budget_egp === "number"
      ? baseScenario.total_egp === brief.external_budget_egp
      : baseScenario.total_egp >= brief.external_budget_egp.min_egp &&
        baseScenario.total_egp <= brief.external_budget_egp.max_egp);
  if (!budgetMatches) {
    add(
      "STRATEGY_BUDGET_MISMATCH",
      "plan.budget_scenarios.base.total_egp",
      "The base scenario must equal the owner-confirmed external budget.",
    );
  }

  const weekNumbers = plan.content_strategy.weeks.map(
    (week) => week.week_number,
  );
  if (
    weekNumbers.length !== 12 ||
    new Set(weekNumbers).size !== 12 ||
    weekNumbers.some((week) => week < 1 || week > 12)
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "plan.content_strategy.weeks",
      "The roadmap must contain each week number from 1 through 12 exactly once.",
    );
  }

  if (plan.knowledge_gaps.some((gap) => gap.severity === "blocking")) {
    add(
      "STRATEGY_KNOWLEDGE_GAP",
      "plan.knowledge_gaps",
      "Blocking knowledge gaps must remain visible and prevent approval.",
    );
  }

  for (const { field, text } of claimTexts(plan)) {
    if (contentAgentLeakagePatterns.some((pattern) => pattern.test(text))) {
      add(
        "STRATEGY_RULE_VIOLATION",
        field,
        "Strategy planning text must not contain finished captions, scripts, posts, or hashtags.",
      );
    }
    if (executionLanguagePatterns.some((pattern) => pattern.test(text))) {
      add(
        "STRATEGY_RULE_VIOLATION",
        field,
        "Strategy planning text must not imply publishing, ad execution, spending, or auto-approval.",
      );
    }
    if (
      !brief.paid_media_allowed &&
      paidTacticPatterns.some((pattern) => pattern.test(text))
    ) {
      add(
        "STRATEGY_RULE_VIOLATION",
        field,
        "Paid tactics are not allowed when paid_media_allowed is false.",
      );
    }
  }

  if (
    bundle.decision?.decision === "approved" &&
    (issues.length > 0 ||
      plan.blockers.some((blocker) => blocker.severity === "blocking"))
  ) {
    add(
      "STRATEGY_APPROVAL_BLOCKED",
      "decision.decision",
      "A Strategy version with blocking validation issues cannot be approved.",
    );
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Strategy v2 policy — owner-first plans
// ---------------------------------------------------------------------------

export interface StrategyV2ValidationBundle {
  business_profile: BusinessProfile;
  brief: StrategyBriefV2;
  retrieval_pack: RetrievedKnowledgePack;
  plan: StrategyPlanV2;
  decision?: OwnerDecision;
}

const LANGUAGE_MODES = ["ar-EG", "en", "mixed"] as const;

/**
 * Validates the brief's channel-choice invariants:
 * 1–3 unique catalog channels, exactly one primary, zero to two supporting,
 * safe setup state, and secret-free ownership constraints.
 */
export function validateStrategyBriefV2Choices(
  brief: StrategyBriefV2,
): StrategyValidationIssue[] {
  const issues: StrategyValidationIssue[] = [];
  const add = (
    code: StrategyValidationIssue["code"],
    field: string,
    message: string,
  ): void => {
    issues.push({ code, field, message });
  };

  const choices = brief.channel_choices;
  if (!Array.isArray(choices) || choices.length < 1 || choices.length > 3) {
    add(
      "STRATEGY_CHANNEL_CHOICE_MISMATCH",
      "brief.channel_choices",
      "An owner-first brief must contain 1 to 3 unique channel choices.",
    );
    return issues;
  }

  const names = choices.map((choice) => choice.channel);
  if (new Set(names).size !== names.length) {
    add(
      "STRATEGY_CHANNEL_CHOICE_MISMATCH",
      "brief.channel_choices",
      "Channel choices must be unique.",
    );
  }
  const primaryCount = choices.filter(
    (choice) => choice.role === "primary",
  ).length;
  const supportingCount = choices.filter(
    (choice) => choice.role === "supporting",
  ).length;
  if (primaryCount !== 1) {
    add(
      "STRATEGY_CHANNEL_CHOICE_MISMATCH",
      "brief.channel_choices",
      "Exactly one primary channel must be selected.",
    );
  }
  if (supportingCount < 0 || supportingCount > 2) {
    add(
      "STRATEGY_CHANNEL_CHOICE_MISMATCH",
      "brief.channel_choices",
      "At most two supporting channels may be selected.",
    );
  }

  choices.forEach((choice, index) => {
    if (!STRATEGY_V2_CHANNELS.includes(choice.channel)) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `brief.channel_choices[${index}].channel`,
        `Unsupported channel '${choice.channel}'.`,
      );
    }
    if (!CHANNEL_SETUP_STATES.includes(choice.setup_state)) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `brief.channel_choices[${index}].setup_state`,
        `Unsupported setup state '${choice.setup_state}'.`,
      );
    }
    if (choice.setup_state !== "existing_link" && choice.public_url) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `brief.channel_choices[${index}].public_url`,
        "A public URL is only allowed for an existing_link setup state.",
      );
    }
    if (choice.setup_state === "existing_link" && !choice.public_url?.trim()) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `brief.channel_choices[${index}].public_url`,
        "An existing_link choice requires an owner-managed public URL.",
      );
    }
    if (choice.setup_state !== "connected" && choice.publishing_target_id) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `brief.channel_choices[${index}].publishing_target_id`,
        "A publishing target is only allowed for a connected setup state.",
      );
    }
    if (choice.setup_state === "connected" && !choice.publishing_target_id) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `brief.channel_choices[${index}].publishing_target_id`,
        "A connected setup state requires a publishing target.",
      );
    }
  });

  if (!STRATEGY_WEEKLY_CAPACITY_PRESETS.includes(brief.weekly_capacity)) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "brief.weekly_capacity",
      `Unsupported weekly capacity preset '${brief.weekly_capacity}'.`,
    );
  }
  return issues;
}

function validateCommitmentsMatchChoices(
  choices: readonly StrategyChannelChoice[],
  commitments: readonly ChannelCommitment[],
  add: (code: StrategyValidationIssue["code"], field: string, message: string) => void,
): void {
  if (!Array.isArray(commitments) || commitments.length !== choices.length) {
    add(
      "STRATEGY_CHANNEL_CHOICE_MISMATCH",
      "plan.channel_commitments",
      "The plan must commit to exactly the owner-selected channels — no added and no dropped choices.",
    );
    return;
  }
  commitments.forEach((commitment, index) => {
    const choice = choices[index];
    if (
      !choice ||
      commitment.channel !== choice.channel ||
      commitment.role !== choice.role ||
      commitment.setup_state !== choice.setup_state
    ) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `plan.channel_commitments[${index}]`,
        "Every commitment must match an owner choice (channel, role, setup state) in the same order.",
      );
      return;
    }
    if (!CHANNEL_CAPABILITY_STATES.includes(commitment.capability_state)) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `plan.channel_commitments[${index}].capability_state`,
        `Unsupported capability state '${commitment.capability_state}'.`,
      );
      return;
    }
    if (!commitment.rationale?.text?.trim()) {
      add(
        "STRATEGY_RULE_VIOLATION",
        `plan.channel_commitments[${index}].rationale`,
        "Each channel commitment needs a plain-language rationale.",
      );
    }
    if (
      commitment.capability_state === "publishing_ready" &&
      (choice.setup_state !== "connected" || !choice.publishing_target_id)
    ) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `plan.channel_commitments[${index}].capability_state`,
        "Publishing-ready requires a connected channel with a verified publishing target.",
      );
    }
    if (
      commitment.capability_state === "publishing_pending" &&
      choice.setup_state !== "connected"
    ) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `plan.channel_commitments[${index}].capability_state`,
        "Publishing-pending requires a connected channel whose target is not yet verified.",
      );
    }
    if (
      commitment.capability_state === "owner_managed" &&
      choice.setup_state === "connected"
    ) {
      add(
        "STRATEGY_CHANNEL_CHOICE_MISMATCH",
        `plan.channel_commitments[${index}].capability_state`,
        "A connected channel is never owner-managed.",
      );
    }
  });
}

function validateContentHandoff(
  plan: StrategyPlanV2,
  add: (code: StrategyValidationIssue["code"], field: string, message: string) => void,
): void {
  const handoff = plan.content_handoff;
  if (!handoff || typeof handoff !== "object") {
    add(
      "STRATEGY_CONTENT_HANDOFF_INVALID",
      "plan.content_handoff",
      "A v2 plan must declare a content handoff state.",
    );
    return;
  }

  if (handoff.available === false) {
    if (
      !CONTENT_HANDOFF_UNAVAILABLE_REASONS.includes(handoff.reason) ||
      !handoff.message?.trim()
    ) {
      add(
        "STRATEGY_CONTENT_HANDOFF_INVALID",
        "plan.content_handoff",
        "An unavailable handoff needs a machine-readable reason and message.",
      );
    }
    return;
  }

  const channels = handoff.channels;
  if (
    !Array.isArray(channels) ||
    channels.length === 0 ||
    channels.some((channel) => !CONTENT_CHANNELS.includes(channel))
  ) {
    add(
      "STRATEGY_CONTENT_HANDOFF_INVALID",
      "plan.content_handoff.channels",
      "Handoff channels must be non-empty existing ContentChannel values.",
    );
  }
  const committedChannels = new Set(
    plan.channel_commitments.map((commitment) => commitment.channel),
  );
  for (const channel of channels) {
    if (!committedChannels.has(channel)) {
      add(
        "STRATEGY_CONTENT_HANDOFF_INVALID",
        "plan.content_handoff.channels",
        `Handoff channel '${channel}' is not an owner-selected channel.`,
      );
    }
  }
  if (!LANGUAGE_MODES.includes(handoff.language)) {
    add(
      "STRATEGY_CONTENT_HANDOFF_INVALID",
      "plan.content_handoff.language",
      "The handoff language must be an existing LanguageMode value.",
    );
  }
  const weeks = handoff.weeks;
  if (!Array.isArray(weeks) || weeks.length !== 12) {
    add(
      "STRATEGY_CONTENT_HANDOFF_INVALID",
      "plan.content_handoff.weeks",
      "A usable content handoff must contain all twelve week mappings.",
    );
    return;
  }
  const weekNumbers = weeks.map((week) => week.week_number);
  if (
    new Set(weekNumbers).size !== 12 ||
    weekNumbers.some((week) => week < 1 || week > 12)
  ) {
    add(
      "STRATEGY_CONTENT_HANDOFF_INVALID",
      "plan.content_handoff.weeks",
      "Handoff weeks must contain each week number 1 through 12 exactly once.",
    );
  }
  weeks.forEach((week, index) => {
    if (
      !Array.isArray(week.formats) ||
      week.formats.length === 0 ||
      week.formats.some(
        (format) =>
          typeof format !== "string" || !CONTENT_FORMATS.includes(format),
      )
    ) {
      add(
        "STRATEGY_CONTENT_HANDOFF_INVALID",
        `plan.content_handoff.weeks[${index}].formats`,
        "Week formats must be non-empty exact content-v1 format values.",
      );
    }
    if (
      Array.isArray(week.formats) &&
      new Set(week.formats).size !== week.formats.length
    ) {
      add(
        "STRATEGY_CONTENT_HANDOFF_INVALID",
        `plan.content_handoff.weeks[${index}].formats`,
        "Week formats must be unique.",
      );
    }
  });
}

function claimTextsV2(
  plan: StrategyPlanV2,
): readonly { field: string; text: string }[] {
  return [
    { field: "goal", text: plan.goal.text },
    { field: "evidence_summary", text: plan.evidence_summary.text },
    ...plan.channel_commitments.map((commitment, index) => ({
      field: `channel_commitments[${index}].rationale`,
      text: commitment.rationale.text,
    })),
    ...plan.owner_advice.before_week_1.map((item, index) => ({
      field: `owner_advice.before_week_1[${index}].source`,
      text: item.source.text,
    })),
    ...plan.owner_advice.weeks.flatMap((group, groupIndex) =>
      group.items.map((item, index) => ({
        field: `owner_advice.weeks[${groupIndex}].items[${index}].source`,
        text: item.source.text,
      })),
    ),
    ...plan.risks.map((claim, index) => ({
      field: `risks[${index}]`,
      text: claim.text,
    })),
  ];
}

/**
 * Cross-object policy validation for owner-first strategy-v2 plans. The v2
 * contract keeps approval, revision, evidence, version history, and safety
 * validation from v1, but the channel invariant changes: every generated
 * commitment must match an owner choice and no extra choice may appear.
 */
export function validateStrategyV2Bundle(
  bundle: StrategyV2ValidationBundle,
): StrategyValidationResult {
  const issues: StrategyValidationIssue[] = [];
  const add = (
    code: StrategyValidationIssue["code"],
    field: string,
    message: string,
  ): void => {
    issues.push({ code, field, message });
  };

  const { business_profile: profile, brief, retrieval_pack: pack, plan } =
    bundle;

  if (!profile.confirmed_at || !profile.confirmed_by_user_id) {
    add(
      "STRATEGY_PROFILE_UNCONFIRMED",
      "business_profile",
      "Strategy requires a confirmed immutable Business Profile.",
    );
  }

  const profileRefs = [brief.business_profile_version, plan.profile_version];
  if (
    profileRefs.some(
      (reference) =>
        reference.business_profile_version_id !== profile.id ||
        reference.version !== profile.version ||
        reference.confirmed_at !== profile.confirmed_at,
    ) ||
    pack.profile_version_id !== profile.id
  ) {
    add(
      "STRATEGY_PROFILE_STALE",
      "business_profile_version",
      "Profile, brief, retrieval pack, and plan must reference the same confirmed version.",
    );
  }

  if (pack.brief_id !== brief.id || plan.brief_id !== brief.id) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "brief_id",
      "Retrieval pack and plan must reference the supplied Strategy Brief.",
    );
  }
  if (plan.retrieval_run_id !== pack.retrieval_run_id) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "retrieval_run_id",
      "Plan must reference the supplied persisted retrieval run.",
    );
  }
  if (
    bundle.decision &&
    (bundle.decision.strategy_id !== plan.strategy_id ||
      bundle.decision.strategy_version !== plan.version)
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "decision.strategy_version",
      "An owner decision must reference the exact immutable Strategy version being reviewed.",
    );
  }
  if (
    bundle.decision?.decision === "revision_requested" &&
    !bundle.decision.revision_notes?.trim()
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "decision.revision_notes",
      "A revision request must explain what the owner wants changed.",
    );
  }

  const retrievedAt = Date.parse(pack.retrieved_at);
  pack.items.forEach((item, index) => {
    const quality = item.source_quality as {
      review_status: string;
      effective_at: string;
      expires_at: string | null;
    };
    const unavailable =
      quality.review_status !== "approved" ||
      Date.parse(quality.effective_at) > retrievedAt ||
      (quality.expires_at !== null &&
        Date.parse(quality.expires_at) < retrievedAt);
    if (unavailable) {
      add(
        "STRATEGY_EVIDENCE_NOT_APPROVED",
        `retrieval_pack.items[${index}].source_quality`,
        "Retrieved knowledge must be approved, effective, and unexpired.",
      );
    }
  });

  const packItemsByChunk = new Map(
    pack.items.map((item) => [item.chunk_id, item]),
  );
  plan.citations.forEach((citation, index) => {
    const item = packItemsByChunk.get(citation.chunk_id);
    if (
      !item ||
      item.entry_id !== citation.entry_id ||
      item.entry_version !== citation.entry_version ||
      item.source_quality.evidence_tier !== citation.evidence_tier
    ) {
      add(
        "STRATEGY_INVALID_CITATION",
        `plan.citations[${index}]`,
        "Every plan citation must resolve exactly to the persisted retrieval pack.",
      );
    }
  });

  if (plan.plan_language !== brief.plan_language) {
    add(
      "STRATEGY_LANGUAGE_MISMATCH",
      "plan.plan_language",
      "Plan and brief plan languages must match.",
    );
  }

  issues.push(...validateStrategyBriefV2Choices(brief));

  validateCommitmentsMatchChoices(
    brief.channel_choices,
    plan.channel_commitments,
    add,
  );

  const weekNumbers = plan.calendar_weeks.map((week) => week.week_number);
  if (
    weekNumbers.length !== 12 ||
    new Set(weekNumbers).size !== 12 ||
    weekNumbers.some((week) => week < 1 || week > 12)
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "plan.calendar_weeks",
      "The plan must contain each week number 1 through 12 exactly once.",
    );
  }
  plan.calendar_weeks.forEach((week, index) => {
    for (const field of ["focus", "expected_outcome", "measurement_check"]) {
      if (!String(week[field as keyof typeof week] ?? "").trim()) {
        add(
          "STRATEGY_RULE_VIOLATION",
          `plan.calendar_weeks[${index}].${field}`,
          "Calendar week fields must be non-empty.",
        );
      }
    }
    if (
      !Array.isArray(week.formats) ||
      week.formats.length === 0 ||
      week.formats.some((format) => typeof format !== "string" || !format.trim())
    ) {
      add(
        "STRATEGY_CONTENT_HANDOFF_INVALID",
        `plan.calendar_weeks[${index}].formats`,
        "Every calendar week must declare at least one format label.",
      );
    }
  });

  const beforeWeek1 = plan.owner_advice.before_week_1;
  if (
    !Array.isArray(beforeWeek1) ||
    beforeWeek1.some((item) => item.week_number !== 0)
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "plan.owner_advice.before_week_1",
      "Before week 1 advice items must carry week_number 0.",
    );
  }
  const adviceWeekNumbers = plan.owner_advice.weeks.map((week) => week.week_number);
  if (
    adviceWeekNumbers.length !== 12 ||
    new Set(adviceWeekNumbers).size !== 12 ||
    adviceWeekNumbers.some((week) => week < 1 || week > 12)
  ) {
    add(
      "STRATEGY_RULE_VIOLATION",
      "plan.owner_advice.weeks",
      "Owner advice must contain one collection for each week 1 through 12.",
    );
  }
  const allAdviceItems = [
    ...beforeWeek1,
    ...plan.owner_advice.weeks.flatMap((week) => week.items),
  ];
  allAdviceItems.forEach((item, index) => {
    if (!OWNER_ADVICE_CATEGORIES.includes(item.category)) {
      add(
        "STRATEGY_RULE_VIOLATION",
        `plan.owner_advice.items[${index}].category`,
        `Unsupported advice category '${item.category}'.`,
      );
    }
    for (const field of ["action", "why_it_matters", "timing"]) {
      if (!String(item[field as keyof typeof item] ?? "").trim()) {
        add(
          "STRATEGY_RULE_VIOLATION",
          `plan.owner_advice.items[${index}].${field}`,
          "Owner advice items must state the action, why it matters, and timing.",
        );
      }
    }
    if (item.week_number < 0 || item.week_number > 12) {
      add(
        "STRATEGY_RULE_VIOLATION",
        `plan.owner_advice.items[${index}].week_number`,
        "Advice week_number must be 0 (before week 1) or 1 through 12.",
      );
    }
  });

  validateContentHandoff(plan, add);

  if (plan.knowledge_gaps.some((gap) => gap.severity === "blocking")) {
    add(
      "STRATEGY_KNOWLEDGE_GAP",
      "plan.knowledge_gaps",
      "Blocking knowledge gaps must remain visible and prevent approval.",
    );
  }

  for (const { field, text } of claimTextsV2(plan)) {
    if (contentAgentLeakagePatterns.some((pattern) => pattern.test(text))) {
      add(
        "STRATEGY_RULE_VIOLATION",
        field,
        "Strategy planning text must not contain finished captions, scripts, posts, or hashtags.",
      );
    }
    if (executionLanguagePatterns.some((pattern) => pattern.test(text))) {
      add(
        "STRATEGY_RULE_VIOLATION",
        field,
        "Strategy planning text must not imply publishing, ad execution, spending, or auto-approval.",
      );
    }
    if (
      !brief.paid_media_allowed &&
      paidTacticPatterns.some((pattern) => pattern.test(text))
    ) {
      add(
        "STRATEGY_RULE_VIOLATION",
        field,
        "Paid tactics are not allowed when paid_media_allowed is false.",
      );
    }
  }

  if (
    bundle.decision?.decision === "approved" &&
    (issues.length > 0 ||
      plan.blockers.some((blocker) => blocker.severity === "blocking"))
  ) {
    add(
      "STRATEGY_APPROVAL_BLOCKED",
      "decision.decision",
      "A Strategy version with blocking validation issues cannot be approved.",
    );
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Dispatches a bundle to the validator matching the plan's contract version.
 * Legacy `strategy-v1` plans keep the exact v1 policy; v2 plans use the
 * owner-first invariant.
 */
export function validateStrategyPlanBundle(
  bundle: StrategyValidationBundle | StrategyV2ValidationBundle,
): StrategyValidationResult {
  if (
    (bundle.plan as StrategyPlanV2).contract_version === "strategy-v2" &&
    "channel_commitments" in bundle.plan
  ) {
    return validateStrategyV2Bundle(bundle as StrategyV2ValidationBundle);
  }
  return validateStrategyBundle(bundle as StrategyValidationBundle);
}

import type { BusinessProfile } from "../discovery/business-profile.schema";
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  validateStrategyBundle,
  type BusinessProfile,
  type DeterministicChannelScorecard,
  type OwnerDecision,
  type RetrievedKnowledgePack,
  type StrategyBrief,
  type StrategyGenerateRequest,
  type StrategyPlan,
} from "../src/index";

const examplesUrl = new URL("../examples/", import.meta.url);

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, examplesUrl), "utf8")) as T;
}

const brief = await loadJson<StrategyBrief>("strategy-brief.example.json");
const retrievalPack = await loadJson<RetrievedKnowledgePack>(
  "strategy-retrieval-pack.example.json",
);
const plan = await loadJson<StrategyPlan>("strategy-plan.example.json");
const journey = await loadJson<{ confirmed_business_profile: BusinessProfile }>(
  "cafe-full-journey.example.json",
);

const request: StrategyGenerateRequest = {
  contract_version: "strategy-v1",
  strategy_id: plan.strategy_id,
  business_profile: journey.confirmed_business_profile,
  brief,
  retrieved_knowledge_pack: retrievalPack,
  deterministic_channel_scores: plan.all_channel_scores,
};

const valid = validateStrategyBundle({
  business_profile: request.business_profile,
  brief: request.brief,
  retrieval_pack: request.retrieved_knowledge_pack,
  deterministic_channel_scores: request.deterministic_channel_scores,
  plan,
});
assert.deepEqual(
  valid.issues,
  [],
  `valid fixture failed: ${JSON.stringify(valid.issues)}`,
);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectCode(
  code: string,
  overrides: {
    brief?: StrategyBrief;
    retrievalPack?: RetrievedKnowledgePack;
    deterministicScores?: DeterministicChannelScorecard[];
    plan?: StrategyPlan;
    decision?: OwnerDecision;
  },
): void {
  const result = validateStrategyBundle({
    business_profile: request.business_profile,
    brief: overrides.brief ?? brief,
    retrieval_pack: overrides.retrievalPack ?? retrievalPack,
    deterministic_channel_scores:
      overrides.deterministicScores ?? plan.all_channel_scores,
    plan: overrides.plan ?? plan,
    decision: overrides.decision,
  });
  assert(
    result.issues.some((issue) => issue.code === code),
    `expected ${code}, got ${JSON.stringify(result.issues)}`,
  );
}

const retiredPack = clone(retrievalPack) as unknown as RetrievedKnowledgePack;
(
  retiredPack.items[0].source_quality as { review_status: string }
).review_status = "retired";
expectCode("STRATEGY_EVIDENCE_NOT_APPROVED", { retrievalPack: retiredPack });

const badBenchmarkPlan = clone(plan);
badBenchmarkPlan.kpi_targets[0].benchmark_citation_id =
  "ffffffff-ffff-4fff-8fff-ffffffffffff";
expectCode("STRATEGY_INVALID_BENCHMARK", { plan: badBenchmarkPlan });

const badScorePlan = clone(plan);
badScorePlan.all_channel_scores[0].total_score = 999;
expectCode("STRATEGY_SCORE_MISMATCH", { plan: badScorePlan });

const changedDeterministicScores = clone(plan.all_channel_scores);
changedDeterministicScores[0].excluded_reason = "Changed after scoring";
expectCode("STRATEGY_SCORE_MISMATCH", {
  deterministicScores: changedDeterministicScores,
});

const missingBasePlan = clone(plan);
missingBasePlan.budget_scenarios = missingBasePlan.budget_scenarios?.filter(
  (scenario) => scenario.scenario_type !== "base",
);
expectCode("STRATEGY_BUDGET_MISMATCH", { plan: missingBasePlan });

const duplicateWeeksPlan = clone(plan);
duplicateWeeksPlan.content_strategy.weeks = Array.from({ length: 12 }, () =>
  clone(plan.content_strategy.weeks[0]),
);
expectCode("STRATEGY_RULE_VIOLATION", { plan: duplicateWeeksPlan });

const stalePlan = await loadJson<StrategyPlan>(
  "strategy-plan-stale-profile.invalid.json",
);
expectCode("STRATEGY_PROFILE_STALE", { plan: stalePlan });

const decision = await loadJson<OwnerDecision>(
  "strategy-decision-approved.example.json",
);
decision.strategy_version = plan.version + 1;
expectCode("STRATEGY_RULE_VIOLATION", { decision });
expectCode("STRATEGY_APPROVAL_BLOCKED", { decision });

console.log("Strategy cross-object policy and endpoint contracts are valid.");

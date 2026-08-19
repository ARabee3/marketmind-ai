import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  validateStrategyBundle,
  validateStrategyV2Bundle,
  type BusinessProfile,
  type DeterministicChannelScorecard,
  type OwnerDecision,
  type RetrievedKnowledgePack,
  type StrategyBrief,
  type StrategyBriefV2,
  type StrategyGenerateRequest,
  type StrategyPlan,
  type StrategyPlanV2,
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

const contentLeakagePlan = clone(plan);
contentLeakagePlan.executive_summary = {
  ...contentLeakagePlan.executive_summary,
  text: "Caption: اطلب الكشري الآن مع #KosharyCorner",
};
expectCode("STRATEGY_RULE_VIOLATION", { plan: contentLeakagePlan });

const paidTacticBrief = {
  ...brief,
  paid_media_allowed: false,
  external_budget_mode: "scenario_only",
  external_budget_egp: null,
} satisfies StrategyBrief;
const paidTacticPlan = clone(plan);
paidTacticPlan.executive_summary = {
  ...paidTacticPlan.executive_summary,
  text: "Run boosted posts and launch paid ads this week.",
};
expectCode("STRATEGY_RULE_VIOLATION", {
  brief: paidTacticBrief,
  plan: paidTacticPlan,
});

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

// ---------------------------------------------------------------------------
// Owner-first strategy-v2 policy
// ---------------------------------------------------------------------------

const v2Brief = await loadJson<StrategyBriefV2>("strategy-brief-v2.example.json");
const v2Plan = await loadJson<StrategyPlanV2>("strategy-plan-v2.example.json");

function v2Profile() {
  return {
    ...request.business_profile,
    id: v2Brief.business_profile_version.business_profile_version_id,
    version: v2Brief.business_profile_version.version,
    confirmed_at: v2Brief.business_profile_version.confirmed_at,
  };
}

const v2Valid = validateStrategyV2Bundle({
  business_profile: v2Profile(),
  brief: v2Brief,
  retrieval_pack: retrievalPack,
  plan: v2Plan,
});
assert.deepEqual(
  v2Valid.issues,
  [],
  `valid v2 fixture failed: ${JSON.stringify(v2Valid.issues)}`,
);

function expectV2Code(
  code: string,
  overrides: {
    brief?: StrategyBriefV2;
    plan?: StrategyPlanV2;
  },
): void {
  const result = validateStrategyV2Bundle({
    business_profile: v2Profile(),
    brief: overrides.brief ?? v2Brief,
    retrieval_pack: retrievalPack,
    plan: overrides.plan ?? v2Plan,
  });
  assert(
    result.issues.some((issue) => issue.code === code),
    `expected ${code}, got ${JSON.stringify(result.issues)}`,
  );
}

const explicitArabicExecutionPlan = clone(v2Plan) as unknown as StrategyPlanV2;
explicitArabicExecutionPlan.evidence_summary.text =
  "تم نشر الإعلان أمس وحقق نتائج جيدة.";
expectV2Code("STRATEGY_RULE_VIOLATION", {
  plan: explicitArabicExecutionPlan,
});

const safeArabicPlanningPlan = clone(v2Plan) as unknown as StrategyPlanV2;
safeArabicPlanningPlan.evidence_summary.text =
  "تعتمد الخطة على بيانات الملف لتقييم الإعلان المقترح.";
const safeArabicPlanningResult = validateStrategyV2Bundle({
  business_profile: v2Profile(),
  brief: v2Brief,
  retrieval_pack: retrievalPack,
  plan: safeArabicPlanningPlan,
});
assert(
  !safeArabicPlanningResult.issues.some(
    (issue) =>
      issue.code === "STRATEGY_RULE_VIOLATION" &&
      issue.message.includes("publishing"),
  ),
  `safe Arabic planning text was rejected: ${JSON.stringify(safeArabicPlanningResult.issues)}`,
);

// The v2 plan must commit to exactly the owner's choices.
const extraChannelPlan = clone(v2Plan) as unknown as StrategyPlanV2;
extraChannelPlan.channel_commitments = [
  ...extraChannelPlan.channel_commitments,
  {
    channel: "tiktok",
    role: "supporting",
    setup_state: "setup_later",
    capability_state: "owner_managed",
    rationale: {
      text: "لم يختر المالك تيك توك.",
      source: "owner_input",
      citation_ids: [],
    },
  },
];
expectV2Code("STRATEGY_CHANNEL_CHOICE_MISMATCH", { plan: extraChannelPlan });

const droppedChannelPlan = clone(v2Plan) as unknown as StrategyPlanV2;
droppedChannelPlan.channel_commitments = droppedChannelPlan.channel_commitments
  .slice(0, 2);
expectV2Code("STRATEGY_CHANNEL_CHOICE_MISMATCH", { plan: droppedChannelPlan });

const wrongRolePlan = clone(v2Plan) as unknown as StrategyPlanV2;
wrongRolePlan.channel_commitments[0].role = "supporting";
expectV2Code("STRATEGY_CHANNEL_CHOICE_MISMATCH", { plan: wrongRolePlan });

const duplicateWeeksV2 = clone(v2Plan) as unknown as StrategyPlanV2;
duplicateWeeksV2.calendar_weeks = Array.from({ length: 12 }, () =>
  clone(v2Plan.calendar_weeks[0]),
);
expectV2Code("STRATEGY_RULE_VIOLATION", { plan: duplicateWeeksV2 });

const badHandoffChannels = clone(v2Plan) as unknown as StrategyPlanV2;
badHandoffChannels.content_handoff = {
  available: true,
  channels: ["tiktok"],
  language: "ar-EG",
  weeks: v2Plan.content_handoff.available === true
    ? v2Plan.content_handoff.weeks
    : [],
};
expectV2Code("STRATEGY_CONTENT_HANDOFF_INVALID", {
  plan: badHandoffChannels,
});

const emptyHandoffWeek = clone(v2Plan) as unknown as StrategyPlanV2;
if (emptyHandoffWeek.content_handoff.available === true) {
  emptyHandoffWeek.content_handoff.weeks[0] = {
    week_number: 1,
    formats: [],
  };
}
expectV2Code("STRATEGY_CONTENT_HANDOFF_INVALID", { plan: emptyHandoffWeek });

const unknownHandoffFormat = clone(v2Plan) as unknown as StrategyPlanV2;
if (unknownHandoffFormat.content_handoff.available === true) {
  unknownHandoffFormat.content_handoff.weeks[1] = {
    week_number: 2,
    formats: ["mystery_format"],
  };
}
expectV2Code("STRATEGY_CONTENT_HANDOFF_INVALID", { plan: unknownHandoffFormat });

const badBriefChoices = {
  ...v2Brief,
  channel_choices: [v2Brief.channel_choices[0]],
} satisfies StrategyBriefV2;
expectV2Code("STRATEGY_CHANNEL_CHOICE_MISMATCH", { brief: badBriefChoices });

const missingUrlChoice = {
  ...v2Brief,
  channel_choices: v2Brief.channel_choices.map((choice) =>
    choice.channel === "instagram"
      ? { ...choice, public_url: undefined }
      : choice,
  ),
} satisfies StrategyBriefV2;
expectV2Code("STRATEGY_CHANNEL_CHOICE_MISMATCH", { brief: missingUrlChoice });

// Website/delivery-only plans remain approvable but the handoff is
// explicitly unavailable.
const ownerManagedPlan = clone(v2Plan) as unknown as StrategyPlanV2;
ownerManagedPlan.channel_commitments = [
  {
    channel: "website",
    role: "primary",
    setup_state: "existing_link",
    capability_state: "owner_managed",
    rationale: {
      text: "الموقع يديره المالك مباشرة.",
      source: "owner_input",
      citation_ids: [],
    },
  },
];
ownerManagedPlan.content_handoff = {
  available: false,
  reason: "no_content_supported_channels",
  message: "No owner-selected channel maps to content-v1.",
};
const ownerManagedBrief = {
  ...v2Brief,
  channel_choices: [
    {
      channel: "website",
      role: "primary",
      setup_state: "existing_link",
      public_url: "https://kosharycorner.com",
    },
  ],
} satisfies StrategyBriefV2;
const ownerManagedResult = validateStrategyV2Bundle({
  business_profile: v2Profile(),
  brief: ownerManagedBrief,
  retrieval_pack: retrievalPack,
  plan: ownerManagedPlan,
});
assert.deepEqual(
  ownerManagedResult.issues,
  [],
  `owner-managed v2 plan failed: ${JSON.stringify(ownerManagedResult.issues)}`,
);

console.log("Strategy cross-object policy and endpoint contracts are valid.");

import type {
  ContentCycle,
  ContentPack,
  ContentProgressEvent,
  ContentWeekContext,
  CurrentJourneyResponse,
  StrategyBriefV2,
  StrategyVersionSummary,
} from "@marketmind/contracts";
import { createStrategyPlanV2Fixture } from "@/features/strategy/lib/strategy-plan-v2-fixture";
import type { StrategyApiResponse } from "@/lib/api/strategy";

export const MOCK_BUSINESS_ID = "11111111-1111-4111-a111-111111111111";
export const MOCK_STRATEGY_ID = "22222222-2222-4222-a222-222222222222";
export const MOCK_STRATEGY_VERSION_ID = "33333333-3333-4333-a333-333333333333";
export const MOCK_DECISION_ID = "44444444-4444-4444-a444-444444444444";
export const MOCK_PROFILE_VERSION_ID = "55555555-5555-4555-a555-555555555555";
export const MOCK_CYCLE_ID = "66666666-6666-4666-a666-666666666666";
export const MOCK_PACK_ID = "77777777-7777-4777-a777-777777777777";
export const MOCK_USER_ID = "00000000-0000-4000-a000-000000000000";
export const MOCK_CLAIM_ID = "88888888-8888-4888-a888-888888888888";

export const mockRoadmapWeeks = Array.from({ length: 12 }, (_, i) => ({
  week_number: i + 1,
  theme: `Week ${i + 1} Theme: Essential Growth & Promotions`,
  focus_products_or_services: ["Signature Product A", "Service B"],
  primary_goal: "Drive conversion and engagement",
  key_message: `Week ${i + 1} primary message for Egyptian SMEs`,
  suggested_format: "Carousel post",
  formats: ["carousel"],
}));

export const mockApprovedStrategyApi: StrategyApiResponse = {
  id: MOCK_STRATEGY_ID,
  businessId: MOCK_BUSINESS_ID,
  status: "approved",
  ownerUserId: MOCK_USER_ID,
  currentVersionId: MOCK_STRATEGY_VERSION_ID,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-02T10:00:00.000Z",
  brief: {
    id: "brief-1",
    strategyId: MOCK_STRATEGY_ID,
    businessProfileVersionId: MOCK_PROFILE_VERSION_ID,
    businessProfileVersion: {
      id: MOCK_PROFILE_VERSION_ID,
      confirmedAt: "2026-08-01T09:00:00.000Z",
      version: 1,
    },
    primaryObjective: "conversion",
    startDate: "2026-08-10",
    planLanguage: "ar-EG",
    paidMediaAllowed: false,
    externalBudgetMode: "organic_only",
    externalBudgetEgp: null,
    teamCapacity: "1-2 hours per week",
    constraints: "No discount promotions over 20%",
    clarificationAnswers: [],
    createdAt: "2026-08-01T09:30:00.000Z",
    updatedAt: "2026-08-01T09:30:00.000Z",
  },
  latestPlan: {
    id: "plan-1",
    strategy_id: MOCK_STRATEGY_ID,
    version: 1,
    contract_version: "strategy-v1",
    brief_id: "brief-1",
    profile_version: {
      business_profile_version_id: MOCK_PROFILE_VERSION_ID,
      version: 1,
      confirmed_at: "2026-08-01T09:00:00.000Z",
    },
    retrieval_run_id: "run-1",
    channel_score_rule_version: "strategy-channel-score-v1",
    executive_summary: {
      text: "Comprehensive 12-week marketing strategy for SME growth.",
      source: "model_synthesis",
      citation_ids: [],
    },
    situation_diagnosis: {
      text: "Diagnosis text",
      source: "model_synthesis",
      citation_ids: [],
    },
    primary_objective: "conversion",
    funnel_stage: "acquisition",
    target_audience: {
      text: "Egyptian Tech-savvy Consumers & SMEs",
      source: "model_synthesis",
      citation_ids: [],
    },
    positioning: {
      text: "The smart growth partner for local businesses.",
      source: "model_synthesis",
      citation_ids: [],
    },
    selected_channels: [
      {
        channel: "facebook",
        role: "primary",
        rationale: { text: "High fit", source: "deterministic_result", citation_ids: [] },
        total_score: 90,
        excluded_reason: null,
        scores: {
          objective_fit: 10,
          audience_fit: 10,
          existing_presence: 10,
          asset_format_fit: 10,
          team_capacity: 10,
          budget_fit: 10,
          evidence_strength: 10,
          measurement_readiness: 10,
        },
      },
      {
        channel: "instagram",
        role: "supporting",
        rationale: { text: "Good fit", source: "deterministic_result", citation_ids: [] },
        total_score: 80,
        excluded_reason: null,
        scores: {
          objective_fit: 10,
          audience_fit: 10,
          existing_presence: 10,
          asset_format_fit: 10,
          team_capacity: 10,
          budget_fit: 10,
          evidence_strength: 10,
          measurement_readiness: 10,
        },
      },
    ],
    all_channel_scores: [],
    tone: {
      text: "Professional & Friendly",
      source: "model_synthesis",
      citation_ids: [],
    },
    plan_language: "ar-EG",
    content_strategy: {
      pillars: [
        { text: "Product Spotlights", source: "model_synthesis", citation_ids: [] },
        { text: "Customer Stories", source: "model_synthesis", citation_ids: [] },
        { text: "Educational Tips", source: "model_synthesis", citation_ids: [] },
      ],
      format_mix: [],
      weekly_cadence: "3 posts per week",
      weeks: mockRoadmapWeeks,
      experiments: [],
    },
    budget_mode: "organic_only",
    budget_scenarios: null,
    kpi_targets: [],
    assumptions: [],
    risks: [],
    knowledge_gaps: [],
    blockers: [],
    citations: [],
    created_at: "2026-08-02T10:00:00.000Z",
  },
};

export const mockStrategyVersions: StrategyVersionSummary[] = [
  {
    version_id: MOCK_STRATEGY_VERSION_ID,
    strategy_id: MOCK_STRATEGY_ID,
    version: 1,
    status: "approved",
    brief_id: "brief-1",
    retrieval_run_id: "run-1",
    profile_version: {
      business_profile_version_id: MOCK_PROFILE_VERSION_ID,
      version: 1,
      confirmed_at: "2026-08-01T09:00:00.000Z",
    },
    prompt_config: {},
    created_at: "2026-08-02T10:00:00.000Z",
    decision: {
      id: MOCK_DECISION_ID,
      strategy_id: MOCK_STRATEGY_ID,
      strategy_version: 1,
      decision: "approved",
      revision_notes: null,
      decided_by_user_id: MOCK_USER_ID,
      decided_at: "2026-08-02T10:05:00.000Z",
    },
  },
];

const v2BriefContract: StrategyBriefV2 = {
  id: "brief-1",
  strategy_id: MOCK_STRATEGY_ID,
  business_profile_version: {
    business_profile_version_id: MOCK_PROFILE_VERSION_ID,
    confirmed_at: "2026-08-01T09:00:00.000Z",
    version: 1,
  },
  primary_objective: "conversion",
  start_date: "2026-08-10",
  plan_language: "ar-EG",
  paid_media_allowed: false,
  external_budget_mode: "organic_only",
  external_budget_egp: null,
  weekly_capacity: "three_to_five_hours",
  weekly_capacity_note: undefined,
  channel_choices: [
    { channel: "facebook", role: "primary", setup_state: "setup_later" },
    { channel: "instagram", role: "supporting", setup_state: "setup_later" },
  ],
  constraints: [],
  clarification_answers: [],
  created_at: "2026-08-01T09:30:00.000Z",
  updated_at: "2026-08-01T09:30:00.000Z",
};

/** Approved owner-first strategy-v2 strategy whose handoff supports Content. */
export const mockApprovedStrategyApiV2: StrategyApiResponse = {
  ...mockApprovedStrategyApi,
  brief: {
    ...mockApprovedStrategyApi.brief!,
    teamCapacity: null,
    weeklyCapacity: "three_to_five_hours",
    weeklyCapacityNote: null,
    channelChoices: [
      { channel: "facebook", role: "primary", setupState: "setup_later" },
      { channel: "instagram", role: "supporting", setupState: "setup_later" },
    ],
  },
  latestPlan: createStrategyPlanV2Fixture({
    idSuffix: "contentReady",
    brief: v2BriefContract,
    retrievalRunId: "run-1",
    blockers: [],
  }),
};

export const mockJourneyNoCycle: CurrentJourneyResponse = {
  owner: {
    user_id: MOCK_USER_ID,
    full_name: "Ahmed Hassan",
    email: "ahmed@example.com",
    email_verified: true,
  },
  journey: {
    state: "discovery_confirmed",
    discovery: {
      session_id: "session-1",
      status: "confirmed",
      language_mode: "ar-EG",
      business_summary: {
        business_name: "Modern Cairo Cafe",
        business_type: "Hospitality & Dining",
        city: "Cairo",
        area: null,
      },
      readiness: {
        ready: true,
        profile_readiness: 1,
        owner_turn_count: 5,
        max_owner_turns: 10,
      },
      profile_draft_id: null,
      confirmed_profile_version_id: MOCK_PROFILE_VERSION_ID,
      updated_at: "2026-08-01T09:00:00.000Z",
      completed_at: "2026-08-01T09:00:00.000Z",
    },
    profile: {
      business_profile_version_id: MOCK_PROFILE_VERSION_ID,
      business_id: MOCK_BUSINESS_ID,
      version: 1,
      business_name: "Modern Cairo Cafe",
      business_type: "Hospitality & Dining",
      city: "Cairo",
      area: null,
      confirmed_at: "2026-08-01T09:00:00.000Z",
    },
  },
  future_phase: {
    phase: "strategy",
    availability: "available",
    status: "approved",
    reason: "strategy_active",
    strategy_id: MOCK_STRATEGY_ID,
    current_version_id: MOCK_STRATEGY_VERSION_ID,
    destination: `/strategy/${MOCK_STRATEGY_ID}`,
    business: null,
  },
  primary_action: {
    type: "view_strategy",
    strategy_id: MOCK_STRATEGY_ID,
    destination: `/strategy/${MOCK_STRATEGY_ID}`,
  },
  content: {
    ready: true,
    reason: "no_cycle",
    cycle: null,
    pack: null,
  },
  generated_at: "2026-08-06T10:00:00.000Z",
};

export const mockActiveCycle: ContentCycle = {
  id: MOCK_CYCLE_ID,
  contract_version: "content-v1",
  business_id: MOCK_BUSINESS_ID,
  strategy_id: MOCK_STRATEGY_ID,
  strategy_version: 1,
  strategy_decision_id: MOCK_DECISION_ID,
  profile_version_id: MOCK_PROFILE_VERSION_ID,
  status: "active",
  current_week_number: 1,
  next_generation_at: "2026-08-17T00:00:00.000Z",
  timezone: "Africa/Cairo",
  pause_reason: null,
  completed_at: null,
  created_at: "2026-08-06T10:00:00.000Z",
  updated_at: "2026-08-06T10:00:00.000Z",
};

export const mockOwnerConfirmedContextWeek1: ContentWeekContext = {
  id: "context-1",
  contract_version: "content-v1",
  content_cycle_id: MOCK_CYCLE_ID,
  week_number: 1,
  week_start_date: "2026-08-10",
  context_source: "owner_confirmed",
  confirmed_by_user_id: MOCK_USER_ID,
  confirmed_at: "2026-08-06T10:00:00.000Z",
  system_defaulted_at: null,
  promotion_mode: "owner_approved",
  promotion: {
    text: "Summer Refresh Special: Buy 1 Get 1 50% Off",
    terms: ["Valid Sunday to Thursday", "Dine-in only"],
    valid_from: "2026-08-10T09:00:00.000Z",
    valid_until: "2026-08-17T00:00:00.000Z",
  },
  must_include: ["Mention summer discount", "Tag Cairo location"],
  must_avoid: ["Do not mention online delivery"],
  cta_destination: {
    type: "whatsapp",
    value: "+201000000000",
  },
  approved_asset_ids: ["asset-101", "asset-102"],
  generation_cutoff_at: "2026-08-09T23:59:59.000Z",
  weekly_claim_id: MOCK_CLAIM_ID,
};

export const mockSystemDefaultedContextWeek1: ContentWeekContext = {
  id: "context-default-1",
  contract_version: "content-v1",
  content_cycle_id: MOCK_CYCLE_ID,
  week_number: 1,
  week_start_date: "2026-08-10",
  context_source: "system_defaulted",
  confirmed_by_user_id: null,
  confirmed_at: null,
  system_defaulted_at: "2026-08-09T23:59:59.000Z",
  promotion_mode: "none",
  promotion: null,
  must_include: [],
  must_avoid: [],
  cta_destination: {
    type: "none",
    value: null,
  },
  approved_asset_ids: [],
  generation_cutoff_at: "2026-08-09T23:59:59.000Z",
  weekly_claim_id: MOCK_CLAIM_ID,
};

export const mockQueuedPack: ContentPack = {
  id: MOCK_PACK_ID,
  contract_version: "content-v1",
  content_cycle_id: MOCK_CYCLE_ID,
  weekly_claim_id: MOCK_CLAIM_ID,
  week_number: 1,
  business_id: MOCK_BUSINESS_ID,
  strategy_id: MOCK_STRATEGY_ID,
  strategy_version: 1,
  strategy_decision_id: MOCK_DECISION_ID,
  profile_version_id: MOCK_PROFILE_VERSION_ID,
  week_context_id: "context-1",
  status: "queued",
  retry_eligible: false,
  item_ids: ["item-1", "item-2", "item-3", "item-4"],
  created_at: "2026-08-06T10:01:00.000Z",
  updated_at: "2026-08-06T10:01:00.000Z",
};

export const mockDraftPack: ContentPack = {
  ...mockQueuedPack,
  status: "draft",
  updated_at: "2026-08-06T10:02:00.000Z",
};

export const mockFailedRetryablePack: ContentPack = {
  ...mockQueuedPack,
  status: "failed",
  retry_eligible: true,
  updated_at: "2026-08-06T10:02:00.000Z",
};

export const mockFailedNonRetryablePack: ContentPack = {
  ...mockQueuedPack,
  status: "failed",
  retry_eligible: false,
  updated_at: "2026-08-06T10:02:00.000Z",
};

export const mockPackProgressEvents: ContentProgressEvent[] = [
  {
    type: "content_progress",
    content_pack_id: MOCK_PACK_ID,
    seq: 1,
    stage: "queued",
    status: "started",
    message_key: "generation_queued",
    message_text: "Queued for generation",
    payload: {},
    created_at: "2026-08-06T10:01:05.000Z",
  },
  {
    type: "content_progress",
    content_pack_id: MOCK_PACK_ID,
    seq: 2,
    stage: "generating",
    status: "progress",
    message_key: "generating_items",
    message_text: "Generating draft items",
    payload: {},
    created_at: "2026-08-06T10:01:10.000Z",
  },
];

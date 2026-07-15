import type {
  UUID,
  IsoDateTime,
  LanguageMode,
} from "../discovery/prepared-discovery-contracts";
import type {
  ContractVersion,
  BusinessProfileVersionRef,
} from "./strategy-ids";
import type {
  StrategyObjective,
  ExternalBudgetMode,
  StrategyBlocker,
} from "./strategy-brief";
import type { KnowledgeGapItem, PlanCitation } from "./strategy-retrieval";

export const CLAIM_SOURCES = [
  "confirmed_fact",
  "owner_input",
  "retrieved_evidence",
  "deterministic_result",
  "model_synthesis",
] as const;

export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export interface SourcedClaim {
  text: string;
  source: ClaimSource;
  citation_ids: UUID[];
  confidence_note?: string;
}

export const CHANNEL_ROLES = ["primary", "supporting"] as const;

export type ChannelRole = (typeof CHANNEL_ROLES)[number];

export const CHANNEL_SCORE_RULE_VERSION = "strategy-channel-score-v1" as const;

export const CHANNEL_SCORE_DIMENSIONS = [
  "objective_fit",
  "audience_fit",
  "existing_presence",
  "asset_format_fit",
  "team_capacity",
  "budget_fit",
  "evidence_strength",
  "measurement_readiness",
] as const;

export type ChannelScoreDimension = (typeof CHANNEL_SCORE_DIMENSIONS)[number];

export interface ChannelDimensionScores {
  objective_fit: number;
  audience_fit: number;
  existing_presence: number;
  asset_format_fit: number;
  team_capacity: number;
  budget_fit: number;
  evidence_strength: number;
  measurement_readiness: number;
}

export interface DeterministicChannelScorecard {
  channel: string;
  role: ChannelRole;
  scores: ChannelDimensionScores;
  total_score: number;
  excluded_reason: string | null;
}

export interface ChannelScorecard extends DeterministicChannelScorecard {
  /** LLM explanation of immutable deterministic numbers. */
  rationale: SourcedClaim;
}

export const KPI_TARGET_MODES = [
  "establish_baseline",
  "owner_target",
  "baseline_improvement",
  "verified_benchmark_range",
] as const;

export type KpiTargetMode = (typeof KPI_TARGET_MODES)[number];

export interface KpiTarget {
  metric: string;
  funnel_stage: string;
  target_mode: KpiTargetMode;
  target_value?: string;
  benchmark_citation_id?: UUID;
  measurement_method: string;
  notes: SourcedClaim;
}

export interface ChannelAllocation {
  channel: string;
  amount_egp: number;
  percentage: number;
}

export interface BudgetScenario {
  scenario_type: "conservative" | "base" | "growth";
  period: "monthly" | "twelve_week";
  total_egp: number;
  currency: "EGP";
  channel_allocations: ChannelAllocation[];
  /** True when the scenario exceeds the amount currently confirmed by the owner. */
  requires_owner_budget_approval: boolean;
  notes: SourcedClaim;
}

export interface WeekPlan {
  week_number: number;
  theme: string;
  formats: string[];
  notes?: string;
}

export interface ExperimentPlan {
  id: UUID;
  hypothesis: string;
  method: string;
  success_criteria: string;
  week_range: [number, number];
}

export interface ContentStrategyRoadmap {
  pillars: SourcedClaim[];
  format_mix: SourcedClaim[];
  weekly_cadence: string;
  weeks: WeekPlan[];
  experiments: ExperimentPlan[];
}

export interface StrategyPlan {
  id: UUID;
  strategy_id: UUID;
  version: number;
  contract_version: ContractVersion;
  brief_id: UUID;
  profile_version: BusinessProfileVersionRef;
  retrieval_run_id: UUID;
  channel_score_rule_version: typeof CHANNEL_SCORE_RULE_VERSION;
  executive_summary: SourcedClaim;
  situation_diagnosis: SourcedClaim;
  primary_objective: StrategyObjective;
  funnel_stage: string;
  target_audience: SourcedClaim;
  positioning: SourcedClaim;
  selected_channels: ChannelScorecard[];
  all_channel_scores: ChannelScorecard[];
  tone: SourcedClaim;
  plan_language: LanguageMode;
  content_strategy: ContentStrategyRoadmap;
  budget_mode: ExternalBudgetMode;
  budget_scenarios: BudgetScenario[] | null;
  kpi_targets: KpiTarget[];
  assumptions: SourcedClaim[];
  risks: SourcedClaim[];
  knowledge_gaps: KnowledgeGapItem[];
  blockers: StrategyBlocker[];
  citations: PlanCitation[];
  created_at: IsoDateTime;
}

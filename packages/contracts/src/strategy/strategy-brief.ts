import type {
  UUID,
  IsoDateTime,
  LanguageMode,
} from "../discovery/prepared-discovery-contracts";
import type { BusinessProfileVersionRef } from "./strategy-ids";

export const STRATEGY_OBJECTIVES = [
  "awareness",
  "acquisition",
  "conversion",
  "retention",
  "launch",
] as const;

export type StrategyObjective = (typeof STRATEGY_OBJECTIVES)[number];

export const EXTERNAL_BUDGET_MODES = [
  "organic_only",
  "monthly_amount",
  "three_month_amount",
  "scenario_only",
] as const;

export type ExternalBudgetMode = (typeof EXTERNAL_BUDGET_MODES)[number];

export interface ExternalBudgetRangeEgp {
  min_egp: number;
  max_egp: number;
}

export type ExternalBudgetEgp = number | ExternalBudgetRangeEgp | null;

export interface StrategyClarification {
  question_id: UUID;
  question_text: string;
  answer_text: string;
  answered_at: IsoDateTime;
}

export interface StrategyBrief {
  id: UUID;
  strategy_id: UUID;
  business_profile_version: BusinessProfileVersionRef;
  primary_objective: StrategyObjective;
  start_date: IsoDateTime;
  plan_language: LanguageMode;
  paid_media_allowed: boolean;
  external_budget_mode: ExternalBudgetMode;
  external_budget_egp: ExternalBudgetEgp;
  team_capacity: string;
  constraints: string[];
  clarification_answers: StrategyClarification[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface StrategyBlocker {
  code: string;
  field?: string;
  message: string;
  severity: "blocking" | "warning";
}

export interface StrategyReadiness {
  ready: boolean;
  blockers: StrategyBlocker[];
  profile_version_current: boolean;
}

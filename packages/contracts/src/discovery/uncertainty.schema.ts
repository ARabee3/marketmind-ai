export type UncertaintySeverity = "low" | "medium" | "high";

export type DiscoveryProfileDomain =
  | "identity"
  | "offer"
  | "customers"
  | "differentiation"
  | "current_marketing"
  | "goals_and_constraints"
  | "market_context";

export type UncertaintyCategory =
  | "missing_information"
  | "contradiction"
  | "low_confidence"
  | "owner_unknown"
  | "research_gap"
  | "ambiguous_answer";

export type UncertaintySource =
  | "owner_answer"
  | "owner_unknown"
  | "research_observation"
  | "metadata_extraction"
  | "search_result"
  | "intake_form"
  | "ai_inference";

export interface UncertaintyInput {
  domain: DiscoveryProfileDomain;
  field_key: string;
  description: string;
  severity: UncertaintySeverity;
  category: UncertaintyCategory;
  source: UncertaintySource;
  source_ref_id?: string;
  owner_stated_value?: string;
  research_suggested_value?: string;
  contradiction_detail?: string;
}

export interface Uncertainty extends UncertaintyInput {
  resolved: boolean;
  resolved_at?: string;
  resolved_by_action?:
    | "owner_clarified"
    | "research_confirmed"
    | "discarded"
    | "skipped";
}

export type UncertaintyCreateInput = UncertaintyInput;

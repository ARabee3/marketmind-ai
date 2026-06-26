export type UncertaintySeverity = "low" | "medium" | "high";

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

export interface Uncertainty {
  field_key: string;

  description: string;

  severity: UncertaintySeverity;

  category: UncertaintyCategory;

  source: UncertaintySource;

  source_ref_id?: string;

  owner_stated_value?: string;

  research_suggested_value?: string;

  contradiction_detail?: string;

  resolved: boolean;

  resolved_at?: string;

  resolved_by_action?: "owner_clarified" | "research_confirmed" | "discarded" | "skipped";

  created_at: string;

  updated_at: string;
}

export interface UncertaintyCreateInput {
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

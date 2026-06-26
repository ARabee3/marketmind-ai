import type { ResearchObservation } from "./prepared-discovery-contracts";
import type { Uncertainty } from "./uncertainty.schema";

export type BusinessProfileStatus = "active" | "superseded" | "archived";

export interface BusinessProfile {
  id: string;

  business_id: string;

  draft_id: string;

  version: number;

  status: BusinessProfileStatus;

  profile: {
    business_name: string;
    business_type: string;
    city: string;
    area?: string;
    address_text?: string;
    primary_locale: string;
    confirmed_facts: Record<string, unknown>;
    owner_goals: string[];
    strategy_relevant_notes: string[];
  };

  source_draft_observations: ResearchObservation[];

  resolved_uncertainties: Uncertainty[];

  confirmed_by_user_id: string;

  confirmed_at: string;

  superseded_at?: string;

  superseded_by_version?: number;

  created_at: string;
}

export interface BusinessProfileCreateInput {
  business_id: string;
  draft_id: string;
  version: number;
  profile: BusinessProfile["profile"];
  source_draft_observations: ResearchObservation[];
  resolved_uncertainties: Uncertainty[];
  confirmed_by_user_id: string;
}

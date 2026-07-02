import type {
  MarketAwareBusinessFacts,
  MarketContextSnapshot,
  ResearchObservation,
} from "./prepared-discovery-contracts";
import type { Uncertainty } from "./uncertainty.schema";

export interface BusinessProfileData {
  business_name: string;
  business_type: string;
  city: string;
  area?: string;
  address_text?: string;
  primary_locale: string;
  confirmed_facts: MarketAwareBusinessFacts;
  market_context: MarketContextSnapshot;
  research_observations: ResearchObservation[];
  uncertainties: Uncertainty[];
  owner_goals: string[];
  strategy_relevant_notes: string[];
}

export interface BusinessProfile {
  id: string;
  business_id: string;
  draft_id: string | null;
  version: number;
  profile: BusinessProfileData;
  confirmed_by_user_id: string;
  confirmed_at: string;
  created_at: string;
}

export interface BusinessProfileCreateInput {
  business_id: string;
  draft_id?: string;
  version: number;
  profile: BusinessProfileData;
  confirmed_by_user_id: string;
}

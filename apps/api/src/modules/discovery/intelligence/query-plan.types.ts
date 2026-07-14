import { LanguageModeDto } from "../dto/start-discovery.dto";

export type QueryPlanSource = "llm" | "deterministic";

export type SearchQueryIntent =
  | "business_match"
  | "competitor_discovery"
  | "market_context"
  | "social_profile"
  | "review_presence";

export type SearchProviderHint =
  | "serpapi"
  | "duckduckgo"
  | "apify_google_maps"
  | "metadata";

export type ResearchProviderName =
  | SearchProviderHint
  | "apify_facebook_pages"
  | "apify_facebook_posts";

export type PlannedSearchQuery = {
  readonly intent: SearchQueryIntent;
  readonly query: string;
  readonly language: LanguageModeDto;
  readonly priority: number;
  readonly provider_hints: readonly SearchProviderHint[];
  readonly metadata?: Record<string, unknown>;
};

export type QueryPlan = {
  readonly source: QueryPlanSource;
  readonly queries: readonly PlannedSearchQuery[];
  readonly warnings?: readonly string[];
};

import type { ResearchProviderName } from "./query-plan.types";
import type {
  SearchProviderWarning,
  SearchResultCandidate,
} from "./search-result.types";

export type SocialEnrichmentAttempt = {
  readonly provider: Extract<
    ResearchProviderName,
    "apify_facebook_pages" | "apify_facebook_posts"
  >;
  readonly outcome: "succeeded" | "empty" | "failed";
  readonly result_count: number;
  readonly duration_ms: number;
  readonly error_code?: string;
};

export type SocialEnrichmentResult = {
  readonly candidates: readonly SearchResultCandidate[];
  readonly provider_warnings: readonly SearchProviderWarning[];
  readonly provider_attempts: readonly SocialEnrichmentAttempt[];
};

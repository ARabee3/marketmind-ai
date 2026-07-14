import type {
  ResearchProviderName,
  SearchProviderHint,
} from "./query-plan.types";

export type SearchProviderName = Exclude<SearchProviderHint, "metadata">;

export type SearchResultCandidate = {
  readonly provider: ResearchProviderName;
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
  readonly rank: number;
  readonly query: string;
  readonly confidence: number;
  readonly metadata?: Record<string, unknown>;
};

export type SearchProviderWarning = {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
};

export type SearchProviderAttempt = {
  readonly provider: SearchProviderName;
  readonly outcome: "succeeded" | "empty" | "failed";
  readonly result_count: number;
  readonly error_code?: string;
};

export type SearchResponse = {
  readonly results: readonly SearchResultCandidate[];
  readonly provider_warnings: readonly SearchProviderWarning[];
  readonly provider_attempts: readonly SearchProviderAttempt[];
};

export interface SearchProvider {
  search(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]>;
}

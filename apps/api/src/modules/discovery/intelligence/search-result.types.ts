export type SearchProviderName = "serpapi" | "duckduckgo";

export type SearchResultCandidate = {
  readonly provider: SearchProviderName;
  readonly title?: string;
  readonly url?: string;
  readonly snippet?: string;
  readonly rank: number;
  readonly query: string;
  readonly confidence: number;
  readonly metadata?: Record<string, unknown>;
};

export interface SearchProvider {
  search(query: string): Promise<readonly SearchResultCandidate[]>;
}

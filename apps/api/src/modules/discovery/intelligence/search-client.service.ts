import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { ApifyMapsProvider } from "./apify-maps.provider";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { SearchProviderHint } from "./query-plan.types";
import {
  SearchProviderAttempt,
  SearchProviderName,
  SearchProviderWarning,
  SearchResponse,
  SearchResultCandidate,
} from "./search-result.types";
import { SerpApiSearchProvider } from "./serpapi-search.provider";

const DEFAULT_PROVIDER_ORDER: readonly SearchProviderName[] = [
  "serpapi",
  "duckduckgo",
];

@Injectable()
export class SearchClientService {
  constructor(
    private readonly apifyMaps: ApifyMapsProvider,
    private readonly serpApi: SerpApiSearchProvider,
    private readonly duckDuckGo: DuckDuckGoSearchProvider,
  ) {}

  async search(
    query: string,
    providerHints: readonly SearchProviderHint[] = [],
    signal?: AbortSignal,
  ): Promise<SearchResponse> {
    signal?.throwIfAborted();
    const providerWarnings: SearchProviderWarning[] = [];
    const providerAttempts: SearchProviderAttempt[] = [];

    for (const provider of providerOrder(providerHints)) {
      signal?.throwIfAborted();
      const results = await this.trySearch(
        provider,
        () => this.searchWithProvider(provider, query, signal),
        providerWarnings,
        providerAttempts,
        signal,
      );
      if (results.length > 0) {
        return {
          results,
          provider_warnings: providerWarnings,
          provider_attempts: providerAttempts,
        };
      }
    }

    return {
      results: [],
      provider_warnings: providerWarnings,
      provider_attempts: providerAttempts,
    };
  }

  private searchWithProvider(
    provider: SearchProviderName,
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    switch (provider) {
      case "apify_google_maps":
        return this.apifyMaps.search(query, signal);
      case "duckduckgo":
        return this.duckDuckGo.search(query, signal);
      case "serpapi":
        return this.serpApi.search(query, signal);
    }
  }

  private async trySearch(
    provider: SearchProviderName,
    search: () => Promise<readonly SearchResultCandidate[]>,
    providerWarnings: SearchProviderWarning[],
    providerAttempts: SearchProviderAttempt[],
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    try {
      const results = await search();
      providerAttempts.push({
        provider,
        outcome: results.length > 0 ? "succeeded" : "empty",
        result_count: results.length,
      });
      return results;
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      providerWarnings.push({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
      providerAttempts.push({
        provider,
        outcome: "failed",
        result_count: 0,
        error_code: error.code,
      });
      return [];
    }
  }
}

function providerOrder(
  providerHints: readonly SearchProviderHint[],
): readonly SearchProviderName[] {
  if (providerHints.length === 0) {
    return DEFAULT_PROVIDER_ORDER;
  }

  const providers: SearchProviderName[] = [];
  for (const hint of providerHints) {
    if (hint === "metadata" || providers.includes(hint)) {
      continue;
    }
    providers.push(hint);
  }
  return providers;
}

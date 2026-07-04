import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { ApifyMapsProvider } from "./apify-maps.provider";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { SearchProviderHint } from "./query-plan.types";
import {
  SearchProviderWarning,
  SearchResponse,
  SearchResultCandidate,
} from "./search-result.types";
import { SerpApiSearchProvider } from "./serpapi-search.provider";

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

    if (providerHints.includes("apify_google_maps")) {
      const mapsResults = await this.trySearch(
        () => this.apifyMaps.search(query, signal),
        providerWarnings,
        signal,
      );
      if (mapsResults.length > 0) {
        return { results: mapsResults, provider_warnings: providerWarnings };
      }
    }

    const serpResults = await this.trySearch(
      () => this.serpApi.search(query, signal),
      providerWarnings,
      signal,
    );
    if (serpResults.length > 0) {
      return { results: serpResults, provider_warnings: providerWarnings };
    }

    signal?.throwIfAborted();
    const duckResults = await this.duckDuckGo.search(query, signal);

    return { results: duckResults, provider_warnings: providerWarnings };
  }

  private async trySearch(
    search: () => Promise<readonly SearchResultCandidate[]>,
    providerWarnings: SearchProviderWarning[],
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    try {
      return await search();
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
      return [];
    }
  }
}

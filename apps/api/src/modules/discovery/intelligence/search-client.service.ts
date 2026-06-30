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
  ): Promise<SearchResponse> {
    const providerWarnings: SearchProviderWarning[] = [];

    if (providerHints.includes("apify_google_maps")) {
      const mapsResults = await this.trySearch(
        () => this.apifyMaps.search(query),
        providerWarnings,
      );
      if (mapsResults.length > 0) {
        return { results: mapsResults, provider_warnings: providerWarnings };
      }
    }

    const serpResults = await this.trySearch(
      () => this.serpApi.search(query),
      providerWarnings,
    );
    if (serpResults.length > 0) {
      return { results: serpResults, provider_warnings: providerWarnings };
    }

    const duckResults = await this.duckDuckGo.search(query);

    return { results: duckResults, provider_warnings: providerWarnings };
  }

  private async trySearch(
    search: () => Promise<readonly SearchResultCandidate[]>,
    providerWarnings: SearchProviderWarning[],
  ): Promise<readonly SearchResultCandidate[]> {
    try {
      return await search();
    } catch (error) {
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

import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { ApifyMapsProvider } from "./apify-maps.provider";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { SearchProviderHint } from "./query-plan.types";
import { SearchResultCandidate } from "./search-result.types";
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
  ): Promise<readonly SearchResultCandidate[]> {
    if (providerHints.includes("apify_google_maps")) {
      const mapsResults = await this.trySearch(() =>
        this.apifyMaps.search(query),
      );
      if (mapsResults.length > 0) {
        return mapsResults;
      }
    }

    const serpResults = await this.trySearch(() => this.serpApi.search(query));
    if (serpResults.length > 0) {
      return serpResults;
    }

    return this.duckDuckGo.search(query);
  }

  private async trySearch(
    search: () => Promise<readonly SearchResultCandidate[]>,
  ): Promise<readonly SearchResultCandidate[]> {
    try {
      return await search();
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      return [];
    }
  }
}

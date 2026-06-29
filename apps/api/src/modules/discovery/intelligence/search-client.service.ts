import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { SearchResultCandidate } from "./search-result.types";
import { SerpApiSearchProvider } from "./serpapi-search.provider";

@Injectable()
export class SearchClientService {
  constructor(
    private readonly serpApi: SerpApiSearchProvider,
    private readonly duckDuckGo: DuckDuckGoSearchProvider,
  ) {}

  async search(query: string): Promise<readonly SearchResultCandidate[]> {
    try {
      const results = await this.serpApi.search(query);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
    }

    return this.duckDuckGo.search(query);
  }
}

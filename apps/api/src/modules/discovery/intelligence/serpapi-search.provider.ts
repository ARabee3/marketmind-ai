import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { getExternalJson } from "../../../common/http/external-http-client";
import { SearchProvider, SearchResultCandidate } from "./search-result.types";

@Injectable()
export class SerpApiSearchProvider implements SearchProvider {
  async search(query: string): Promise<readonly SearchResultCandidate[]> {
    const config = externalProviderConfig();

    if (!config.serpApiKey) {
      throw new ProviderError(
        "SERPAPI_NOT_CONFIGURED",
        "SERPAPI_KEY is not configured.",
        false,
      );
    }

    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", config.serpApiKey);
      url.searchParams.set("hl", "en");
      url.searchParams.set("gl", "eg");
      url.searchParams.set("num", "10");

      const response = await getExternalJson<unknown>(url.toString(), {
        timeoutMs: config.discoverySearchTimeoutMs,
      });

      return parseSerpApiResults(response, query);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      throw new ProviderError(
        "SERPAPI_SEARCH_FAILED",
        error instanceof Error ? error.message : "SerpApi search failed.",
        true,
      );
    }
  }
}

function parseSerpApiResults(
  response: unknown,
  query: string,
): readonly SearchResultCandidate[] {
  if (typeof response !== "object" || response === null) {
    return [];
  }

  const organicResults = (response as { readonly organic_results?: unknown })
    .organic_results;

  if (!Array.isArray(organicResults)) {
    return [];
  }

  return organicResults
    .map((result, index) => toSearchResult(result, index, query))
    .filter((result): result is SearchResultCandidate => result !== undefined);
}

function toSearchResult(
  value: unknown,
  index: number,
  query: string,
): SearchResultCandidate | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const result = value as {
    readonly title?: unknown;
    readonly link?: unknown;
    readonly snippet?: unknown;
    readonly position?: unknown;
  };

  if (typeof result.title !== "string" && typeof result.link !== "string") {
    return undefined;
  }

  const rank =
    typeof result.position === "number" ? result.position : index + 1;

  return {
    provider: "serpapi",
    title: typeof result.title === "string" ? result.title : undefined,
    url: typeof result.link === "string" ? result.link : undefined,
    snippet: typeof result.snippet === "string" ? result.snippet : undefined,
    rank,
    query,
    confidence: Math.max(0.25, 1 - (rank - 1) * 0.05),
    metadata: { engine: "google" },
  };
}

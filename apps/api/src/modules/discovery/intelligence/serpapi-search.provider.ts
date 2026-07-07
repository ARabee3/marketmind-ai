import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { getExternalJson } from "../../../common/http/external-http-client";
import { SearchProvider, SearchResultCandidate } from "./search-result.types";

@Injectable()
export class SerpApiSearchProvider implements SearchProvider {
  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
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
        signal,
      });

      return parseSerpApiResults(response, query);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new ProviderError(
          "SERPAPI_TIMEOUT",
          `SerpApi search timed out after ${config.discoverySearchTimeoutMs}ms.`,
          true,
        );
      }

      throw new ProviderError("SERPAPI_SEARCH_FAILED", serpApiError(error), true);
    }
  }
}

function serpApiError(error: unknown): string {
  return error instanceof Error && error.message
    ? `SerpApi search failed: ${error.message}`
    : "SerpApi search failed.";
}

function parseSerpApiResults(
  response: unknown,
  query: string,
): readonly SearchResultCandidate[] {
  if (typeof response !== "object" || response === null) {
    return [];
  }

  const payload = response as {
    readonly organic_results?: unknown;
    readonly local_results?: unknown;
  };
  const organicResults = Array.isArray(payload.organic_results)
    ? payload.organic_results
    : [];
  const localResults = localResultItems(payload.local_results);

  return [...organicResults, ...localResults]
    .map((result, index) => toSearchResult(result, index, query))
    .filter((result): result is SearchResultCandidate => result !== undefined);
}

function localResultItems(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }

  const localResults = value as { readonly places?: unknown };
  return Array.isArray(localResults.places) ? localResults.places : [];
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
    readonly place_id?: unknown;
    readonly rating?: unknown;
    readonly reviews?: unknown;
    readonly address?: unknown;
    readonly phone?: unknown;
    readonly website?: unknown;
  };

  const title = stringValue(result.title);
  const url = stringValue(result.link) ?? stringValue(result.website);
  const address = stringValue(result.address);
  const phone = stringValue(result.phone);
  const rating = numberValue(result.rating);
  const reviews = numberValue(result.reviews);
  const placeId = stringValue(result.place_id);
  const snippet = stringValue(result.snippet) ?? localSnippet({
    address,
    phone,
    rating,
    reviews,
  });
  const isLocalResult = Boolean(address ?? phone ?? rating ?? reviews ?? placeId);

  if (!title && !url) {
    return undefined;
  }

  const rank =
    typeof result.position === "number" ? result.position : index + 1;

  return {
    provider: "serpapi",
    title,
    url,
    snippet,
    rank,
    query,
    confidence: Math.max(0.25, (isLocalResult ? 0.95 : 1) - (rank - 1) * 0.05),
    metadata: {
      engine: "google",
      ...(isLocalResult
        ? {
            result_type: "local_result",
            address,
            phone,
            rating,
            reviews,
            place_id: placeId,
          }
        : {}),
    },
  };
}

function localSnippet(value: {
  readonly address?: string;
  readonly phone?: string;
  readonly rating?: number;
  readonly reviews?: number;
}): string | undefined {
  const parts = [
    value.address,
    value.phone ? `tel: ${value.phone}` : undefined,
    value.rating ? `rating: ${value.rating}` : undefined,
    value.reviews ? `reviews: ${value.reviews}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

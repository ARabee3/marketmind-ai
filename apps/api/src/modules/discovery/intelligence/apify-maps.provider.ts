import { Injectable } from "@nestjs/common";
import { ProviderError } from "../../../common/errors/provider-error";
import { ApifyActorClient } from "./apify/apify-actor.client";
import { SearchProvider, SearchResultCandidate } from "./search-result.types";

const GOOGLE_MAPS_ACTOR_ID = "nwua9Gu5YrADL7ZDj";
const MAX_MAPS_RESULTS = 5;

@Injectable()
export class ApifyMapsProvider implements SearchProvider {
  constructor(private readonly actorClient: ApifyActorClient) {}

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    try {
      const response = await this.actorClient.runDatasetItems(
        {
          actorId: GOOGLE_MAPS_ACTOR_ID,
          input: {
            searchStringsArray: [query],
            maxCrawledPlacesPerSearch: MAX_MAPS_RESULTS,
            language: "ar",
          },
          maxItems: MAX_MAPS_RESULTS,
          timeoutMs: 60_000,
        },
        signal,
      );

      return parseApifyMapsResults(response, query);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ProviderError) {
        throw new ProviderError(
          error.code === "APIFY_NOT_CONFIGURED"
            ? error.code
            : "APIFY_MAPS_ERROR",
          error.code === "APIFY_NOT_CONFIGURED"
            ? error.message
            : "Apify Google Maps search failed.",
          error.retryable,
        );
      }

      throw new ProviderError(
        "APIFY_MAPS_ERROR",
        "Apify Google Maps search failed.",
        true,
      );
    }
  }
}

function parseApifyMapsResults(
  response: unknown,
  query: string,
): readonly SearchResultCandidate[] {
  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .map((item, index) => toSearchResult(item, index, query))
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

  const item = value as Record<string, unknown>;
  const title = stringValue(item.title);

  if (!title) {
    return undefined;
  }

  const rank = index + 1;

  return {
    provider: "apify_google_maps",
    title,
    url: mapsUrl(item, title),
    snippet: mapsSnippet(item),
    rank,
    query,
    confidence: Math.max(0.35, 0.9 - index * 0.05),
    metadata: {
      provider: "apify_google_maps",
      address: stringValue(item.address),
      phone: stringValue(item.phone),
      rating: numberValue(item.averageRating),
      place_id: stringValue(item.placeId),
    },
  };
}

function mapsSnippet(item: Record<string, unknown>): string | undefined {
  const parts = [
    stringValue(item.address),
    stringValue(item.phone) ? `tel: ${stringValue(item.phone)}` : undefined,
    numberValue(item.averageRating)
      ? `rating: ${numberValue(item.averageRating)}`
      : undefined,
    stringValue(item.description),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function mapsUrl(item: Record<string, unknown>, title: string): string {
  const rawUrl = stringValue(item.url) ?? stringValue(item.website);
  if (rawUrl) {
    return rawUrl;
  }

  const placeId = stringValue(item.placeId);
  if (placeId) {
    return `maps://placeid/${placeId}`;
  }

  const address = slug(stringValue(item.address) ?? "");
  return `maps://listing/${slug(title)}::${address}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

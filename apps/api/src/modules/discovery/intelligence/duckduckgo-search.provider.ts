import { Injectable } from "@nestjs/common";
import { externalProviderConfig } from "../../../common/config/external-provider.config";
import { ProviderError } from "../../../common/errors/provider-error";
import { getExternalJson } from "../../../common/http/external-http-client";
import { SearchProvider, SearchResultCandidate } from "./search-result.types";

@Injectable()
export class DuckDuckGoSearchProvider implements SearchProvider {
  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly SearchResultCandidate[]> {
    const config = externalProviderConfig();

    try {
      const url = new URL("https://api.duckduckgo.com/");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      url.searchParams.set("no_html", "1");
      url.searchParams.set("skip_disambig", "1");

      const response = await getExternalJson<unknown>(url.toString(), {
        timeoutMs: config.discoverySearchTimeoutMs,
        signal,
      });

      return parseDuckDuckGoResults(response, query);
    } catch (error) {
      throw new ProviderError(
        "DUCKDUCKGO_SEARCH_FAILED",
        "DuckDuckGo search failed.",
        true,
      );
    }
  }
}

function parseDuckDuckGoResults(
  response: unknown,
  query: string,
): readonly SearchResultCandidate[] {
  if (typeof response !== "object" || response === null) {
    return [];
  }

  const candidate = response as {
    readonly AbstractText?: unknown;
    readonly AbstractURL?: unknown;
    readonly Heading?: unknown;
    readonly RelatedTopics?: unknown;
  };
  const directResult = directDuckDuckGoResult(candidate, query);
  const relatedResults = Array.isArray(candidate.RelatedTopics)
    ? candidate.RelatedTopics.map((topic, index) =>
        relatedDuckDuckGoResult(topic, index + 2, query),
      ).filter(
        (result): result is SearchResultCandidate => result !== undefined,
      )
    : [];

  return directResult ? [directResult, ...relatedResults] : relatedResults;
}

function directDuckDuckGoResult(
  value: {
    readonly AbstractText?: unknown;
    readonly AbstractURL?: unknown;
    readonly Heading?: unknown;
  },
  query: string,
): SearchResultCandidate | undefined {
  if (typeof value.AbstractText !== "string") {
    return undefined;
  }

  return {
    provider: "duckduckgo",
    title: typeof value.Heading === "string" ? value.Heading : undefined,
    url: typeof value.AbstractURL === "string" ? value.AbstractURL : undefined,
    snippet: value.AbstractText,
    rank: 1,
    query,
    confidence: 0.6,
    metadata: { source: "abstract" },
  };
}

function relatedDuckDuckGoResult(
  value: unknown,
  rank: number,
  query: string,
): SearchResultCandidate | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const topic = value as {
    readonly FirstURL?: unknown;
    readonly Text?: unknown;
  };

  if (typeof topic.Text !== "string") {
    return undefined;
  }

  return {
    provider: "duckduckgo",
    url: typeof topic.FirstURL === "string" ? topic.FirstURL : undefined,
    snippet: topic.Text,
    rank,
    query,
    confidence: Math.max(0.2, 0.55 - (rank - 2) * 0.05),
    metadata: { source: "related_topic" },
  };
}

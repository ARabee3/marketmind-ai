import { Injectable } from "@nestjs/common";
import type {
  IntelligenceObservationCandidate,
  IntelligenceSourceCandidate,
} from "./intelligence.types";

export type ConsolidatedIntelligence = {
  readonly source_refs: readonly IntelligenceSourceCandidate[];
  readonly research_observations: readonly IntelligenceObservationCandidate[];
};

@Injectable()
export class IntelligenceSourceConsolidator {
  consolidate(
    sources: readonly IntelligenceSourceCandidate[],
    observations: readonly IntelligenceObservationCandidate[],
  ): ConsolidatedIntelligence {
    const consolidated: IntelligenceSourceCandidate[] = [];
    const indexByKey = new Map<string, number>();
    const remappedIndex = new Map<number, number>();

    sources.forEach((source, sourceIndex) => {
      const key = sourceKey(source, sourceIndex);
      const existingIndex = indexByKey.get(key);
      if (existingIndex === undefined) {
        remappedIndex.set(sourceIndex, consolidated.length);
        indexByKey.set(key, consolidated.length);
        consolidated.push(source);
        return;
      }

      remappedIndex.set(sourceIndex, existingIndex);
      const existing = consolidated[existingIndex];
      if (existing) {
        consolidated[existingIndex] = mergeSources(existing, source);
      }
    });

    return {
      source_refs: consolidated,
      research_observations: observations.map((observation) => ({
        ...observation,
        source_index:
          observation.source_index === undefined
            ? undefined
            : remappedIndex.get(observation.source_index),
      })),
    };
  }
}

function sourceKey(source: IntelligenceSourceCandidate, index: number): string {
  if (!source.url) {
    return `source:${index}`;
  }

  try {
    const url = new URL(source.url);
    url.hash = "";
    url.hostname = normalizedHost(url.hostname);
    if (url.hostname === "facebook.com") {
      url.search = "";
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return source.url.trim().toLowerCase();
  }
}

function normalizedHost(hostname: string): string {
  const host = hostname.toLowerCase();
  return ["www.facebook.com", "m.facebook.com", "mobile.facebook.com"].includes(
    host,
  )
    ? "facebook.com"
    : host;
}

function mergeSources(
  left: IntelligenceSourceCandidate,
  right: IntelligenceSourceCandidate,
): IntelligenceSourceCandidate {
  const owner =
    left.source_type === "owner_link"
      ? left
      : right.source_type === "owner_link"
        ? right
        : undefined;
  const accepted = left.status !== "discarded" || right.status !== "discarded";
  return {
    ...left,
    source_type: owner?.source_type ?? left.source_type,
    platform: owner?.platform ?? left.platform ?? right.platform,
    url: owner?.url ?? left.url ?? right.url,
    title: richerText(left.title, right.title),
    snippet: richerText(left.snippet, right.snippet),
    fetched_at: right.fetched_at ?? left.fetched_at,
    confidence: Math.max(left.confidence, right.confidence),
    metadata: { ...(left.metadata ?? {}), ...(right.metadata ?? {}) },
    status: accepted ? "accepted" : "discarded",
    discard_reason: accepted
      ? undefined
      : (right.discard_reason ?? left.discard_reason),
  };
}

function richerText(
  left: string | undefined,
  right: string | undefined,
): string | undefined {
  return (right?.length ?? 0) > (left?.length ?? 0) ? right : left;
}

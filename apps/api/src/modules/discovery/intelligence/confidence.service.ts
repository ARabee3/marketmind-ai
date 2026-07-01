import { Injectable } from "@nestjs/common";
import { normalizeArabic } from "../../../common/text/normalize-arabic";
import { StartDiscoveryDto } from "../dto/start-discovery.dto";
import { SearchResultCandidate } from "./search-result.types";

const MIN_ACCEPTED_CONFIDENCE = 0.45;

@Injectable()
export class ConfidenceService {
  score(dto: StartDiscoveryDto, result: SearchResultCandidate): number {
    const haystack = normalized([
      result.title,
      result.snippet,
      result.url,
    ]);
    const providerScore = Math.max(0, Math.min(result.confidence, 1)) * 0.25;
    const nameScore = includesAny(haystack, words(dto.intake.business_name))
      ? 0.25
      : 0;
    const typeScore = includesAny(haystack, words(dto.intake.business_type))
      ? 0.2
      : 0;
    const locationScore = locationMatches(
      haystack,
      dto.intake.area,
      dto.intake.city,
    );

    return roundConfidence(
      Math.min(1, providerScore + nameScore + typeScore + locationScore),
    );
  }

  discardReason(confidence: number): string | undefined {
    if (confidence >= MIN_ACCEPTED_CONFIDENCE) {
      return undefined;
    }

    return `Confidence ${confidence.toFixed(2)} below threshold ${MIN_ACCEPTED_CONFIDENCE.toFixed(2)}.`;
  }
}

function normalized(values: readonly (string | undefined)[]): string {
  return normalizeArabic(values.filter(Boolean).join(" ").toLowerCase());
}

function words(value: string): readonly string[] {
  return normalized([value])
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function locationMatches(
  haystack: string,
  area: string,
  city: string,
): number {
  const areaMatches = area.trim() ? haystack.includes(normalized([area])) : false;
  const cityMatches = city.trim() ? haystack.includes(normalized([city])) : false;

  if (areaMatches && cityMatches) {
    return 0.35;
  }
  if (areaMatches || cityMatches) {
    return 0.25;
  }
  return 0;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

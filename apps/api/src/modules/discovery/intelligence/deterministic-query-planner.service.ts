import { Injectable } from "@nestjs/common";
import {
  LanguageModeDto,
  PreparedDiscoveryIntakeDto,
  SocialPlatformDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import { PlannedSearchQuery, QueryPlan } from "./query-plan.types";

@Injectable()
export class DeterministicQueryPlannerService {
  plan(dto: StartDiscoveryDto): QueryPlan {
    const language = dto.language_mode ?? LanguageModeDto.Mixed;
    const intake = dto.intake;
    const queries: PlannedSearchQuery[] = [
      this.businessMatch(intake, language),
      this.competitors(intake, language),
      this.marketContext(intake, language),
      this.reviewPresence(intake, language),
      ...this.knownCompetitorQueries(intake, language),
      ...this.socialQueries(intake, language),
    ];

    return {
      source: "deterministic",
      queries,
    };
  }

  private businessMatch(
    intake: PreparedDiscoveryIntakeDto,
    language: LanguageModeDto,
  ): PlannedSearchQuery {
    return {
      intent: "business_match",
      query: quoted([
        intake.business_name,
        intake.business_type,
        locationText(intake),
      ]),
      language,
      priority: 100,
      provider_hints: ["serpapi", "duckduckgo"],
    };
  }

  private competitors(
    intake: PreparedDiscoveryIntakeDto,
    language: LanguageModeDto,
  ): PlannedSearchQuery {
    const location = locationText(intake);
    const query =
      language === LanguageModeDto.ArabicEgypt
        ? `أفضل ${intake.business_type} في ${location} منافسين`
        : `best ${intake.business_type} in ${location} competitors`;

    return {
      intent: "competitor_discovery",
      query,
      language,
      priority: 95,
      provider_hints: ["serpapi", "apify_google_maps", "duckduckgo"],
    };
  }

  private marketContext(
    intake: PreparedDiscoveryIntakeDto,
    language: LanguageModeDto,
  ): PlannedSearchQuery {
    const location = locationText(intake);
    const query =
      language === LanguageModeDto.ArabicEgypt
        ? `اتجاهات سوق ${intake.business_type} في ${location}`
        : `${intake.business_type} market trends in ${location}`;

    return {
      intent: "market_context",
      query,
      language,
      priority: 70,
      provider_hints: ["serpapi", "duckduckgo"],
    };
  }

  private reviewPresence(
    intake: PreparedDiscoveryIntakeDto,
    language: LanguageModeDto,
  ): PlannedSearchQuery {
    return {
      intent: "review_presence",
      query: `${quoted([intake.business_name, locationText(intake)])} reviews ratings`,
      language,
      priority: 85,
      provider_hints: ["serpapi", "apify_google_maps", "duckduckgo"],
    };
  }

  private knownCompetitorQueries(
    intake: PreparedDiscoveryIntakeDto,
    language: LanguageModeDto,
  ): readonly PlannedSearchQuery[] {
    return splitKnownCompetitors(intake.known_competitors_text).map(
      (competitor, index) => ({
        intent: "competitor_discovery",
        query: quoted([competitor, locationText(intake), intake.business_type]),
        language,
        priority: 90 - index,
        provider_hints: ["serpapi", "apify_google_maps", "duckduckgo"],
        metadata: { owner_provided_competitor: true },
      }),
    );
  }

  private socialQueries(
    intake: PreparedDiscoveryIntakeDto,
    language: LanguageModeDto,
  ): readonly PlannedSearchQuery[] {
    return (intake.social_links ?? []).map((link, index) => ({
      intent:
        link.platform === SocialPlatformDto.GoogleMaps
          ? "review_presence"
          : "social_profile",
      query: `${quoted([intake.business_name, locationText(intake)])} ${link.platform}`,
      language,
      priority: 80 - index,
      provider_hints:
        link.platform === SocialPlatformDto.GoogleMaps
          ? ["apify_google_maps", "serpapi"]
          : ["metadata", "serpapi"],
      metadata: {
        owner_provided_url: link.url,
        platform: link.platform,
      },
    }));
  }
}

function locationText(intake: PreparedDiscoveryIntakeDto): string {
  return [intake.area, intake.city].filter(Boolean).join(", ");
}

function quoted(parts: readonly string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => `"${part}"`)
    .join(" ");
}

function splitKnownCompetitors(value?: string): readonly string[] {
  return (value ?? "")
    .split(/[,،\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

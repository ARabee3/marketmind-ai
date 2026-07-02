import "reflect-metadata";
import {
  LanguageModeDto,
  SocialPlatformDto,
  StartDiscoveryDto,
} from "../dto/start-discovery.dto";
import { DeterministicQueryPlannerService } from "./deterministic-query-planner.service";

describe("DeterministicQueryPlannerService", () => {
  const service = new DeterministicQueryPlannerService();

  it("creates business, competitor, market, review, and social queries from intake", () => {
    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
        area: "Nasr City",
        known_competitors_text: "Tahrir Koshary, Zooba",
        social_links: [
          {
            platform: SocialPlatformDto.Instagram,
            url: "https://instagram.com/kosharycorner",
          },
          {
            platform: SocialPlatformDto.GoogleMaps,
            url: "https://maps.google.com/?cid=123",
          },
        ],
      },
    };

    const plan = service.plan(dto);

    expect(plan.source).toBe("deterministic");
    expect(plan.queries.map((query) => query.intent)).toEqual([
      "business_match",
      "competitor_discovery",
      "market_context",
      "review_presence",
      "competitor_discovery",
      "competitor_discovery",
      "social_profile",
      "review_presence",
    ]);
    expect(plan.queries[1]).toMatchObject({
      intent: "competitor_discovery",
      provider_hints: ["serpapi", "apify_google_maps", "duckduckgo"],
    });
    expect(plan.queries[4]).toMatchObject({
      query: '"Tahrir Koshary" "Nasr City, Cairo" "quick service restaurant"',
      metadata: { owner_provided_competitor: true },
    });
  });

  it("uses Arabic competitor and market wording when Arabic is requested", () => {
    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.ArabicEgypt,
      intake: {
        business_name: "مطعم النيل",
        business_type: "مطعم مشويات",
        city: "القاهرة",
        area: "مدينة نصر",
      },
    };

    const plan = service.plan(dto);

    expect(plan.queries[1]?.query).toBe(
      "أفضل مطعم مشويات في مدينة نصر, القاهرة منافسين",
    );
    expect(plan.queries[2]?.query).toBe(
      "اتجاهات سوق مطعم مشويات في مدينة نصر, القاهرة",
    );
  });
});

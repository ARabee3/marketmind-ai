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
      "social_profile",
      "social_profile",
      "competitor_discovery",
      "competitor_discovery",
    ]);
    expect(plan.queries[1]).toMatchObject({
      intent: "competitor_discovery",
      provider_hints: ["apify_google_maps", "serpapi", "duckduckgo"],
    });
    expect(plan.queries[6]).toMatchObject({
      query: '"Tahrir Koshary" "Nasr City, Cairo" "quick service restaurant"',
      metadata: { owner_provided_competitor: true },
      provider_hints: ["apify_google_maps", "serpapi", "duckduckgo"],
    });
    expect(plan.queries[7]).toMatchObject({
      query: '"Zooba" "Nasr City, Cairo" "quick service restaurant"',
      metadata: { owner_provided_competitor: true },
      provider_hints: ["apify_google_maps", "serpapi", "duckduckgo"],
    });
  });

  it("creates a social profile query when the only social link is Google Maps", () => {
    const dto: StartDiscoveryDto = {
      intake: {
        business_name: "Koshary Corner",
        business_type: "restaurant",
        city: "Cairo",
        social_links: [
          {
            platform: SocialPlatformDto.GoogleMaps,
            url: "https://maps.google.com/?cid=123",
          },
        ],
      },
    };

    const plan = service.plan(dto);

    expect(plan.queries.map((query) => query.intent)).toEqual([
      "business_match",
      "competitor_discovery",
      "market_context",
      "review_presence",
      "social_profile",
    ]);
    expect(plan.queries[4]).toMatchObject({
      query: '"Koshary Corner" "Cairo" google_maps',
      provider_hints: ["metadata", "serpapi"],
      metadata: {
        owner_provided_url: "https://maps.google.com/?cid=123",
        platform: SocialPlatformDto.GoogleMaps,
      },
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

  it("preserves required intents and social priority within the eight-query cap", () => {
    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.ArabicEgypt,
      intake: {
        business_name: "مطعم النيل",
        business_type: "مطعم مشويات",
        city: "القاهرة",
        area: "مدينة نصر",
        known_competitors_text:
          "المنافس الأول، المنافس الثاني, المنافس الثالث\nالمنافس الرابع،المنافس الخامس",
        social_links: [
          {
            platform: SocialPlatformDto.Facebook,
            url: "https://facebook.com/alnile",
          },
        ],
      },
    };

    const plan = service.plan(dto);
    const intents = plan.queries.map((query) => query.intent);
    const uniqueQueries = new Set(plan.queries.map((query) => query.query));

    expect(intents).toEqual([
      "business_match",
      "competitor_discovery",
      "market_context",
      "review_presence",
      "social_profile",
      "competitor_discovery",
      "competitor_discovery",
      "competitor_discovery",
    ]);
    expect(new Set(intents)).toEqual(
      new Set([
        "business_match",
        "competitor_discovery",
        "market_context",
        "review_presence",
        "social_profile",
      ]),
    );
    expect(plan.queries).toHaveLength(8);
    expect(uniqueQueries.size).toBe(plan.queries.length);
    expect(plan.queries[4]).toMatchObject({
      intent: "social_profile",
      provider_hints: ["metadata", "serpapi"],
      metadata: {
        owner_provided_url: "https://facebook.com/alnile",
        platform: SocialPlatformDto.Facebook,
      },
    });
    for (const query of plan.queries.filter(
      ({ intent }) =>
        intent !== "competitor_discovery" && intent !== "social_profile",
    )) {
      expect(query.provider_hints[0]).toBe("serpapi");
    }
  });

  it("removes duplicate competitor and social queries from malformed intake", () => {
    const dto: StartDiscoveryDto = {
      intake: {
        business_name: "Koshary Corner",
        business_type: "restaurant",
        city: "Cairo",
        area: "",
        known_competitors_text: "Zooba,, ZOOBA،\n; Tahrir ; TAHRIR",
        social_links: [
          {
            platform: SocialPlatformDto.Facebook,
            url: "https://facebook.com/kosharycorner",
          },
          {
            platform: SocialPlatformDto.Facebook,
            url: "https://facebook.com/kosharycorner",
          },
        ],
      },
    };

    const plan = service.plan(dto);

    expect(plan.queries.map((query) => query.query)).toEqual([
      '"Koshary Corner" "restaurant" "Cairo"',
      "best restaurant in Cairo competitors",
      "restaurant market trends in Cairo",
      '"Koshary Corner" "Cairo" reviews ratings',
      '"Koshary Corner" "Cairo" facebook',
      '"Zooba" "Cairo" "restaurant"',
      '"Tahrir" "Cairo" "restaurant"',
    ]);
  });
});

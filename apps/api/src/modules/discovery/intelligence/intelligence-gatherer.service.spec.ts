import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { ApifyMapsProvider } from "./apify-maps.provider";
import { DuckDuckGoSearchProvider } from "./duckduckgo-search.provider";
import { EvidenceTriageService } from "./evidence-triage.service";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence-gatherer.service";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";
import { SerpApiSearchProvider } from "./serpapi-search.provider";
import { SourceEnrichmentService } from "./source-enrichment.service";

describe("IntelligenceGathererService", () => {
  const queryPlanner = {
    plan: jest.fn(),
  } as unknown as jest.Mocked<QueryPlannerService>;
  const searchClient = {
    search: jest.fn(),
  } as unknown as jest.Mocked<SearchClientService>;
  const metadataExtractor = {
    extract: jest.fn(),
  } as unknown as jest.Mocked<MetadataExtractorService>;
  const sourceEnrichment = {
    enrich: jest.fn(),
  } as unknown as jest.Mocked<SourceEnrichmentService>;
  const evidenceTriage = {
    triage: jest.fn(),
  } as unknown as jest.Mocked<EvidenceTriageService>;
  const dto: StartDiscoveryDto = {
    language_mode: LanguageModeDto.Mixed,
    intake: {
      business_name: "Koshary Corner",
      business_type: "restaurant",
      city: "Cairo",
      area: "Nasr City",
    },
  };
  let service: IntelligenceGathererService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new IntelligenceGathererService(
      queryPlanner,
      searchClient,
      metadataExtractor,
      sourceEnrichment,
      evidenceTriage,
      new IntelligenceContractMapper(),
    );
    metadataExtractor.extract.mockResolvedValue({
      source_refs: [],
      research_observations: [],
    });
    sourceEnrichment.enrich.mockImplementation(async (results) => results);
    evidenceTriage.triage.mockResolvedValue({
      source_refs: [],
      research_observations: [],
      accepted_count: 0,
      discarded_count: 0,
    });
  });

  it("maps planned search results into contract-safe intelligence", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "competitor_discovery",
          query: "best restaurants in Nasr City competitors",
          language: LanguageModeDto.Mixed,
          priority: 95,
          provider_hints: ["serpapi"],
        },
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [
        {
          provider: "serpapi",
          title: "Nearby competitor",
          url: "https://example.com/competitor",
          snippet: "Popular restaurant in Nasr City.",
          rank: 1,
          query: "best restaurants in Nasr City competitors",
          confidence: 0.91,
        },
      ],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    } as never);
    evidenceTriage.triage.mockResolvedValue({
      source_refs: [
        {
          source_type: "search_result",
          platform: "serpapi",
          url: "https://example.com/competitor",
          title: "Nearby competitor",
          snippet: "Popular restaurant in Nasr City.",
          fetched_at: "2026-07-06T00:00:00.000Z",
          confidence: 0.91,
          status: "accepted",
          metadata: {
            provider: "serpapi",
            rank: 1,
            query: "best restaurants in Nasr City competitors",
            triage_source: "llm",
            evidence_tier: "confirmed_signal",
          },
        },
      ],
      research_observations: [
        {
          kind: "competitor",
          statement: "Popular restaurant in Nasr City.",
          source_index: 0,
          confidence: 0.91,
          visibility: "owner_visible",
          status: "accepted",
          metadata: {
            provider: "serpapi",
            rank: 1,
            query: "best restaurants in Nasr City competitors",
            triage_source: "llm",
            evidence_tier: "confirmed_signal",
          },
        },
      ],
      accepted_count: 1,
      discarded_count: 0,
    });

    const result = await service.gather(dto);

    expect(sourceEnrichment.enrich).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          url: "https://example.com/competitor",
        }),
      ],
      undefined,
    );
    expect(evidenceTriage.triage).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          expect.objectContaining({
            url: "https://example.com/competitor",
          }),
        ],
      }),
      undefined,
    );
    expect(result.status).toBe("complete");
    expect(result.search_mode).toBe("free_search");
    expect(result.source_refs[0]).toMatchObject({
      source_type: "search_result",
      platform: "serpapi",
      url: "https://example.com/competitor",
      metadata: {
        provider: "serpapi",
        rank: 1,
        query: "best restaurants in Nasr City competitors",
      },
    });
    expect(result.research_observations[0]).toMatchObject({
      source_ref_id: "source_ref_1",
      kind: "competitor",
      statement: "Popular restaurant in Nasr City.",
      visibility: "owner_visible",
      status: "accepted",
      metadata: expect.objectContaining({ triage_source: "llm" }),
    });
  });

  it("returns a knowledge gap when searches produce no results", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: "unknown business",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["duckduckgo"],
        },
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [],
      provider_warnings: [],
      provider_attempts: [
        { provider: "duckduckgo", outcome: "empty", result_count: 0 },
      ],
    } as never);

    const result = await service.gather(dto);

    expect(result.status).toBe("partial");
    expect(result.knowledge_gaps[0]).toMatchObject({
      field_key: "search_sources",
      status: "open",
    });
  });

  it("reports query planning, metadata, and search progress", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: "koshary cairo",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "empty", result_count: 0 },
      ],
    } as never);
    const progress = jest.fn().mockResolvedValue(undefined);

    await service.gather(dto, progress);

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "query_planning",
        status: "started",
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "metadata",
        status: "completed",
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "search",
        status: "completed",
        payload: expect.objectContaining({
          provider_attempts: [
            { provider: "serpapi", outcome: "empty", result_count: 0 },
          ],
          result_count: 0,
        }),
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "metadata",
        status: "completed",
        payload: expect.objectContaining({ phase: "source_enrichment" }),
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "filtering",
        status: "completed",
        payload: expect.objectContaining({ phase: "llm_triage" }),
      }),
    );
  });

  it("keeps owner link metadata before broad search results", async () => {
    metadataExtractor.extract.mockResolvedValue({
      source_refs: [
        {
          source_type: "owner_link",
          platform: "instagram",
          url: "https://instagram.com/kosharycorner",
          title: "Koshary Corner",
          confidence: 0.75,
          metadata: { owner_submitted: true },
        },
      ],
      research_observations: [
        {
          kind: "social_signal",
          statement: "Koshary Corner",
          source_index: 0,
          confidence: 0.75,
          visibility: "internal",
        },
      ],
    });
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [],
    });

    const result = await service.gather(dto);

    expect(result.search_mode).toBe("metadata_only");
    expect(result.source_refs[0]).toMatchObject({
      source_type: "owner_link",
      platform: "instagram",
    });
    expect(result.research_observations[0]).toMatchObject({
      source_ref_id: "source_ref_1",
      kind: "social_signal",
    });
  });

  it("returns safe provider failure when search providers fail", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: "koshary cairo",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    searchClient.search.mockRejectedValue(
      new ProviderError("SEARCH_FAILED", "Search provider failed.", true),
    );

    const result = await service.gather(dto);

    expect(result.status).toBe("failed");
    expect(result.search_mode).toBe("provider_later");
    expect(result.safe_error).toEqual({
      code: "SEARCH_FAILED",
      message: "Search provider failed.",
      retryable: true,
    });
  });

  it("fails when search throws the AI triage provider error code", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: "koshary cairo",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    searchClient.search.mockRejectedValue(
      new ProviderError(
        "AI_TRIAGE_PROVIDER_ERROR",
        "Search provider reused a triage code.",
        true,
      ),
    );

    const result = await service.gather(dto);

    expect(evidenceTriage.triage).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.search_mode).toBe("provider_later");
    expect(result.safe_error).toEqual({
      code: "AI_TRIAGE_PROVIDER_ERROR",
      message: "Search provider reused a triage code.",
      retryable: true,
    });
  });

  it("surfaces provider warnings when fallback has no results", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: "koshary cairo",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [],
      provider_warnings: [
        {
          code: "SERPAPI_SEARCH_FAILED",
          message: "SerpApi failed.",
          retryable: true,
        },
      ],
      provider_attempts: [
        {
          provider: "serpapi",
          outcome: "failed",
          result_count: 0,
          error_code: "SERPAPI_SEARCH_FAILED",
        },
      ],
    } as never);

    const result = await service.gather(dto);

    expect(result.status).toBe("failed");
    expect(result.safe_error).toEqual({
      code: "SERPAPI_SEARCH_FAILED",
      message: "SerpApi failed.",
      retryable: true,
    });
  });

  it("routes a five-intent Arabic plan across search providers", async () => {
    const serpApi = {
      search: jest.fn(),
    } as unknown as jest.Mocked<SerpApiSearchProvider>;
    const apifyMaps = {
      search: jest.fn(),
    } as unknown as jest.Mocked<ApifyMapsProvider>;
    const duckDuckGo = {
      search: jest.fn(),
    } as unknown as jest.Mocked<DuckDuckGoSearchProvider>;
    const realSearchClient = new SearchClientService(
      apifyMaps,
      serpApi,
      duckDuckGo,
    );
    const integrationService = new IntelligenceGathererService(
      queryPlanner,
      realSearchClient,
      metadataExtractor,
      sourceEnrichment,
      evidenceTriage,
      new IntelligenceContractMapper(),
    );
    const queries = [
      arabicPlanQuery("business_match", "مطعم كشري التحرير مدينة نصر", 100),
      arabicPlanQuery(
        "competitor_discovery",
        "أفضل مطاعم كشري في مدينة نصر منافسين",
        95,
        ["apify_google_maps", "serpapi"],
      ),
      arabicPlanQuery("review_presence", "تقييمات كشري التحرير مدينة نصر", 85),
      arabicPlanQuery("market_context", "اتجاهات سوق مطاعم الكشري في مدينة نصر", 70),
      arabicPlanQuery("social_profile", "كشري التحرير مدينة نصر Instagram", 60),
    ];
    queryPlanner.plan.mockResolvedValue({ source: "llm", queries });
    const intentByQuery = new Map(queries.map((query) => [query.query, query.intent]));
    serpApi.search.mockImplementation(async (query) => {
      const intent = intentByQuery.get(query);
      if (!intent || intent === "competitor_discovery") {
        throw new Error(`Unexpected SerpApi query: ${query}`);
      }
      return [
        {
          provider: "serpapi",
          title: `نتيجة ممثلة: ${intent}`,
          url: `https://example.com/${intent}`,
          snippet: `دليل عام عن ${query}`,
          rank: 1,
          query,
          confidence: 0.8,
          metadata: { representative_intent: intent },
        },
      ];
    });
    apifyMaps.search.mockImplementation(async (query) => [
      {
        provider: "apify_google_maps",
        title: "منافس محلي",
        url: "maps://placeid/competitor",
        snippet: "مطعم كشري في مدينة نصر",
        rank: 1,
        query,
        confidence: 0.9,
      },
    ]);
    sourceEnrichment.enrich.mockImplementation(async (results) =>
      results.map((result) => ({
        ...result,
        metadata: { ...result.metadata, enriched: true },
      })),
    );
    evidenceTriage.triage.mockImplementation(
      async ({ intent, results, sourceStartIndex }) => {
        const candidate = results[0];
        if (!candidate) {
          return {
            source_refs: [],
            research_observations: [],
            accepted_count: 0,
            discarded_count: 0,
          };
        }
        const classification =
          intent === "competitor_discovery"
            ? "competitor"
            : intent === "market_context"
              ? "market_context"
              : intent === "social_profile"
                ? "social_signal"
                : "own_business";
        const kind =
          classification === "competitor"
            ? "competitor"
            : classification === "market_context"
              ? "market_context"
              : classification === "social_signal"
                ? "social_signal"
                : "digital_presence";
        const evidenceTier =
          intent === "social_profile" ? "needs_confirmation" : "confirmed_signal";
        const metadata = {
          triage_source: "llm",
          provider: candidate.provider,
          intent,
          enriched: candidate.metadata?.enriched === true,
          evidence_tier: evidenceTier,
          classification,
        };
        return {
          source_refs: [
            {
              source_type: "search_result",
              platform: candidate.provider,
              url: candidate.url,
              title: candidate.title,
              snippet: candidate.snippet,
              confidence: candidate.confidence,
              status: "accepted",
              metadata,
            },
          ],
          research_observations: [
            {
              kind,
              statement: candidate.snippet ?? candidate.title ?? candidate.query,
              source_index: sourceStartIndex,
              confidence: candidate.confidence,
              status: "accepted",
              metadata,
            },
          ],
          accepted_count: 1,
          discarded_count: 0,
        };
      },
    );
    const progress = jest.fn().mockResolvedValue(undefined);
    const arabicDto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.ArabicEgypt,
      intake: {
        business_name: "كشري التحرير",
        business_type: "مطعم",
        city: "القاهرة",
        area: "مدينة نصر",
      },
    };

    const result = await integrationService.gather(arabicDto, progress);

    expect(serpApi.search).toHaveBeenCalledTimes(4);
    expect(apifyMaps.search).toHaveBeenCalledTimes(1);
    expect(duckDuckGo.search).not.toHaveBeenCalled();
    expect(sourceEnrichment.enrich).toHaveBeenCalledTimes(5);
    expect(evidenceTriage.triage).toHaveBeenCalledTimes(5);
    expect(
      evidenceTriage.triage.mock.calls.every(([input]) =>
        input.results.every((candidate) => candidate.metadata?.enriched === true),
      ),
    ).toBe(true);
    const intents = [
      "business_match",
      "competitor_discovery",
      "review_presence",
      "market_context",
      "social_profile",
    ] as const;
    for (const intent of intents) {
      const provider = intent === "competitor_discovery" ? "apify_google_maps" : "serpapi";
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: intent === "competitor_discovery" ? "competitor_searching" : "search",
          status: "completed",
          payload: expect.objectContaining({
            intent,
            provider_attempts: [
              { provider, outcome: "succeeded", result_count: 1 },
            ],
          }),
        }),
      );
    }
    expect(result.status).toBe("complete");
    expect(new Set(result.source_refs.map((source) => source.platform))).toEqual(
      new Set(["serpapi", "apify_google_maps"]),
    );
    expect(new Set(result.source_refs.map((source) => source.metadata?.intent))).toEqual(
      new Set(intents),
    );
    expect(
      new Set(result.research_observations.map((observation) => observation.metadata?.intent)),
    ).toEqual(new Set(intents));
    expect(result.research_observations).toHaveLength(5);
    expect(result.research_observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "competitor",
          metadata: expect.objectContaining({ intent: "competitor_discovery" }),
        }),
        expect.objectContaining({
          kind: "market_context",
          metadata: expect.objectContaining({ intent: "market_context" }),
        }),
        expect.objectContaining({
          kind: "social_signal",
          status: "accepted",
          metadata: expect.objectContaining({
            intent: "social_profile",
            evidence_tier: "needs_confirmation",
          }),
        }),
      ]),
    );
  });

  it("reports an AI triage timeout without fabricating search observations", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "llm",
      queries: [
        arabicPlanQuery("business_match", "مطعم كشري التحرير مدينة نصر", 100),
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [
        {
          provider: "serpapi",
          title: "Koshary Corner result",
          url: "https://example.com/search-result",
          snippet: "A successful public search result.",
          rank: 1,
          query: "مطعم كشري التحرير مدينة نصر",
          confidence: 0.9,
        },
      ],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    } as never);
    sourceEnrichment.enrich.mockResolvedValue([
      {
        provider: "serpapi",
        title: "Koshary Corner result",
        url: "https://example.com/search-result",
        snippet: "An enriched public search result.",
        rank: 1,
        query: "مطعم كشري التحرير مدينة نصر",
        confidence: 0.9,
      },
    ]);
    evidenceTriage.triage.mockRejectedValue(
      new ProviderError("AI_TRIAGE_TIMEOUT", "AI triage timed out.", true),
    );
    const progress = jest.fn().mockResolvedValue(undefined);

    const result = await service.gather(dto, progress);

    expect(evidenceTriage.triage).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "business_match",
        results: [
          expect.objectContaining({
            url: "https://example.com/search-result",
            snippet: "An enriched public search result.",
          }),
        ],
      }),
      undefined,
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "search",
        status: "completed",
        payload: expect.objectContaining({
          intent: "business_match",
          provider_attempts: [
            { provider: "serpapi", outcome: "succeeded", result_count: 1 },
          ],
          result_count: 1,
        }),
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "filtering",
        status: "failed",
        payload: {
          intent: "business_match",
          phase: "llm_triage",
          error_code: "AI_TRIAGE_TIMEOUT",
          provider_attempts: [
            { provider: "serpapi", outcome: "succeeded", result_count: 1 },
          ],
          result_count: 1,
        },
      }),
    );
    expect(result.status).toBe("partial");
    expect(result.safe_error).toEqual({
      code: "AI_TRIAGE_PROVIDER_ERROR",
      message: "AI triage timed out.",
      retryable: true,
    });
    expect(result.source_refs).toEqual([]);
    expect(result.research_observations).toEqual([]);
  });

  it("runs only the top eight planned queries", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "llm",
      queries: [
        arabicPlanQuery("business_match", "بحث 1", 100),
        arabicPlanQuery("competitor_discovery", "بحث 2", 90),
        arabicPlanQuery("review_presence", "بحث 3", 80),
        arabicPlanQuery("market_context", "بحث 4", 70),
        arabicPlanQuery("social_profile", "بحث 5", 60),
        arabicPlanQuery("business_match", "بحث 6", 50),
        arabicPlanQuery("competitor_discovery", "بحث 7", 40),
        arabicPlanQuery("review_presence", "بحث 8", 30),
        arabicPlanQuery("market_context", "بحث 9", 20),
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "empty", result_count: 0 },
      ],
    } as never);

    await service.gather(dto);

    expect(searchClient.search.mock.calls.map(([query]) => query)).toEqual([
      "بحث 1",
      "بحث 2",
      "بحث 3",
      "بحث 4",
      "بحث 5",
      "بحث 6",
      "بحث 7",
      "بحث 8",
    ]);
  });
});

function arabicPlanQuery(
  intent:
    | "business_match"
    | "competitor_discovery"
    | "review_presence"
    | "market_context"
    | "social_profile",
  query: string,
  priority: number,
  provider_hints:
    | readonly ["serpapi"]
    | readonly ["serpapi", "duckduckgo"]
    | readonly ["apify_google_maps", "serpapi"] = ["serpapi"],
) {
  return {
    intent,
    query,
    language: LanguageModeDto.ArabicEgypt,
    priority,
    provider_hints,
  };
}

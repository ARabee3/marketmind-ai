import "reflect-metadata";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { ConfidenceService } from "./confidence.service";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence-gatherer.service";
import { MatchFilterService } from "./match-filter.service";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";

describe("IntelligenceGathererService filtering", () => {
  const queryPlanner = {
    plan: jest.fn(),
  } as unknown as jest.Mocked<QueryPlannerService>;
  const searchClient = {
    search: jest.fn(),
  } as unknown as jest.Mocked<SearchClientService>;
  const metadataExtractor = {
    extract: jest.fn(),
  } as unknown as jest.Mocked<MetadataExtractorService>;
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
      new MatchFilterService(new ConfidenceService()),
      new IntelligenceContractMapper(),
    );
    metadataExtractor.extract.mockResolvedValue({
      source_refs: [],
      research_observations: [],
    });
  });

  it("reports competitor and filtering progress for competitor research", async () => {
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
          title: "Nearby restaurant",
          url: "https://example.com/nearby",
          snippet: "Popular restaurant in Nasr City Cairo.",
          rank: 1,
          query: "best restaurants in Nasr City competitors",
          confidence: 0.9,
        },
      ],
      provider_warnings: [],
    } as never);
    const progress = jest.fn().mockResolvedValue(undefined);

    await service.gather(dto, progress);

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "competitor_searching",
        status: "completed",
        payload: expect.objectContaining({ result_count: 1 }),
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "filtering",
        status: "completed",
        payload: expect.objectContaining({
          accepted_count: 1,
          discarded_count: 0,
        }),
      }),
    );
  });

  it("marks unrelated search results as discarded observations", async () => {
    queryPlanner.plan.mockResolvedValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: "Koshary Corner Nasr City",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [
        {
          provider: "serpapi",
          title: "Italian hotel in Dubai",
          url: "https://example.com/dubai-hotel",
          snippet: "Luxury hotel in Dubai.",
          rank: 1,
          query: "Koshary Corner Nasr City",
          confidence: 0.9,
        },
      ],
      provider_warnings: [],
    } as never);

    const result = await service.gather(dto);

    expect(result.status).toBe("partial");
    expect(result.research_observations[0]).toMatchObject({
      status: "discarded",
      discard_reason: expect.any(String),
    });
  });
});

import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence-gatherer.service";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";

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
      new IntelligenceContractMapper(),
    );
    metadataExtractor.extract.mockResolvedValue({
      source_refs: [],
      research_observations: [],
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
    searchClient.search.mockResolvedValue([
      {
        provider: "serpapi",
        title: "Nearby competitor",
        url: "https://example.com/competitor",
        snippet: "Popular restaurant in Nasr City.",
        rank: 1,
        query: "best restaurants in Nasr City competitors",
        confidence: 0.91,
      },
    ]);

    const result = await service.gather(dto);

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
    searchClient.search.mockResolvedValue([]);

    const result = await service.gather(dto);

    expect(result.status).toBe("partial");
    expect(result.knowledge_gaps[0]).toMatchObject({
      field_key: "search_sources",
      status: "open",
    });
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
});

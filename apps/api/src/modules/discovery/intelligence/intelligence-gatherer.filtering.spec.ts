import "reflect-metadata";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { EvidenceTriageService } from "./evidence-triage.service";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence-gatherer.service";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";
import { SourceEnrichmentService } from "./source-enrichment.service";

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
      provider_attempts: [
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    } as never);
    evidenceTriage.triage.mockResolvedValue({
      source_refs: [
        {
          source_type: "search_result",
          platform: "serpapi",
          title: "Nearby restaurant",
          url: "https://example.com/nearby",
          snippet: "Popular restaurant in Nasr City Cairo.",
          fetched_at: "2026-07-06T00:00:00.000Z",
          confidence: 0.9,
          status: "accepted",
          metadata: { triage_source: "llm" },
        },
      ],
      research_observations: [
        {
          kind: "competitor",
          statement: "Popular restaurant in Nasr City Cairo.",
          source_index: 0,
          confidence: 0.9,
          visibility: "owner_visible",
          status: "accepted",
          metadata: { triage_source: "llm" },
        },
      ],
      accepted_count: 1,
      discarded_count: 0,
    });
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
          phase: "llm_triage",
          accepted_count: 1,
          discarded_count: 0,
        }),
      }),
    );
  });

  it("uses LLM triage decisions for discarded observations", async () => {
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
      provider_attempts: [
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    } as never);
    evidenceTriage.triage.mockResolvedValue({
      source_refs: [
        {
          source_type: "search_result",
          platform: "serpapi",
          title: "Italian hotel in Dubai",
          url: "https://example.com/dubai-hotel",
          snippet: "Luxury hotel in Dubai.",
          fetched_at: "2026-07-06T00:00:00.000Z",
          confidence: 0.1,
          status: "discarded",
          metadata: {
            triage_source: "llm",
            evidence_tier: "discarded",
          },
        },
      ],
      research_observations: [
        {
          kind: "metadata",
          statement: "Luxury hotel in Dubai.",
          source_index: 0,
          confidence: 0.1,
          visibility: "internal",
          status: "discarded",
          discard_reason: "Unrelated city and business type.",
          metadata: {
            triage_source: "llm",
            evidence_tier: "discarded",
          },
        },
      ],
      accepted_count: 0,
      discarded_count: 1,
    });

    const result = await service.gather(dto);

    expect(result.status).toBe("partial");
    expect(result.research_observations[0]).toMatchObject({
      status: "discarded",
      discard_reason: "Unrelated city and business type.",
      metadata: expect.objectContaining({ triage_source: "llm" }),
    });
  });
});

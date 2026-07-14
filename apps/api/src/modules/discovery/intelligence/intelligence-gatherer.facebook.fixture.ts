import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { EvidenceTriageService } from "./evidence-triage.service";
import { FacebookIntelligenceService } from "./facebook-intelligence.service";
import { IntelligenceContractMapper } from "./intelligence-contract.mapper";
import { IntelligenceGathererService } from "./intelligence-gatherer.service";
import { IntelligenceSourceConsolidator } from "./intelligence-source.consolidator";
import { MetadataExtractorService } from "./metadata-extractor.service";
import { QueryPlannerService } from "./query-planner.service";
import { SearchClientService } from "./search-client.service";
import { SocialEnrichmentService } from "./social-enrichment.service";
import { SourceEnrichmentService } from "./source-enrichment.service";

export function createFacebookGathererFixture() {
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
  const socialEnrichment = {
    isEnabledFor: jest.fn(),
    enrich: jest.fn(),
  } as unknown as jest.Mocked<SocialEnrichmentService>;
  const dto: StartDiscoveryDto = {
    language_mode: LanguageModeDto.ArabicEgypt,
    intake: {
      business_name: "قصر نابولي",
      business_type: "محل حلويات",
      city: "أسيوط",
      social_links: [
        {
          platform: "facebook" as never,
          url: "https://facebook.com/kasrnapoly",
        },
      ],
    },
  };

  function reset(): void {
    jest.resetAllMocks();
    queryPlanner.plan.mockResolvedValue({
      source: "llm",
      queries: [
        {
          intent: "business_match",
          query: "قصر نابولي حلويات أسيوط",
          language: LanguageModeDto.ArabicEgypt,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    metadataExtractor.extract.mockResolvedValue({
      source_refs: [
        {
          source_type: "owner_link",
          platform: "facebook",
          url: "https://facebook.com/kasrnapoly",
          confidence: 0.45,
          metadata: { owner_submitted: true },
        },
      ],
      research_observations: [
        {
          kind: "social_signal",
          statement: "Owner submitted Facebook link",
          source_index: 0,
          confidence: 0.45,
        },
      ],
    });
    searchClient.search.mockResolvedValue({
      results: [
        {
          provider: "serpapi",
          title: "قصر نابولي",
          url: "https://example.com/kasr-napoly",
          rank: 1,
          query: "قصر نابولي حلويات أسيوط",
          confidence: 0.8,
        },
      ],
      provider_warnings: [],
      provider_attempts: [
        { provider: "serpapi", outcome: "succeeded", result_count: 1 },
      ],
    });
    sourceEnrichment.enrich.mockImplementation(async (results) => results);
    socialEnrichment.isEnabledFor.mockReturnValue(true);
    socialEnrichment.enrich.mockResolvedValue({
      candidates: [facebookPageCandidate()],
      provider_warnings: [],
      provider_attempts: [facebookPageAttempt()],
    });
    evidenceTriage.triage.mockImplementation(async (input) => {
      const result = input.results[0]!;
      const isFacebook = input.intent === "social_profile";
      return {
        source_refs: [
          {
            source_type: "search_result",
            platform: result.provider,
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            confidence: 0.9,
            status: "accepted",
            metadata: result.metadata,
          },
        ],
        research_observations: [
          {
            kind: isFacebook ? "social_signal" : "digital_presence",
            statement: isFacebook
              ? "صفحة النشاط تعرض حلويات ومخبوزات"
              : "Business result",
            source_index: input.sourceStartIndex,
            confidence: 0.9,
            status: "accepted",
          },
        ],
        accepted_count: 1,
        discarded_count: 0,
      };
    });
  }

  function createService(): IntelligenceGathererService {
    return new IntelligenceGathererService(
      queryPlanner,
      searchClient,
      metadataExtractor,
      sourceEnrichment,
      evidenceTriage,
      new IntelligenceContractMapper(),
      new FacebookIntelligenceService(socialEnrichment, evidenceTriage),
      new IntelligenceSourceConsolidator(),
    );
  }

  return {
    dto,
    evidenceTriage,
    searchClient,
    socialEnrichment,
    reset,
    createService,
  };
}

export function facebookPageCandidate() {
  return {
    provider: "apify_facebook_pages" as const,
    title: "قصر نابولي",
    url: "https://facebook.com/kasrnapoly",
    snippet: "حلويات ومخبوزات في أسيوط",
    rank: 1,
    query: "owner submitted Facebook Page",
    confidence: 0.8,
    metadata: { followers_count: 8500 },
  };
}

export function facebookPageAttempt() {
  return {
    provider: "apify_facebook_pages" as const,
    outcome: "succeeded" as const,
    result_count: 1,
    duration_ms: 20,
  };
}

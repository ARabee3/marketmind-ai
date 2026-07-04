import "reflect-metadata";
import { IntelligenceResult } from "../discovery-state";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import {
  emptyDiscoveryDomainScores,
  emptyMarketAwareBusinessFacts,
} from "../market-profile";
import { AiDiscoveryClient } from "./ai-discovery.client";

describe("AiDiscoveryClient", () => {
  const originalEnv = process.env;
  const fetchMock = jest.spyOn(global, "fetch");
  const dto: StartDiscoveryDto = {
    language_mode: LanguageModeDto.Mixed,
    intake: {
      business_name: "Koshary Corner",
      business_type: "restaurant",
      city: "Cairo",
    },
  };
  const intelligence: IntelligenceResult = {
    status: "complete",
    search_mode: "free_search",
    source_refs: [],
    research_observations: [],
    conversation_hooks: [],
    knowledge_gaps: [],
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AI_SERVICE_BASE_URL: "http://ai-service",
      DISCOVERY_SEARCH_TIMEOUT_MS: "8000",
    };
    fetchMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  it("posts discovery start requests to the internal AI discovery endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        action: "ask_next_question",
        next_question: "Who are your best current customers?",
        updated_known_facts: emptyMarketAwareBusinessFacts(),
        updated_uncertainties: [],
        research_observations: [],
        source_refs: [],
        domain_scores: emptyDiscoveryDomainScores(),
        ready_to_summarize: false,
      }),
    } as Response);

    const result = await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(result).toEqual({
      action: "ask_next_question",
      next_question: "Who are your best current customers?",
      updated_known_facts: emptyMarketAwareBusinessFacts(),
      updated_uncertainties: [],
      research_observations: [],
      source_refs: [],
      domain_scores: emptyDiscoveryDomainScores(),
      ready_to_summarize: false,
      profile_draft: undefined,
      safe_error: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-service/internal/v1/ai/discovery/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "11111111-1111-4111-8111-111111111111",
          language_mode: LanguageModeDto.Mixed,
          intake: dto.intake,
          intelligence,
        }),
      }),
    );
  });

  it("uses the dedicated AI request timeout", async () => {
    process.env.DISCOVERY_SEARCH_TIMEOUT_MS = "1";
    process.env.AI_REQUEST_TIMEOUT_MS = "30000";
    const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        action: "ask_next_question",
        next_question: "Who are your best current customers?",
        updated_known_facts: emptyMarketAwareBusinessFacts(),
        updated_uncertainties: [],
        research_observations: [],
        source_refs: [],
        domain_scores: emptyDiscoveryDomainScores(),
        ready_to_summarize: false,
      }),
    } as Response);

    await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(timeoutSpy).toHaveBeenCalledWith(30000);
    timeoutSpy.mockRestore();
  });

  it("preserves AI discovery source and observation arrays", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        action: "ask_next_question",
        next_question: "Who buys most often?",
        updated_known_facts: emptyMarketAwareBusinessFacts(),
        updated_uncertainties: [],
        research_observations: [
          {
            id: "observation_1",
            source_ref_id: "source_ref_1",
            kind: "digital_presence",
            statement: "Koshary Corner has public search presence.",
            confidence: 0.8,
            visibility: "internal",
            status: "accepted",
            metadata: {},
          },
        ],
        source_refs: [
          {
            id: "source_ref_1",
            source_type: "search_result",
            platform: "serpapi",
            url: "https://example.com/koshary",
            confidence: 0.8,
            metadata: {},
          },
        ],
        domain_scores: emptyDiscoveryDomainScores(),
        ready_to_summarize: false,
      }),
    } as Response);

    const result = await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(result.source_refs).toHaveLength(1);
    expect(result.research_observations).toHaveLength(1);
    expect(result.research_observations[0]?.source_ref_id).toBe("source_ref_1");
  });
});

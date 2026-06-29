import "reflect-metadata";
import { IntelligenceResult } from "../discovery-state";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
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
        updated_known_facts: {},
        updated_uncertainties: [],
        research_observations: [],
        source_refs: [],
        domain_scores: {},
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
      updated_known_facts: {},
      updated_uncertainties: [],
      research_observations: [],
      source_refs: [],
      domain_scores: {},
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
});

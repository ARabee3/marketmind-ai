import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
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
      AI_PROVIDER_RETRY_DELAY_MS: "1",
      DISCOVERY_SEARCH_TIMEOUT_MS: "8000",
    };
    fetchMock.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
    fetchMock.mockRestore();
  });

  it("posts discovery start requests to the internal AI discovery endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        action: "ask_next_question",
        next_question: "Who are your best current customers?",
        updated_known_facts: emptyMarketAwareBusinessFacts(),
        updated_uncertainties: [],
        research_observations: [],
        source_refs: [],
        domain_scores: emptyDiscoveryDomainScores(),
        ready_to_summarize: false,
      }),
    );

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
    fetchMock.mockResolvedValue(
      jsonResponse({
        action: "ask_next_question",
        next_question: "Who are your best current customers?",
        updated_known_facts: emptyMarketAwareBusinessFacts(),
        updated_uncertainties: [],
        research_observations: [],
        source_refs: [],
        domain_scores: emptyDiscoveryDomainScores(),
        ready_to_summarize: false,
      }),
    );

    await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(timeoutSpy).toHaveBeenCalledWith(30000);
    timeoutSpy.mockRestore();
  });

  it("preserves AI discovery source and observation arrays", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
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
    );

    const result = await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(result.source_refs).toHaveLength(1);
    expect(result.research_observations).toHaveLength(1);
    expect(result.research_observations[0]?.source_ref_id).toBe("source_ref_1");
  });

  it("retries a transient discovery provider failure once", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        jsonResponse({
          action: "ask_next_question",
          next_question: "مين أكتر ناس بتشتري من قصر نابولي؟",
          updated_known_facts: emptyMarketAwareBusinessFacts(),
          updated_uncertainties: [],
          research_observations: [],
          source_refs: [],
          domain_scores: emptyDiscoveryDomainScores(),
          ready_to_summarize: false,
        }),
      );

    const result = await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(result.next_question).toBe("مين أكتر ناس بتشتري من قصر نابولي؟");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable discovery errors", async () => {
    fetchMock.mockRejectedValue(
      new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      ),
    );

    await expect(
      new AiDiscoveryClient().start(
        "11111111-1111-4111-8111-111111111111",
        dto,
        intelligence,
      ),
    ).rejects.toEqual(
      new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries retryable discovery safe errors before returning success", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          action: "safe_failure",
          next_question: null,
          updated_known_facts: emptyMarketAwareBusinessFacts(),
          updated_uncertainties: [],
          research_observations: [],
          source_refs: [],
          domain_scores: emptyDiscoveryDomainScores(),
          ready_to_summarize: false,
          safe_error: {
            code: "AI_PROVIDER_FAILURE",
            message: "Gemini provider call failed.",
            retryable: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          action: "safe_failure",
          next_question: null,
          updated_known_facts: emptyMarketAwareBusinessFacts(),
          updated_uncertainties: [],
          research_observations: [],
          source_refs: [],
          domain_scores: emptyDiscoveryDomainScores(),
          ready_to_summarize: false,
          safe_error: {
            code: "AI_PROVIDER_FAILURE",
            message: "Gemini provider call failed.",
            retryable: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          action: "ask_next_question",
          next_question: "إيه أكتر منتج حلويات بيطلبه عملاء قصر نابولي؟",
          updated_known_facts: emptyMarketAwareBusinessFacts(),
          updated_uncertainties: [],
          research_observations: [],
          source_refs: [],
          domain_scores: emptyDiscoveryDomainScores(),
          ready_to_summarize: false,
        }),
      );

    const result = await new AiDiscoveryClient().start(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );

    expect(result.next_question).toBe(
      "إيه أكتر منتج حلويات بيطلبه عملاء قصر نابولي؟",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

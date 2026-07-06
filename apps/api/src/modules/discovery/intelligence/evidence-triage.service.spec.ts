import "reflect-metadata";
import { AiEvidenceTriageClient } from "../ai-client/ai-evidence-triage.client";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { EvidenceTriageService } from "./evidence-triage.service";

describe("EvidenceTriageService", () => {
  const aiClient = {
    triage: jest.fn(),
  } as unknown as jest.Mocked<AiEvidenceTriageClient>;
  const dto: StartDiscoveryDto = {
    language_mode: LanguageModeDto.Mixed,
    intake: {
      business_name: "Koshary Corner",
      business_type: "restaurant",
      city: "Cairo",
      area: "Nasr City",
    },
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("maps LLM confirmed competitor decisions into accepted observations", async () => {
    aiClient.triage.mockResolvedValue({
      source: "llm",
      decisions: [
        {
          index: 0,
          classification: "competitor",
          evidence_tier: "confirmed_signal",
          confidence: 0.88,
          reason: "This is a local restaurant competitor.",
          candidate_facts: { rating: "4.5" },
        },
      ],
    });

    const result = await new EvidenceTriageService(aiClient).triage({
      dto,
      intent: "competitor_discovery",
      sourceStartIndex: 2,
      results: [
        {
          provider: "apify_google_maps",
          title: "Nearby restaurant",
          url: "maps://placeid/1",
          snippet: "Nasr City · rating: 4.5",
          rank: 1,
          query: "best restaurants in Nasr City",
          confidence: 0.9,
          metadata: { rating: 4.5, nested: { ignored: true } },
        },
      ],
    });

    expect(aiClient.triage).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          expect.objectContaining({
            provider: "apify_google_maps",
            metadata: { rating: 4.5 },
          }),
        ],
      }),
      undefined,
    );
    expect(result.accepted_count).toBe(1);
    expect(result.source_refs[0]).toMatchObject({
      confidence: 0.88,
      status: "accepted",
      metadata: expect.objectContaining({
        triage_source: "llm",
        evidence_tier: "confirmed_signal",
        classification: "competitor",
      }),
    });
    expect(result.research_observations[0]).toMatchObject({
      kind: "competitor",
      source_index: 2,
      status: "accepted",
      visibility: "owner_visible",
    });
  });

  it("uses LLM discarded decisions without deterministic fallback", async () => {
    aiClient.triage.mockResolvedValue({
      source: "llm",
      decisions: [
        {
          index: 0,
          classification: "irrelevant",
          evidence_tier: "discarded",
          confidence: 0.05,
          reason: "Different city and business type.",
          candidate_facts: {},
        },
      ],
    });

    const result = await new EvidenceTriageService(aiClient).triage({
      dto,
      intent: "business_match",
      sourceStartIndex: 0,
      results: [
        {
          provider: "serpapi",
          title: "Dubai hotel",
          snippet: "Luxury hotel in Dubai.",
          rank: 1,
          query: "Koshary Corner Nasr City",
          confidence: 0.95,
        },
      ],
    });

    expect(result.accepted_count).toBe(0);
    expect(result.discarded_count).toBe(1);
    expect(result.research_observations[0]).toMatchObject({
      status: "discarded",
      discard_reason: "Different city and business type.",
      metadata: expect.objectContaining({ triage_source: "llm" }),
    });
  });
});

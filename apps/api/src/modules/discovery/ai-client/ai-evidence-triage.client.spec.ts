import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
import { LanguageModeDto } from "../dto/start-discovery.dto";
import { AiEvidenceTriageClient } from "./ai-evidence-triage.client";

describe("AiEvidenceTriageClient", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = fetchMock;
    process.env.AI_SERVICE_BASE_URL = "http://ai-service";
    process.env.AI_PROVIDER_RETRY_DELAY_MS = "1";
    process.env.DISCOVERY_TRIAGE_TIMEOUT_MS = "120000";
  });

  afterEach(() => {
    delete process.env.AI_SERVICE_BASE_URL;
    delete process.env.AI_PROVIDER_RETRY_DELAY_MS;
    delete process.env.DISCOVERY_TRIAGE_TIMEOUT_MS;
  });

  it("calls the evidence triage endpoint with the dedicated timeout", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        source: "llm",
        decisions: [
          {
            index: 0,
            classification: "competitor",
            evidence_tier: "confirmed_signal",
            confidence: 0.9,
            reason: "Local restaurant competitor.",
            candidate_facts: {},
          },
        ],
      }),
    } as Response);

    const result = await new AiEvidenceTriageClient().triage({
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "restaurant",
        city: "Cairo",
        area: "Nasr City",
      },
      candidates: [
        {
          index: 0,
          intent: "competitor_discovery",
          provider: "serpapi",
          title: "Nearby restaurant",
          query: "best restaurants",
          rank: 1,
          provider_confidence: 0.9,
          metadata: {},
        },
      ],
    });

    expect(result.decisions[0]).toMatchObject({
      classification: "competitor",
      evidence_tier: "confirmed_signal",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-service/internal/v1/ai/search/evidence-triage",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reports triage timeout distinctly", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    await expect(
      new AiEvidenceTriageClient().triage({
        language_mode: LanguageModeDto.Mixed,
        intake: {
          business_name: "Koshary Corner",
          business_type: "restaurant",
          city: "Cairo",
          area: "Nasr City",
        },
        candidates: [
          {
            index: 0,
            intent: "competitor_discovery",
            provider: "serpapi",
            query: "best restaurants",
            rank: 1,
            provider_confidence: 0.9,
            metadata: {},
          },
        ],
      }),
    ).rejects.toEqual(
      new ProviderError(
        "AI_TRIAGE_TIMEOUT",
        "AI evidence triage timed out after 120000ms.",
        true,
      ),
    );
  });

  it("retries a transient triage provider failure once", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          source: "llm",
          decisions: [
            {
              index: 0,
              classification: "competitor",
              evidence_tier: "confirmed_signal",
              confidence: 0.88,
              reason: "Arabic local competitor evidence.",
              candidate_facts: {},
            },
          ],
        }),
      } as Response);

    const result = await new AiEvidenceTriageClient().triage({
      language_mode: LanguageModeDto.ArabicEgypt,
      intake: {
        business_name: "قصر نابولي",
        business_type: "محل حلويات",
        city: "اسيوط",
        area: "مدينة اسيوط",
      },
      candidates: [
        {
          index: 0,
          intent: "competitor_discovery",
          provider: "serpapi",
          title: "حلواني اخر ساعة",
          query: "منافسين محل حلويات اسيوط",
          rank: 1,
          provider_confidence: 0.9,
          metadata: {},
        },
      ],
    });

    expect(result.decisions[0]).toMatchObject({
      classification: "competitor",
      evidence_tier: "confirmed_signal",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

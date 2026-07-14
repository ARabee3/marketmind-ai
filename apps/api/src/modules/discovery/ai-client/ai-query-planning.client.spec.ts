import "reflect-metadata";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { AiQueryPlanningClient } from "./ai-query-planning.client";

describe("AiQueryPlanningClient", () => {
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

  it("posts query planning requests to the internal AI search endpoint", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          source: "deterministic",
          queries: [
            {
              intent: "competitor_discovery",
              query: "best restaurants in Cairo competitors",
              language: "mixed",
              priority: 100,
              provider_hints: ["serpapi"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const plan = await new AiQueryPlanningClient().plan(dto);

    expect(plan.source).toBe("deterministic");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://ai-service/internal/v1/ai/search/query-plan",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(dto),
      }),
    );
  });
});

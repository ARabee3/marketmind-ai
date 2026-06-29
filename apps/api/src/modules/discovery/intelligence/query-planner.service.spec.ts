import "reflect-metadata";
import { ProviderError } from "../../../common/errors/provider-error";
import { AiQueryPlanningClient } from "../ai-client/ai-query-planning.client";
import { LanguageModeDto, StartDiscoveryDto } from "../dto/start-discovery.dto";
import { DeterministicQueryPlannerService } from "./deterministic-query-planner.service";
import { QueryPlannerService } from "./query-planner.service";

describe("QueryPlannerService", () => {
  const aiClient = {
    plan: jest.fn(),
  } as unknown as jest.Mocked<AiQueryPlanningClient>;
  const deterministicPlanner = {
    plan: jest.fn(),
  } as unknown as jest.Mocked<DeterministicQueryPlannerService>;
  const dto: StartDiscoveryDto = {
    language_mode: LanguageModeDto.Mixed,
    intake: {
      business_name: "Koshary Corner",
      business_type: "restaurant",
      city: "Cairo",
    },
  };

  let service: QueryPlannerService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new QueryPlannerService(aiClient, deterministicPlanner);
  });

  it("uses the AI query plan when the AI client succeeds", async () => {
    aiClient.plan.mockResolvedValue({
      source: "llm",
      queries: [
        {
          intent: "competitor_discovery",
          query: "best restaurants in Cairo competitors",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });

    await expect(service.plan(dto)).resolves.toEqual({
      source: "llm",
      queries: [
        {
          intent: "competitor_discovery",
          query: "best restaurants in Cairo competitors",
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });
    expect(deterministicPlanner.plan).not.toHaveBeenCalled();
  });

  it("falls back to deterministic planning when the AI client has a provider error", async () => {
    aiClient.plan.mockRejectedValue(
      new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI query planning is not configured.",
        false,
      ),
    );
    deterministicPlanner.plan.mockReturnValue({
      source: "deterministic",
      queries: [
        {
          intent: "business_match",
          query: '"Koshary Corner" "restaurant" "Cairo"',
          language: LanguageModeDto.Mixed,
          priority: 100,
          provider_hints: ["serpapi"],
        },
      ],
    });

    await expect(service.plan(dto)).resolves.toMatchObject({
      source: "deterministic",
      warnings: [
        "AI_SERVICE_NOT_CONFIGURED: AI query planning is not configured.",
      ],
    });
  });

  it("rethrows unexpected errors instead of hiding code bugs", async () => {
    aiClient.plan.mockRejectedValue(new TypeError("bad test setup"));

    await expect(service.plan(dto)).rejects.toBeInstanceOf(TypeError);
    expect(deterministicPlanner.plan).not.toHaveBeenCalled();
  });
});

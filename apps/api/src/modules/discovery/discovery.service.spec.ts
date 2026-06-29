import { NotFoundException } from "@nestjs/common";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { IntelligenceResult } from "./discovery-state";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

describe("DiscoveryService", () => {
  const repository = {
    createPreparedSession: jest.fn(),
    findSessionForOwner: jest.fn(),
    updateCurrentQuestion: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryRepository>;
  const intelligenceRepository = {
    saveIntelligenceResult: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryIntelligenceRepository>;
  const gatherer = {
    gather: jest.fn(),
  } as unknown as jest.Mocked<IntelligenceGathererService>;
  const aiDiscoveryClient = {
    start: jest.fn(),
  } as unknown as jest.Mocked<AiDiscoveryClient>;

  let service: DiscoveryService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new DiscoveryService(
      repository,
      intelligenceRepository,
      gatherer,
      aiDiscoveryClient,
    );
  });

  it("runs and stores intelligence for a prepared discovery session", async () => {
    repository.createPreparedSession.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
    } as never);

    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
        area: "Nasr City",
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
    gatherer.gather.mockResolvedValue(intelligence);
    aiDiscoveryClient.start.mockResolvedValue({
      action: "ask_next_question",
      next_question: "Who are your best current customers?",
    });

    await expect(
      service.startPreparedDiscovery("owner-id", dto),
    ).resolves.toEqual({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      progress_ws_url:
        "/ws/v1/discovery/11111111-1111-4111-8111-111111111111/progress",
      status_url:
        "/api/v1/discovery/11111111-1111-4111-8111-111111111111/status",
      accepted_at: "2026-06-29T10:00:00.000Z",
    });
    expect(repository.createPreparedSession).toHaveBeenCalledWith(
      "owner-id",
      dto,
    );
    expect(gatherer.gather).toHaveBeenCalledWith(dto);
    expect(intelligenceRepository.saveIntelligenceResult).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      intelligence,
    );
    expect(aiDiscoveryClient.start).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      dto,
      intelligence,
    );
    expect(repository.updateCurrentQuestion).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "Who are your best current customers?",
    );
  });

  it("does not fail start when the AI discovery service is not configured", async () => {
    repository.createPreparedSession.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
    } as never);
    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
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
    gatherer.gather.mockResolvedValue(intelligence);
    aiDiscoveryClient.start.mockRejectedValue(
      new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      ),
    );

    await expect(
      service.startPreparedDiscovery("owner-id", dto),
    ).resolves.toMatchObject({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
    });
    expect(repository.updateCurrentQuestion).not.toHaveBeenCalled();
  });

  it("returns status with persisted intelligence", async () => {
    const intelligence: IntelligenceResult = {
      status: "complete",
      search_mode: "free_search",
      source_refs: [
        {
          id: "source-1",
          source_type: "search_result",
          platform: "serpapi",
          title: "Koshary Corner",
          confidence: 0.91,
          metadata: { provider: "serpapi" },
        },
      ],
      research_observations: [],
      conversation_hooks: [],
      knowledge_gaps: [],
    } as const;
    repository.findSessionForOwner.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "ready_for_chat",
      languageMode: "mixed",
      currentQuestion: null,
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
      intelligence,
      intakes: [
        {
          businessName: "Koshary Corner",
          businessType: "quick service restaurant",
          city: "Cairo",
          area: "Nasr City",
        },
      ],
    } as never);

    const status = await service.getStatus(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(status.status).toBe("ready_for_chat");
    expect(status.intake_summary).toEqual({
      business_name: "Koshary Corner",
      business_type: "quick service restaurant",
      city: "Cairo",
      area: "Nasr City",
    });
    expect(status.intelligence).toEqual(intelligence);
  });

  it("surfaces missing sessions from the repository", async () => {
    repository.findSessionForOwner.mockRejectedValue(
      new NotFoundException("Discovery session not found"),
    );

    await expect(
      service.getStatus("owner-id", "11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

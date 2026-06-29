import { NotFoundException } from "@nestjs/common";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { IntelligenceResult } from "./discovery-state";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";

describe("DiscoveryService", () => {
  const repository = {
    createPreparedSession: jest.fn(),
    findSessionForOwner: jest.fn(),
    updateCurrentQuestion: jest.fn(),
    updateStatus: jest.fn(),
    appendProgressEvent: jest.fn(),
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
  const progressGateway = {
    emitProgress: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryProgressGateway>;

  let service: DiscoveryService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new DiscoveryService(
      repository,
      intelligenceRepository,
      gatherer,
      aiDiscoveryClient,
      progressGateway,
    );
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
      progressEvents: [
        {
          id: BigInt(1),
          seq: 1,
          stage: "intelligence",
          status: "started",
          messageKey: "discovery.intelligence.started",
          messageText: "Research started.",
          payload: { source: "test" },
          createdAt: new Date("2026-06-29T10:01:00.000Z"),
        },
      ],
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
    expect(status.progress_events).toEqual([
      {
        seq: 1,
        stage: "intelligence",
        status: "started",
        message_key: "discovery.intelligence.started",
        message_text: "Research started.",
        payload: { source: "test" },
        created_at: "2026-06-29T10:01:00.000Z",
      },
    ]);
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

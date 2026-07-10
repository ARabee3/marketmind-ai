import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";
import { emptyDiscoveryProfileState } from "./market-profile";
import { IntelligenceResult } from "./discovery-state";

describe("DiscoveryService", () => {
  const repository = {
    createPreparedSession: jest.fn(),
    findSessionForOwner: jest.fn(),
    updateStatusIfCurrent: jest.fn(),
    appendProgressEvent: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryRepository>;
  const conversationRepository = {
    listMessages: jest.fn(),
    latestProfileDraft: jest.fn(),
    getIntake: jest.fn(),
    appendMessage: jest.fn(),
    recordInitialAssistantQuestion: jest.fn(),
    saveProfileDraft: jest.fn(),
    completeConversationTurn: jest.fn(),
    completeConversationWithDraft: jest.fn(),
    confirmProfile: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationRepository>;
  const progressGateway = {
    emitProgress: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryProgressGateway>;
  const queueProducer = {
    enqueueResearch: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryQueueProducer>;

  let service: DiscoveryService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new DiscoveryService(
      repository,
      conversationRepository,
      progressGateway,
      queueProducer,
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
          sessionId: "11111111-1111-4111-8111-111111111111",
          seq: 1,
          stage: "intelligence",
          status: "started",
          messageKey: "discovery.intelligence.started",
          messageText: "Research started.",
          payload: { source: "test" },
          createdAt: new Date("2026-06-29T10:01:00.000Z"),
        },
      ],
      profileState: emptyDiscoveryProfileState(),
      ownerTurnCount: 0,
      completionReason: null,
      intakes: [
        {
          businessName: "Koshary Corner",
          businessType: "quick service restaurant",
          city: "Cairo",
          area: "Nasr City",
        },
      ],
    } as never);
    conversationRepository.listMessages.mockResolvedValue([
      {
        id: "88888888-8888-4888-8888-888888888888",
        role: "assistant",
        content: "Who are your customers?",
        language: LanguageModeDto.Mixed,
        source: "chat",
        created_at: "2026-06-29T10:02:00.000Z",
      },
    ]);
    conversationRepository.latestProfileDraft.mockResolvedValue(undefined);

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
    expect(status.messages).toHaveLength(1);
    expect(status.strategy_locked).toBe(true);
    expect(status.progress_events).toEqual([
      {
        type: "progress",
        session_id: "11111111-1111-4111-8111-111111111111",
        seq: 1,
        stage: "search",
        status: "started",
        message_key: "discovery.intelligence.started",
        message_text: "Research started.",
        payload: { source: "test" },
        created_at: "2026-06-29T10:01:00.000Z",
      },
    ]);
  });

  it("unlocks strategy only after confirmation", async () => {
    repository.findSessionForOwner.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "confirmed",
      languageMode: "mixed",
      currentQuestion: null,
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
      intelligence: {
        status: "complete",
        search_mode: "free_search",
        source_refs: [],
        research_observations: [],
        conversation_hooks: [],
        knowledge_gaps: [],
      },
      progressEvents: [],
      profileState: emptyDiscoveryProfileState(),
      ownerTurnCount: 0,
      completionReason: null,
      intakes: [
        {
          businessName: "Koshary Corner",
          businessType: "restaurant",
          city: "Cairo",
          area: null,
        },
      ],
    } as never);
    conversationRepository.listMessages.mockResolvedValue([]);
    conversationRepository.latestProfileDraft.mockResolvedValue(undefined);

    const status = await service.getStatus(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(status.strategy_locked).toBe(false);
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

import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { IntelligenceResult } from "./discovery-state";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryService persistence progress", () => {
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
  const conversationRepository = {
    listMessages: jest.fn(),
    latestProfileDraft: jest.fn(),
    getIntake: jest.fn(),
    appendMessage: jest.fn(),
    saveProfileDraft: jest.fn(),
    updateSessionConversationState: jest.fn(),
    confirmProfile: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationRepository>;
  const gatherer = {
    gather: jest.fn(),
  } as unknown as jest.Mocked<IntelligenceGathererService>;
  const aiDiscoveryClient = {
    start: jest.fn(),
  } as unknown as jest.Mocked<AiDiscoveryClient>;
  const progressGateway = {
    emitProgress: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryProgressGateway>;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.createPreparedSession.mockResolvedValue({
      id: SESSION_ID,
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
    } as never);
    gatherer.gather.mockResolvedValue(emptyIntelligence());
    aiDiscoveryClient.start.mockResolvedValue({
      action: "ask_next_question",
      next_question: "Who are your best current customers?",
      updated_known_facts: {},
      updated_uncertainties: [],
      research_observations: [],
      source_refs: [],
      domain_scores: {},
    });
  });

  it("emits persisting progress around intelligence storage", async () => {
    const service = new DiscoveryService(
      repository,
      conversationRepository,
      intelligenceRepository,
      gatherer,
      aiDiscoveryClient,
      progressGateway,
    );

    await service.startPreparedDiscovery("owner-id", discoveryDto());
    await flushPromises();

    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "persisting",
        status: "completed",
        messageKey: "discovery.persisting.completed",
      }),
    );
  });
});

function discoveryDto(): StartDiscoveryDto {
  return {
    language_mode: LanguageModeDto.Mixed,
    intake: {
      business_name: "Koshary Corner",
      business_type: "quick service restaurant",
      city: "Cairo",
      area: "Nasr City",
    },
  };
}

function emptyIntelligence(): IntelligenceResult {
  return {
    status: "complete",
    search_mode: "free_search",
    source_refs: [],
    research_observations: [],
    conversation_hooks: [],
    knowledge_gaps: [],
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

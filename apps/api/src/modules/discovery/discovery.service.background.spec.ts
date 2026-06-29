import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { IntelligenceResult } from "./discovery-state";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

describe("DiscoveryService background research", () => {
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

  let service: DiscoveryService;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.appendProgressEvent.mockImplementation(
      async (_sessionId, event) => ({
        seq: 1,
        stage: event.stage,
        status: event.status,
        message_key: event.messageKey,
        message_text: event.messageText,
        payload: event.payload ?? {},
        created_at: "2026-06-29T10:01:00.000Z",
      }),
    );
    service = new DiscoveryService(
      repository,
      conversationRepository,
      intelligenceRepository,
      gatherer,
      aiDiscoveryClient,
      progressGateway,
    );
  });

  it("runs and stores intelligence for a prepared discovery session", async () => {
    const dto = discoveryDto();
    const intelligence = emptyIntelligence();
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockResolvedValue(intelligence);
    aiDiscoveryClient.start.mockResolvedValue(aiQuestion());

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
    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ stage: "session", status: "completed" }),
    );
    expect(progressGateway.emitProgress).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ stage: "session", status: "completed" }),
    );
    await flushPromises();
    expect(gatherer.gather).toHaveBeenCalledWith(dto, expect.any(Function));
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

  it("returns before background research finishes", async () => {
    const dto = discoveryDto();
    const intelligence = emptyIntelligence();
    const pendingGather = deferred<IntelligenceResult>();
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockReturnValue(pendingGather.promise);
    aiDiscoveryClient.start.mockResolvedValue(aiQuestion());

    const responsePromise = service.startPreparedDiscovery("owner-id", dto);
    const response = await Promise.race([
      responsePromise,
      nextTickValue("blocked"),
    ]);

    expect(response).not.toBe("blocked");
    expect(response).toMatchObject({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
    });
    expect(intelligenceRepository.saveIntelligenceResult).not.toHaveBeenCalled();

    pendingGather.resolve(intelligence);
    await flushPromises();
    expect(intelligenceRepository.saveIntelligenceResult).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      intelligence,
    );
  });

  it("does not fail start when the AI discovery service is not configured", async () => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockResolvedValue(emptyIntelligence());
    aiDiscoveryClient.start.mockRejectedValue(
      new ProviderError(
        "AI_SERVICE_NOT_CONFIGURED",
        "AI discovery service is not configured.",
        false,
      ),
    );

    await expect(
      service.startPreparedDiscovery("owner-id", discoveryDto()),
    ).resolves.toMatchObject({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
    });
    await flushPromises();
    expect(repository.updateCurrentQuestion).not.toHaveBeenCalled();
  });
});

function session(): { readonly id: string; readonly startedAt: Date } {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    startedAt: new Date("2026-06-29T10:00:00.000Z"),
  };
}

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

function aiQuestion() {
  return {
    action: "ask_next_question" as const,
    next_question: "Who are your best current customers?",
    updated_known_facts: {},
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: {},
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });

  if (!resolveValue) {
    throw new Error("Deferred promise did not initialize.");
  }

  return { promise, resolve: resolveValue };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function nextTickValue<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setImmediate(() => resolve(value));
  });
}

import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { IntelligenceResult } from "./discovery-state";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import {
  emptyDiscoveryDomainScores,
  emptyMarketAwareBusinessFacts,
} from "./market-profile";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryService background research", () => {
  const repository = {
    createPreparedSession: jest.fn(),
    findSessionForOwner: jest.fn(),
    updateStatusIfCurrent: jest.fn(),
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
    recordInitialAssistantQuestion: jest.fn(),
    saveProfileDraft: jest.fn(),
    completeConversationTurn: jest.fn(),
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
    repository.updateStatusIfCurrent.mockResolvedValue(true);
    conversationRepository.recordInitialAssistantQuestion.mockResolvedValue(
      assistantMessage(),
    );
    repository.appendProgressEvent.mockImplementation(
      async (_sessionId, event) => ({
        type: "progress",
        session_id: SESSION_ID,
        seq: 1,
        stage: event.stage === "session" ? "queued" : "search",
        status: event.status === "completed" ? "complete" : event.status,
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

  function expectAiUnavailableFallback(): void {
    expect(
      conversationRepository.recordInitialAssistantQuestion,
    ).not.toHaveBeenCalled();
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
    expect(repository.appendProgressEvent).not.toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ messageKey: "discovery.ready_for_chat" }),
    );
  }

  it("runs and stores intelligence for a prepared discovery session", async () => {
    const dto = discoveryDto();
    const intelligence = emptyIntelligence();
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockResolvedValue(intelligence);
    aiDiscoveryClient.start.mockResolvedValue(aiQuestion());

    await expect(
      service.startPreparedDiscovery("owner-id", dto),
    ).resolves.toEqual({
      session_id: SESSION_ID,
      status: "researching",
      progress_ws_url: "/ws/v1/discovery",
      status_url: `/api/v1/discovery/${SESSION_ID}/status`,
      accepted_at: "2026-06-29T10:00:00.000Z",
    });
    expect(repository.createPreparedSession).toHaveBeenCalledWith(
      "owner-id",
      dto,
    );
    await flushPromises();
    expect(gatherer.gather).toHaveBeenCalledWith(
      dto,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(intelligenceRepository.saveIntelligenceResult).toHaveBeenCalledWith(
      SESSION_ID,
      intelligence,
    );
    expect(aiDiscoveryClient.start).toHaveBeenCalledWith(
      SESSION_ID,
      dto,
      intelligence,
    );
    expect(
      conversationRepository.recordInitialAssistantQuestion,
    ).toHaveBeenCalledWith(
      SESSION_ID,
      "Who are your best current customers?",
      LanguageModeDto.Mixed,
    );
    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "ready",
        status: "completed",
        messageKey: "discovery.ready_for_chat",
      }),
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
      session_id: SESSION_ID,
      status: "researching",
    });
    expect(
      intelligenceRepository.saveIntelligenceResult,
    ).not.toHaveBeenCalled();

    pendingGather.resolve(intelligence);
    await flushPromises();
    expect(intelligenceRepository.saveIntelligenceResult).toHaveBeenCalledWith(
      SESSION_ID,
      intelligence,
    );
  });

  it.each([
    {
      name: "the AI discovery service is not configured",
      arrangeAiFailure: () =>
        aiDiscoveryClient.start.mockRejectedValue(
          new ProviderError(
            "AI_SERVICE_NOT_CONFIGURED",
            "AI discovery service is not configured.",
            false,
          ),
        ),
    },
    {
      name: "AI discovery returns safe failure without a question",
      arrangeAiFailure: () =>
        aiDiscoveryClient.start.mockResolvedValue({
          action: "safe_failure",
          updated_known_facts: emptyMarketAwareBusinessFacts(),
          updated_uncertainties: [],
          research_observations: [],
          source_refs: [],
          domain_scores: emptyDiscoveryDomainScores(),
          safe_error: {
            code: "AI_PROVIDER_INVALID_OUTPUT",
            message: "Provider returned invalid discovery output.",
            retryable: true,
          },
        }),
    },
  ])("does not mark chat ready when $name", async ({ arrangeAiFailure }) => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockResolvedValue(emptyIntelligence());
    arrangeAiFailure();

    await expect(
      service.startPreparedDiscovery("owner-id", discoveryDto()),
    ).resolves.toMatchObject({
      session_id: SESSION_ID,
      status: "researching",
    });
    await flushPromises();
    expectAiUnavailableFallback();
  });

  it("does not expose internal background failure details", async () => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockRejectedValue(
      new Error("secret provider host and credentials"),
    );

    await service.startPreparedDiscovery("owner-id", discoveryDto());
    await flushPromises();

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(
      SESSION_ID,
      ["researching", "partial_ready", "ready_for_chat", "research_failed"],
      "failed",
    );
    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        payload: {
          code: "DISCOVERY_BACKGROUND_FAILED",
          retryable: true,
        },
      }),
    );
  });

  it("cancels research when the total deadline is reached", async () => {
    const previousTimeout = process.env.DISCOVERY_RESEARCH_TIMEOUT_MS;
    process.env.DISCOVERY_RESEARCH_TIMEOUT_MS = "5";
    repository.createPreparedSession.mockResolvedValue(session() as never);
    gatherer.gather.mockImplementation(
      async (_dto, _onProgress, signal) =>
        new Promise<IntelligenceResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(signal.reason);
          });
        }),
    );

    try {
      await service.startPreparedDiscovery("owner-id", discoveryDto());
      await new Promise((resolve) => setTimeout(resolve, 15));

      expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(
        SESSION_ID,
        ["researching", "partial_ready", "ready_for_chat", "research_failed"],
        "failed",
      );
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DISCOVERY_RESEARCH_TIMEOUT_MS;
      } else {
        process.env.DISCOVERY_RESEARCH_TIMEOUT_MS = previousTimeout;
      }
    }
  });
});

function session(): { readonly id: string; readonly startedAt: Date } {
  return {
    id: SESSION_ID,
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
    updated_known_facts: emptyMarketAwareBusinessFacts(),
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: emptyDiscoveryDomainScores(),
  };
}

function assistantMessage() {
  return {
    id: "assistant-message",
    role: "assistant" as const,
    content: "Who are your best current customers?",
    language: LanguageModeDto.Mixed,
    source: "chat" as const,
    created_at: "2026-06-29T10:01:00.000Z",
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

import { ConflictException } from "@nestjs/common";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryInitialQuestionService } from "./discovery-initial-question.service";
import { DiscoveryReadinessService } from "./discovery-readiness.service";
import {
  emptyDiscoveryDomainScores,
  emptyDiscoveryProfileState,
  emptyMarketAwareBusinessFacts,
} from "./market-profile";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryInitialQuestionService", () => {
  const conversationRepository = {
    listMessages: jest.fn(),
    recordInitialAssistantQuestion: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationRepository>;
  const aiDiscoveryClient = {
    start: jest.fn(),
  } as unknown as jest.Mocked<AiDiscoveryClient>;
  const readinessService = {
    evaluate: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryReadinessService>;

  let service: DiscoveryInitialQuestionService;

  beforeEach(() => {
    jest.resetAllMocks();
    conversationRepository.listMessages.mockResolvedValue([]);
    readinessService.evaluate.mockReturnValue(emptyDiscoveryProfileState());
    service = new DiscoveryInitialQuestionService(
      conversationRepository,
      aiDiscoveryClient,
      readinessService,
    );
  });

  it("records the first assistant question and returns started", async () => {
    const question = aiQuestion();
    aiDiscoveryClient.start.mockResolvedValue(question);
    conversationRepository.recordInitialAssistantQuestion.mockResolvedValue(
      assistantMessage(),
    );

    const result = await service.ensureInitialQuestion(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
      ["partial_ready", "ready_for_chat", "research_failed"],
    );

    expect(result).toBe("started");
    expect(aiDiscoveryClient.start).toHaveBeenCalledWith(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
    );
    expect(
      conversationRepository.recordInitialAssistantQuestion,
    ).toHaveBeenCalledWith(
      SESSION_ID,
      "Who are your best current customers?",
      LanguageModeDto.Mixed,
      emptyDiscoveryProfileState(),
      {
        suggested_answers: ["Families", "Office workers"],
      },
      ["partial_ready", "ready_for_chat", "research_failed"],
    );
  });

  it("returns already_started when an assistant message already exists", async () => {
    conversationRepository.listMessages.mockResolvedValue([
      assistantMessage(),
    ]);

    const result = await service.ensureInitialQuestion(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
      ["ready_for_chat"],
    );

    expect(result).toBe("already_started");
    expect(aiDiscoveryClient.start).not.toHaveBeenCalled();
    expect(
      conversationRepository.recordInitialAssistantQuestion,
    ).not.toHaveBeenCalled();
  });

  it("returns unavailable on a safe error from the provider", async () => {
    aiDiscoveryClient.start.mockResolvedValue({
      ...aiQuestion(),
      action: "safe_failure",
      next_question: undefined,
      safe_error: {
        code: "AI_PROVIDER_FAILURE",
        message: "Provider unavailable.",
        retryable: true,
      },
    });

    const result = await service.ensureInitialQuestion(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
      ["ready_for_chat"],
    );

    expect(result).toBe("unavailable");
    expect(
      conversationRepository.recordInitialAssistantQuestion,
    ).not.toHaveBeenCalled();
  });

  it("returns unavailable when the provider omits a next question", async () => {
    aiDiscoveryClient.start.mockResolvedValue({
      ...aiQuestion(),
      next_question: undefined,
    });

    const result = await service.ensureInitialQuestion(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
      ["ready_for_chat"],
    );

    expect(result).toBe("unavailable");
  });

  it("returns unavailable on a retryable provider error", async () => {
    aiDiscoveryClient.start.mockRejectedValue(
      new ProviderError("AI_DISCOVERY_PROVIDER_ERROR", "Provider failed.", true),
    );

    const result = await service.ensureInitialQuestion(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
      ["ready_for_chat"],
    );

    expect(result).toBe("unavailable");
  });

  it("returns already_started when persistence races with another delivery", async () => {
    aiDiscoveryClient.start.mockResolvedValue(aiQuestion());
    conversationRepository.recordInitialAssistantQuestion.mockRejectedValue(
      new ConflictException("Already started."),
    );

    const result = await service.ensureInitialQuestion(
      SESSION_ID,
      discoveryDto(),
      emptyIntelligence(),
      ["ready_for_chat"],
    );

    expect(result).toBe("already_started");
  });

  it("rethrows unexpected errors so the caller can surface them", async () => {
    aiDiscoveryClient.start.mockRejectedValue(new Error("Unexpected failure"));

    await expect(
      service.ensureInitialQuestion(
        SESSION_ID,
        discoveryDto(),
        emptyIntelligence(),
        ["ready_for_chat"],
      ),
    ).rejects.toThrow("Unexpected failure");
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

function emptyIntelligence() {
  return {
    status: "complete" as const,
    search_mode: "free_search" as const,
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
    suggested_answers: ["Families", "Office workers"],
    updated_known_facts: emptyMarketAwareBusinessFacts(),
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: emptyDiscoveryDomainScores(),
    ready_to_summarize: false,
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
import { BadRequestException, ConflictException } from "@nestjs/common";
import { ProviderError } from "../../common/errors/provider-error";
import { AiDiscoveryClient } from "./ai-client/ai-discovery.client";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryConversationService } from "./discovery-conversation.service";
import {
  AiDiscoveryResult,
  BusinessProfileDraft,
  DiscoveryMessage,
  IntelligenceResult,
} from "./discovery-state";
import { DiscoveryRepository } from "./discovery.repository";
import {
  LanguageModeDto,
  PreparedDiscoveryIntakeDto,
} from "./dto/start-discovery.dto";

describe("DiscoveryService conversation", () => {
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
    confirmProfile: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationRepository>;
  const aiDiscoveryClient = {
    start: jest.fn(),
    respond: jest.fn(),
    summarize: jest.fn(),
  } as unknown as jest.Mocked<AiDiscoveryClient>;

  let service: DiscoveryConversationService;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findSessionForOwner.mockResolvedValue(session() as never);
    conversationRepository.getIntake.mockResolvedValue(intake());
    conversationRepository.listMessages.mockResolvedValue([assistantMessage()]);
    conversationRepository.appendMessage.mockImplementation(
      async (_sessionId, message) => ({
        id: message.role === "owner" ? "owner-message" : "assistant-message",
        role: message.role,
        content: message.content,
        language: message.language,
        source: message.source,
        created_at: "2026-06-29T10:05:00.000Z",
      }),
    );
    conversationRepository.completeConversationTurn.mockImplementation(
      async (
        _sessionId,
        _allowedStatuses,
        _status,
        _currentQuestion,
        _profileDraftId,
        message,
      ) =>
        message
          ? {
              id: "assistant-message",
              role: message.role,
              content: message.content,
              language: message.language,
              source: message.source,
              created_at: "2026-06-29T10:05:00.000Z",
            }
          : undefined,
    );
    service = new DiscoveryConversationService(
      repository,
      conversationRepository,
      aiDiscoveryClient,
    );
  });

  it("sends owner response to AI and stores the next assistant question", async () => {
    aiDiscoveryClient.respond.mockResolvedValue({
      ...aiResult(),
      next_question: "What offer sells best today?",
    });

    const response = await service.respondToDiscovery(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
      { message: "Families buy most often.", language: LanguageModeDto.Mixed },
    );

    expect(aiDiscoveryClient.respond).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      LanguageModeDto.Mixed,
      intake(),
      intelligence(),
      [assistantMessage()],
      expect.objectContaining({ role: "owner" }),
    );
    expect(conversationRepository.appendMessage).toHaveBeenCalledTimes(1);
    expect(
      conversationRepository.completeConversationTurn,
    ).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      ["partial_ready", "ready_for_chat", "research_failed", "in_progress"],
      "in_progress",
      "What offer sells best today?",
      undefined,
      expect.objectContaining({
        role: "assistant",
        content: "What offer sells best today?",
      }),
    );
    expect(response.status).toBe("in_progress");
    expect(response.assistant_message?.content).toBe(
      "What offer sells best today?",
    );
  });

  it("does not mark AI safe failures as in progress", async () => {
    aiDiscoveryClient.respond.mockResolvedValue({
      ...aiResult(),
      action: "safe_failure",
      safe_error: {
        code: "AI_PROVIDER_FAILURE",
        message: "Provider timeout.",
        retryable: true,
      },
    });

    await expect(
      service.respondToDiscovery(
        "owner-id",
        "11111111-1111-4111-8111-111111111111",
        {
          message: "Families buy most often.",
          language: LanguageModeDto.Mixed,
        },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(conversationRepository.appendMessage).toHaveBeenCalledTimes(1);
    expect(
      conversationRepository.completeConversationTurn,
    ).not.toHaveBeenCalled();
  });

  it("summarizes the conversation into a profile draft", async () => {
    const draft = profileDraft();
    aiDiscoveryClient.summarize.mockResolvedValue({
      ...aiResult(),
      action: "produce_profile_draft",
      profile_draft: draft,
    });
    conversationRepository.saveProfileDraft.mockResolvedValue(draft);

    const response = await service.summarizeDiscovery(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(conversationRepository.saveProfileDraft).toHaveBeenCalledWith(draft);
    expect(
      conversationRepository.completeConversationTurn,
    ).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      ["partial_ready", "ready_for_chat", "research_failed", "in_progress"],
      "summary_ready",
      undefined,
      draft.id,
      expect.objectContaining({
        role: "assistant",
        source: "summary",
      }),
    );
    expect(response.profile_draft.id).toBe(draft.id);
  });

  it("requires explicit owner confirmation before unlocking strategy", async () => {
    await expect(
      service.confirmProfile(
        "owner-id",
        "11111111-1111-4111-8111-111111111111",
        {
          profile_draft_id: "99999999-9999-4999-8999-999999999999",
          owner_confirmation: false,
        } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    conversationRepository.confirmProfile.mockResolvedValue({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "confirmed",
      business_profile_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      confirmed_at: "2026-06-29T10:10:00.000Z",
      strategy_locked: false,
    });
    repository.findSessionForOwner.mockResolvedValue(
      session("summary_ready") as never,
    );

    const response = await service.confirmProfile(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
      {
        profile_draft_id: "99999999-9999-4999-8999-999999999999",
        owner_confirmation: true,
      },
    );

    expect(response.strategy_locked).toBe(false);
    expect(conversationRepository.confirmProfile).toHaveBeenCalledWith(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
      "99999999-9999-4999-8999-999999999999",
      intake(),
    );
  });

  it("rejects conversation writes after a terminal state", async () => {
    repository.findSessionForOwner.mockResolvedValue(
      session("confirmed") as never,
    );

    await expect(
      service.respondToDiscovery(
        "owner-id",
        "11111111-1111-4111-8111-111111111111",
        { message: "This should not be stored." },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(conversationRepository.appendMessage).not.toHaveBeenCalled();
    expect(aiDiscoveryClient.respond).not.toHaveBeenCalled();
  });

  it("rejects a profile draft produced for another session", async () => {
    aiDiscoveryClient.summarize.mockResolvedValue({
      ...aiResult(),
      action: "produce_profile_draft",
      profile_draft: {
        ...profileDraft(),
        session_id: "22222222-2222-4222-8222-222222222222",
      },
    });

    await expect(
      service.summarizeDiscovery(
        "owner-id",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toMatchObject({ code: "AI_DISCOVERY_INVALID_OUTPUT" });
    expect(conversationRepository.saveProfileDraft).not.toHaveBeenCalled();
  });
});

function session(status = "ready_for_chat") {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status,
    languageMode: LanguageModeDto.Mixed,
    currentQuestion: "Who are your best current customers?",
    startedAt: new Date("2026-06-29T10:00:00.000Z"),
    intelligence: intelligence(),
    progressEvents: [],
    intakes: [
      {
        businessName: "Koshary Corner",
        businessType: "quick service restaurant",
        city: "Cairo",
        area: "Nasr City",
      },
    ],
  };
}

function intake(): PreparedDiscoveryIntakeDto {
  return {
    business_name: "Koshary Corner",
    business_type: "quick service restaurant",
    city: "Cairo",
    area: "Nasr City",
  };
}

function intelligence(): IntelligenceResult {
  return {
    status: "complete",
    search_mode: "free_search",
    source_refs: [],
    research_observations: [],
    conversation_hooks: [],
    knowledge_gaps: [],
  };
}

function assistantMessage(): DiscoveryMessage {
  return {
    id: "assistant-existing",
    role: "assistant",
    content: "Who are your best current customers?",
    language: LanguageModeDto.Mixed,
    source: "chat",
    created_at: "2026-06-29T10:01:00.000Z",
  };
}

function aiResult(): AiDiscoveryResult {
  return {
    action: "ask_next_question",
    updated_known_facts: {},
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: {},
  };
}

function profileDraft(): BusinessProfileDraft {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    session_id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    status: "ready_for_confirmation",
    confirmed_facts: { primary_customer_segment: "families" },
    research_observations: [],
    uncertainties: [],
    owner_goals: [],
    strategy_relevant_notes: [],
    raw_ai_output: {},
  };
}

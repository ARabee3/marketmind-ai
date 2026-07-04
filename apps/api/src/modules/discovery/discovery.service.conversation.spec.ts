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
import {
  emptyDiscoveryDomainScores,
  emptyDiscoveryProfileState,
  emptyMarketAwareBusinessFacts,
  marketContextFromObservations,
} from "./market-profile";
import { DiscoveryReadinessService } from "./discovery-readiness.service";

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
    completeConversationWithDraft: jest.fn(),
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
    conversationRepository.completeConversationWithDraft.mockImplementation(
      async (
        _sessionId,
        _allowedStatuses,
        draft,
        _profileState,
        _completionReason,
        message,
      ) => ({
        draft,
        assistantMessage: {
          id: "summary-message",
          role: message.role,
          content: message.content,
          language: message.language,
          source: message.source,
          created_at: "2026-06-29T10:06:00.000Z",
        },
      }),
    );
    service = new DiscoveryConversationService(
      repository,
      conversationRepository,
      aiDiscoveryClient,
      new DiscoveryReadinessService(),
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
      expect.objectContaining({
        readiness: expect.objectContaining({ owner_turn_count: 1 }),
      }),
      true,
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

  it("automatically summarizes when the hybrid readiness gate passes", async () => {
    const ready = readyAiResult();
    aiDiscoveryClient.respond.mockResolvedValue(ready);
    aiDiscoveryClient.summarize.mockImplementation(
      async (
        _sessionId,
        _languageMode,
        _intake,
        _intelligence,
        _messages,
        completionContext,
      ) => ({
        ...ready,
        action: "produce_profile_draft",
        next_question: undefined,
        profile_draft: {
          ...profileDraft(),
          completeness: completionContext.completeness,
          completion_reason: completionContext.reason,
          readiness: completionContext.readiness,
          confirmed_facts: ready.updated_known_facts,
        },
      }),
    );

    const response = await service.respondToDiscovery(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
      { message: "The owner and one team member handle marketing." },
    );

    expect(response.status).toBe("summary_ready");
    expect(response.profile_draft?.completeness).toBe("complete");
    expect(response.readiness.ready).toBe(true);
    expect(aiDiscoveryClient.summarize).toHaveBeenCalledWith(
      expect.any(String),
      LanguageModeDto.Mixed,
      intake(),
      intelligence(),
      expect.arrayContaining([expect.objectContaining({ role: "owner" })]),
      expect.objectContaining({
        reason: "sufficient",
        completeness: "complete",
      }),
    );
  });

  it("automatically creates an incomplete draft on owner turn fifteen", async () => {
    repository.findSessionForOwner.mockResolvedValue({
      ...session(),
      ownerTurnCount: 14,
    } as never);
    const continuing = {
      ...aiResult(),
      next_question: "What constraint matters most?",
    };
    aiDiscoveryClient.respond.mockResolvedValue(continuing);
    aiDiscoveryClient.summarize.mockImplementation(
      async (
        _sessionId,
        _languageMode,
        _intake,
        _intelligence,
        _messages,
        completionContext,
      ) => ({
        ...continuing,
        action: "produce_profile_draft",
        next_question: undefined,
        profile_draft: {
          ...profileDraft(),
          completeness: completionContext.completeness,
          completion_reason: completionContext.reason,
          readiness: completionContext.readiness,
        },
      }),
    );

    const response = await service.respondToDiscovery(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
      { message: "I still do not know." },
    );

    expect(response.status).toBe("summary_ready");
    expect(response.profile_draft).toMatchObject({
      completeness: "incomplete",
      completion_reason: "turn_limit",
    });
    expect(response.readiness.owner_turn_count).toBe(15);
  });

  it("rejects manual summarization while blocking gaps remain", async () => {
    await expect(
      service.summarizeDiscovery(
        "owner-id",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "DISCOVERY_PROFILE_NOT_READY",
      }),
    });
    expect(aiDiscoveryClient.summarize).not.toHaveBeenCalled();
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
      { finish_anyway: true },
    );

    expect(
      conversationRepository.completeConversationWithDraft,
    ).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      ["partial_ready", "ready_for_chat", "research_failed", "in_progress"],
      draft,
      expect.objectContaining({
        readiness: expect.objectContaining({
          completion_reason: "owner_finished_early",
        }),
      }),
      "owner_finished_early",
      expect.objectContaining({
        role: "assistant",
        source: "summary",
      }),
      false,
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
      false,
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
        { finish_anyway: true },
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
    profileState: emptyDiscoveryProfileState(),
    ownerTurnCount: 0,
    completionReason: null,
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
    updated_known_facts: emptyMarketAwareBusinessFacts(),
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: emptyDiscoveryDomainScores(),
    ready_to_summarize: false,
  };
}

function profileDraft(): BusinessProfileDraft {
  const confirmedFacts = emptyMarketAwareBusinessFacts();

  return {
    id: "99999999-9999-4999-8999-999999999999",
    session_id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    status: "ready_for_confirmation",
    completeness: "incomplete",
    completion_reason: "owner_finished_early",
    readiness: emptyDiscoveryProfileState().readiness,
    confirmed_facts: {
      ...confirmedFacts,
      customers: {
        ...confirmedFacts.customers,
        primary_segments: ["families"],
      },
    },
    market_context: marketContextFromObservations([]),
    research_observations: [],
    uncertainties: [],
    owner_goals: [],
    strategy_relevant_notes: [],
    raw_ai_output: {},
  };
}

function readyAiResult(): AiDiscoveryResult {
  const result = aiResult();
  const facts = emptyMarketAwareBusinessFacts();

  return {
    ...result,
    next_question: "What is the most important remaining detail?",
    ready_to_summarize: true,
    updated_known_facts: {
      ...facts,
      identity: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
      },
      offer: {
        ...facts.offer,
        core_offerings: ["koshary bowls"],
      },
      customers: {
        ...facts.customers,
        primary_segments: ["office workers"],
        peak_periods: ["weekday lunch"],
      },
      differentiation: {
        ...facts.differentiation,
        owner_claimed_strengths: ["fast service"],
      },
      current_marketing: {
        ...facts.current_marketing,
        active_channels: ["instagram"],
      },
      goals_and_constraints: {
        ...facts.goals_and_constraints,
        growth_goals: ["increase lunch orders"],
        team_capacity: "owner and one team member",
      },
    },
    domain_scores: {
      identity: 0.95,
      offer: 0.75,
      customers: 0.8,
      differentiation: 0.65,
      current_marketing: 0.65,
      goals_and_constraints: 0.75,
      market_context: 0,
      research_confidence: 0,
      profile_readiness: 0.85,
    },
  };
}

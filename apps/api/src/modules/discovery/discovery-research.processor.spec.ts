import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryIntelligenceRepository } from "./discovery-intelligence.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryResearchProcessor } from "./discovery-research.processor";
import { DiscoveryInitialQuestionService } from "./discovery-initial-question.service";
import { IntelligenceGathererService } from "./intelligence/intelligence-gatherer.service";
import { StartDiscoveryDto } from "./dto/start-discovery.dto";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryResearchProcessor", () => {
  const repository = {
    findSessionStatus: jest.fn(),
    updateStatusIfCurrent: jest.fn(),
    appendProgressEvent: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryRepository>;
  const conversationRepository = {
    getIntake: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationRepository>;
  const intelligenceRepository = {
    saveIntelligenceResult: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryIntelligenceRepository>;
  const gatherer = {
    gather: jest.fn(),
  } as unknown as jest.Mocked<IntelligenceGathererService>;
  const initialQuestionService = {
    ensureInitialQuestion: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryInitialQuestionService>;
  const progressGateway = {
    emitProgress: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryProgressGateway>;

  let processor: DiscoveryResearchProcessor;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.updateStatusIfCurrent.mockResolvedValue(true);
    repository.appendProgressEvent.mockImplementation(
      async (_sessionId, event) =>
        ({
          type: "progress" as const,
          session_id: SESSION_ID,
          seq: 1,
          stage: event.stage,
          status: event.status,
          message_key: event.messageKey,
          message_text: event.messageText,
          payload: event.payload ?? {},
          created_at: "2026-06-29T10:01:00.000Z",
        }) as never,
    );
    conversationRepository.getIntake.mockResolvedValue(intakeDto());
    processor = new DiscoveryResearchProcessor(
      repository,
      conversationRepository,
      intelligenceRepository,
      gatherer,
      initialQuestionService,
      progressGateway,
    );
  });

  it("skips processing when session is already ready_for_chat", async () => {
    repository.findSessionStatus.mockResolvedValue({
      status: "ready_for_chat",
    });

    await processor.process(SESSION_ID, 1, 3);

    expect(gatherer.gather).not.toHaveBeenCalled();
    expect(repository.appendProgressEvent).not.toHaveBeenCalled();
  });

  it("skips processing when session is already confirmed", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "confirmed" });

    await processor.process(SESSION_ID, 1, 3);

    expect(gatherer.gather).not.toHaveBeenCalled();
  });

  it("skips processing when session is already failed", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "failed" });

    await processor.process(SESSION_ID, 1, 3);

    expect(gatherer.gather).not.toHaveBeenCalled();
  });

  it("skips processing when session is not found", async () => {
    repository.findSessionStatus.mockResolvedValue(null);

    await processor.process(SESSION_ID, 1, 3);

    expect(gatherer.gather).not.toHaveBeenCalled();
  });

  it("runs research when session is researching", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockResolvedValue(emptyIntelligence());
    initialQuestionService.ensureInitialQuestion.mockResolvedValue("started");

    await processor.process(SESSION_ID, 1, 3);

    expect(gatherer.gather).toHaveBeenCalledWith(
      expect.objectContaining({ intake: intakeDto() }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(initialQuestionService.ensureInitialQuestion).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ intake: intakeDto() }),
      emptyIntelligence(),
      ["researching"],
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

  it("does not call initial-question creation when intelligence fails", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockResolvedValue({
      ...emptyIntelligence(),
      status: "failed",
      safe_error: {
        code: "SEARCH_FAILED",
        message: "Search failed.",
        retryable: true,
      },
    });

    await processor.process(SESSION_ID, 1, 3);

    expect(initialQuestionService.ensureInitialQuestion).not.toHaveBeenCalled();
    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(
      SESSION_ID,
      ["researching"],
      "research_failed",
    );
  });

  it("keeps chat unavailable when initial question creation reports unavailable", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockResolvedValue(emptyIntelligence());
    initialQuestionService.ensureInitialQuestion.mockResolvedValue(
      "unavailable",
    );

    await processor.process(SESSION_ID, 1, 3);

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(
      SESSION_ID,
      ["researching"],
      "partial_ready",
    );
    expect(repository.appendProgressEvent).not.toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ messageKey: "discovery.ready_for_chat" }),
    );
  });

  it("treats duplicate initial question as an idempotent no-op", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockResolvedValue(emptyIntelligence());
    initialQuestionService.ensureInitialQuestion.mockResolvedValue(
      "already_started",
    );

    await processor.process(SESSION_ID, 1, 3);

    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalledWith(
      SESSION_ID,
      expect.any(Array),
      "failed",
    );
    expect(repository.appendProgressEvent).not.toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ messageKey: "discovery.ready_for_chat" }),
    );
  });

  it("records retry progress event on non-final failure", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockRejectedValue(new Error("Provider timeout"));

    await expect(processor.process(SESSION_ID, 1, 3)).rejects.toThrow(
      "Provider timeout",
    );

    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "background",
        status: "failed",
        messageKey: "discovery.background.retry",
        payload: expect.objectContaining({
          code: "DISCOVERY_RESEARCH_RETRY",
          retryable: true,
          attempt: 1,
          max_attempts: 3,
        }),
      }),
    );
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();
  });

  it("retries run real research after a non-final failure", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather
      .mockRejectedValueOnce(new Error("Provider timeout"))
      .mockResolvedValueOnce(emptyIntelligence());
    initialQuestionService.ensureInitialQuestion.mockResolvedValue("started");

    await expect(processor.process(SESSION_ID, 1, 3)).rejects.toThrow(
      "Provider timeout",
    );
    expect(repository.updateStatusIfCurrent).not.toHaveBeenCalled();

    await processor.process(SESSION_ID, 2, 3);

    expect(gatherer.gather).toHaveBeenCalledTimes(2);
    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "ready",
        status: "completed",
        messageKey: "discovery.ready_for_chat",
      }),
    );
  });

  it("records terminal failure on final attempt", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockRejectedValue(new Error("Provider timeout"));

    await processor.process(SESSION_ID, 3, 3);

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(
      SESSION_ID,
      ["researching", "partial_ready", "ready_for_chat", "research_failed"],
      "failed",
    );
    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "background",
        status: "failed",
        messageKey: "discovery.background.failed",
        payload: expect.objectContaining({
          code: "DISCOVERY_RESEARCH_FAILED",
          retryable: false,
        }),
      }),
    );
  });

  it("does not duplicate terminal failure if status already updated", async () => {
    repository.findSessionStatus.mockResolvedValue({ status: "researching" });
    gatherer.gather.mockRejectedValue(new Error("Provider timeout"));
    repository.updateStatusIfCurrent.mockResolvedValue(false);

    await processor.process(SESSION_ID, 3, 3);

    expect(repository.appendProgressEvent).not.toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        payload: expect.objectContaining({ code: "DISCOVERY_RESEARCH_FAILED" }),
      }),
    );
  });
});

function intakeDto(): StartDiscoveryDto["intake"] {
  return {
    business_name: "Koshary Corner",
    business_type: "quick service restaurant",
    city: "Cairo",
    area: "Nasr City",
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
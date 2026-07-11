import { ProviderError } from "../../common/errors/provider-error";
import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { StartDiscoveryDto, LanguageModeDto } from "./dto/start-discovery.dto";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryService enqueue behavior", () => {
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
    repository.appendProgressEvent.mockImplementation(
      async (_sessionId, event) => ({
        type: "progress" as const,
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
      progressGateway,
      queueProducer,
    );
  });

  it("returns 202 Accepted after enqueueing research", async () => {
    const dto = discoveryDto();
    repository.createPreparedSession.mockResolvedValue(session() as never);
    queueProducer.enqueueResearch.mockResolvedValue(undefined);

    const result = await service.startPreparedDiscovery("owner-id", dto);

    expect(result).toEqual({
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
    expect(queueProducer.enqueueResearch).toHaveBeenCalledWith(SESSION_ID);
  });

  it("records queued progress event before enqueueing", async () => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    queueProducer.enqueueResearch.mockResolvedValue(undefined);

    await service.startPreparedDiscovery("owner-id", discoveryDto());

    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "queued",
        status: "started",
        messageKey: "discovery.queued.started",
      }),
    );
  });

  it("throws ServiceUnavailableException when enqueue fails", async () => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    queueProducer.enqueueResearch.mockRejectedValue(
      new ProviderError(
        "DISCOVERY_ENQUEUE_FAILED",
        "Redis connection refused",
        true,
      ),
    );

    await expect(
      service.startPreparedDiscovery("owner-id", discoveryDto()),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        code: "DISCOVERY_ENQUEUE_FAILED",
      }),
    });

    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "queued",
        status: "failed",
        messageKey: "discovery.queued.failed",
      }),
    );
  });

  it("transitions session to failed when enqueue fails", async () => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    repository.updateStatusIfCurrent.mockResolvedValue(true);
    queueProducer.enqueueResearch.mockRejectedValue(
      new ProviderError(
        "DISCOVERY_ENQUEUE_FAILED",
        "Redis connection refused",
        true,
      ),
    );

    await expect(
      service.startPreparedDiscovery("owner-id", discoveryDto()),
    ).rejects.toMatchObject({ status: 503 });

    expect(repository.updateStatusIfCurrent).toHaveBeenCalledWith(
      SESSION_ID,
      ["researching"],
      "failed",
    );
  });

  it("does not run background research inline", async () => {
    repository.createPreparedSession.mockResolvedValue(session() as never);
    queueProducer.enqueueResearch.mockResolvedValue(undefined);

    await service.startPreparedDiscovery("owner-id", discoveryDto());

    // The old inline background work is gone; only enqueue is called.
    expect(queueProducer.enqueueResearch).toHaveBeenCalledTimes(1);
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

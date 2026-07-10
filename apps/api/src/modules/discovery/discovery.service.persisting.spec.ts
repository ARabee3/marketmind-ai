import { DiscoveryConversationRepository } from "./discovery-conversation.repository";
import { DiscoveryProgressGateway } from "./discovery-progress.gateway";
import { DiscoveryQueueProducer } from "./discovery-queue.producer";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("DiscoveryService persistence progress", () => {
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

  beforeEach(() => {
    jest.resetAllMocks();
    repository.createPreparedSession.mockResolvedValue({
      id: SESSION_ID,
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
    } as never);
    queueProducer.enqueueResearch.mockResolvedValue(undefined);
  });

  it("records session and queued progress events on start", async () => {
    const service = new DiscoveryService(
      repository,
      conversationRepository,
      progressGateway,
      queueProducer,
    );

    await service.startPreparedDiscovery("owner-id", discoveryDto());

    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "session",
        status: "completed",
        messageKey: "discovery.session.accepted",
      }),
    );
    expect(repository.appendProgressEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({
        stage: "queued",
        status: "started",
        messageKey: "discovery.queued.started",
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

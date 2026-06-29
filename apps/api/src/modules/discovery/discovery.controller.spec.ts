import { Test, TestingModule } from "@nestjs/testing";
import { DiscoveryConversationService } from "./discovery-conversation.service";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

describe("DiscoveryController", () => {
  const service = {
    startPreparedDiscovery: jest.fn(),
    getStatus: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryService>;
  const conversationService = {
    respondToDiscovery: jest.fn(),
    summarizeDiscovery: jest.fn(),
    confirmProfile: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryConversationService>;

  let controller: DiscoveryController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscoveryController],
      providers: [
        { provide: DiscoveryService, useValue: service },
        { provide: DiscoveryConversationService, useValue: conversationService },
      ],
    }).compile();

    controller = module.get<DiscoveryController>(DiscoveryController);
  });

  it("starts discovery for the authenticated owner", async () => {
    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
      },
    };
    service.startPreparedDiscovery.mockResolvedValue({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      progress_ws_url:
        "/ws/v1/discovery/11111111-1111-4111-8111-111111111111/progress",
      status_url:
        "/api/v1/discovery/11111111-1111-4111-8111-111111111111/status",
      accepted_at: "2026-06-29T10:00:00.000Z",
    });

    const result = await controller.start(
      { user: { id: "owner-id", email: "owner@example.com", roles: [] } } as never,
      dto,
    );

    expect(result.status).toBe("researching");
    expect(service.startPreparedDiscovery).toHaveBeenCalledWith("owner-id", dto);
  });

  it("reads status for the authenticated owner", async () => {
    service.getStatus.mockResolvedValue({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      language_mode: LanguageModeDto.Mixed,
      intake_summary: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
      },
      intelligence: {
        status: "running",
        search_mode: "metadata_only",
        source_refs: [],
        research_observations: [],
        conversation_hooks: [],
        knowledge_gaps: [],
      },
      messages: [],
      progress_events: [],
      strategy_locked: true,
    });

    const result = await controller.status(
      { user: { id: "owner-id", email: "owner@example.com", roles: [] } } as never,
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result.session_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(service.getStatus).toHaveBeenCalledWith(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );
  });
});

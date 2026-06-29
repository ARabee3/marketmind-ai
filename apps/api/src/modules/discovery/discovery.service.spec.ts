import { NotFoundException } from "@nestjs/common";
import { DiscoveryRepository } from "./discovery.repository";
import { DiscoveryService } from "./discovery.service";
import { LanguageModeDto, StartDiscoveryDto } from "./dto/start-discovery.dto";

describe("DiscoveryService", () => {
  const repository = {
    createPreparedSession: jest.fn(),
    findSessionForOwner: jest.fn(),
  } as unknown as jest.Mocked<DiscoveryRepository>;

  let service: DiscoveryService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new DiscoveryService(repository);
  });

  it("returns accepted start response for a prepared discovery session", async () => {
    repository.createPreparedSession.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
    } as never);

    const dto: StartDiscoveryDto = {
      language_mode: LanguageModeDto.Mixed,
      intake: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
        area: "Nasr City",
      },
    };

    await expect(service.startPreparedDiscovery("owner-id", dto)).resolves.toEqual({
      session_id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      progress_ws_url:
        "/ws/v1/discovery/11111111-1111-4111-8111-111111111111/progress",
      status_url:
        "/api/v1/discovery/11111111-1111-4111-8111-111111111111/status",
      accepted_at: "2026-06-29T10:00:00.000Z",
    });
    expect(repository.createPreparedSession).toHaveBeenCalledWith("owner-id", dto);
  });

  it("returns status with empty running intelligence before gatherer is wired", async () => {
    repository.findSessionForOwner.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      status: "researching",
      languageMode: "mixed",
      currentQuestion: null,
      startedAt: new Date("2026-06-29T10:00:00.000Z"),
      intakes: [
        {
          businessName: "Koshary Corner",
          businessType: "quick service restaurant",
          city: "Cairo",
          area: "Nasr City",
        },
      ],
    } as never);

    const status = await service.getStatus(
      "owner-id",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(status.status).toBe("researching");
    expect(status.intake_summary).toEqual({
      business_name: "Koshary Corner",
      business_type: "quick service restaurant",
      city: "Cairo",
      area: "Nasr City",
    });
    expect(status.intelligence).toEqual({
      status: "running",
      search_mode: "metadata_only",
      source_refs: [],
      research_observations: [],
      conversation_hooks: [],
      knowledge_gaps: [],
    });
  });

  it("surfaces missing sessions from the repository", async () => {
    repository.findSessionForOwner.mockRejectedValue(
      new NotFoundException("Discovery session not found"),
    );

    await expect(
      service.getStatus("owner-id", "11111111-1111-4111-8111-111111111111"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

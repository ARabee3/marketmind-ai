import { Test, TestingModule } from "@nestjs/testing";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { JourneyController } from "./journey.controller";
import { JourneyService } from "./journey.service";
import { PERMISSIONS_KEY } from "../rbac/decorators/permissions.decorator";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { PERMISSIONS } from "../rbac/rbac.constants";
import { RbacService } from "../rbac/rbac.service";

describe("JourneyController", () => {
  const journeyService = {
    getCurrent: jest.fn(),
  } as unknown as jest.Mocked<JourneyService>;

  let controller: JourneyController;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JourneyController],
      providers: [
        { provide: JourneyService, useValue: journeyService },
        RbacService,
      ],
    }).compile();

    controller = module.get<JourneyController>(JourneyController);
  });

  it("reads the current journey for the authenticated owner", async () => {
    journeyService.getCurrent.mockResolvedValue({
      owner: {
        user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        full_name: "Ahmed Hassan",
        email: "owner@example.com",
        email_verified: true,
      },
      journey: { state: "no_journey", discovery: null, profile: null },
      future_phase: {
        phase: "strategy",
        availability: "locked",
        status: "needs_brief",
        reason: "discovery_required",
        destination: null,
      },
      primary_action: {
        type: "start_discovery",
        destination: "/discovery/new",
      },
      generated_at: "2026-07-17T10:00:00.000Z",
    });

    const response = await controller.current({
      user: { id: "owner-id", email: "owner@example.com", roles: [] },
    } as never);

    expect(response.journey.state).toBe("no_journey");
    expect(journeyService.getCurrent).toHaveBeenCalledWith("owner-id");
  });

  it("declares business read permission", () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        JourneyController.prototype.current,
      ),
    ).toEqual([PERMISSIONS.BUSINESS_READ]);
  });

  it("runs the permissions guard on journey routes", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, JourneyController);

    expect(guards).toContain(PermissionsGuard);
  });
});

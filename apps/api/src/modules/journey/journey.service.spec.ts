import type { CurrentJourneyResponse } from "@marketmind/contracts";
import { JourneyService } from "./journey.service";
import type {
  JourneyCurrentRecord,
  JourneyRepositoryPort,
} from "./journey.repository";
import { emptyDiscoveryProfileState } from "../discovery/market-profile";

describe("JourneyService", () => {
  const repository: jest.Mocked<JourneyRepositoryPort> = {
    findCurrentForOwner: jest.fn(),
  };

  let service: JourneyService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new JourneyService(repository);
  });

  it("returns a start discovery action when the owner has no journey", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: null,
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("no_journey");
    expect(response.primary_action).toEqual({
      type: "start_discovery",
      destination: "/discovery/new",
    });
    expect(response.future_phase.reason).toBe("discovery_required");
  });

  it("returns a continue action for active discovery sessions", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({ status: "ready_for_chat" }),
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("discovery_active");
    expect(response.primary_action).toEqual({
      type: "continue_discovery",
      session_id: "11111111-1111-4111-8111-111111111111",
      destination: "/discovery/11111111-1111-4111-8111-111111111111",
    });
  });

  it("returns a review action when the discovery summary is ready", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({ status: "summary_ready" }),
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("discovery_summary_review");
    expect(response.primary_action.type).toBe("review_profile");
    expect(response.future_phase.reason).toBe("profile_review_required");
  });

  it("returns confirmed profile context for confirmed sessions", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("discovery_confirmed");
    expect(response.journey.profile).toEqual({
      business_profile_version_id: "22222222-2222-4222-8222-222222222222",
      business_id: "33333333-3333-4333-8333-333333333333",
      version: 2,
      business_name: "Nile Sweets",
      business_type: "dessert shop",
      city: "Assiut",
      area: "Assiut City",
      confirmed_at: "2026-07-17T10:05:00.000Z",
    });
    expect(response.future_phase.reason).toBe("strategy_not_active");
  });

  it("keeps failed sessions unavailable without leaking strategy access", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({ status: "failed" }),
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("discovery_unavailable");
    expect(response.primary_action).toEqual({
      type: "start_discovery",
      destination: "/discovery/new",
    });
    expect(response.future_phase.availability).toBe("locked");
  });

  it("keeps another owner session invisible when the repository returns no session", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: null,
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.discovery).toBeNull();
    expect(response.primary_action.type).toBe("start_discovery");
  });

  it("keeps missing business facts null instead of fabricating Unknown values", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "failed",
        intake: null,
        confirmedProfile: null,
      }),
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("discovery_unavailable");
    const summary = response.journey.discovery!.business_summary;
    expect(summary.business_name).toBeNull();
    expect(summary.business_type).toBeNull();
    expect(summary.city).toBeNull();
    expect(summary.area).toBeNull();
    expect(JSON.stringify(summary)).not.toContain("Unknown");
  });
});

function ownerRecord(): JourneyCurrentRecord["owner"] {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    fullName: "Ahmed Hassan",
    email: "owner@example.com",
    isEmailVerified: true,
  };
}

function sessionRecord(
  overrides: Partial<JourneyCurrentRecord["session"]> = {},
): NonNullable<JourneyCurrentRecord["session"]> {
  const profileState = emptyDiscoveryProfileState();

  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "researching",
    languageMode: "ar-EG",
    ownerTurnCount: 3,
    profileState: {
      ...profileState,
      readiness: {
        ...profileState.readiness,
        ready: false,
        profile_readiness: 0.45,
        owner_turn_count: 3,
        max_owner_turns: 15,
      },
    },
    profileDraftId: null,
    confirmedProfileVersionId: null,
    updatedAt: new Date("2026-07-17T10:00:00.000Z"),
    completedAt: null,
    intake: {
      businessName: "Nile Sweets",
      businessType: "dessert shop",
      city: "Assiut",
      area: "Assiut City",
    },
    confirmedProfile: null,
    ...overrides,
  };
}

function confirmedProfileRecord(): NonNullable<
  NonNullable<JourneyCurrentRecord["session"]>["confirmedProfile"]
> {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    businessId: "33333333-3333-4333-8333-333333333333",
    version: 2,
    confirmedAt: new Date("2026-07-17T10:05:00.000Z"),
    business: {
      displayName: "Nile Sweets",
      businessType: "dessert shop",
      city: "Assiut",
      area: "Assiut City",
    },
  };
}

function assertResponse(_response: CurrentJourneyResponse): void {}

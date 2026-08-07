import type { CurrentJourneyResponse } from "@marketmind/contracts";
import { JourneyService } from "./journey.service";
import type {
  JourneyContentRecord,
  JourneyCurrentRecord,
  JourneyRepositoryPort,
} from "./journey.repository";
import { emptyDiscoveryProfileState } from "../discovery/market-profile";

describe("JourneyService", () => {
  const repository: jest.Mocked<JourneyRepositoryPort> = {
    findCurrentForOwner: jest.fn(),
    findContentForOwner: jest.fn(),
  };

  let service: JourneyService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new JourneyService(repository);
    repository.findContentForOwner.mockResolvedValue({
      cycle: null,
      pack: null,
    });
  });

  it("returns a start discovery action when the owner has no journey", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: null,
      strategy: null,
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
      strategy: null,
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
      strategy: null,
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
      strategy: null,
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

  it("uses the confirmed profile identity for confirmed session summaries", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        intake: {
          businessName: "Old Cafe",
          businessType: "cafe",
          city: "Cairo",
          area: "Downtown",
        },
        confirmedProfile: {
          ...confirmedProfileRecord(),
          business: {
            displayName: "New Cafe",
            businessType: "restaurant",
            city: "Giza",
            area: "Dokki",
          },
        },
      }),
      strategy: null,
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.journey.state).toBe("discovery_confirmed");
    const summary = response.journey.discovery!.business_summary;
    expect(summary).toEqual({
      business_name: "New Cafe",
      business_type: "restaurant",
      city: "Giza",
      area: "Dokki",
    });
  });

  it("keeps failed sessions unavailable without leaking strategy access", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({ status: "failed" }),
      strategy: null,
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
      strategy: null,
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
      strategy: null,
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

  it("routes the owner to an active strategy via view_strategy action", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
      strategy: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "draft",
        currentVersionId: "55555555-5555-4555-8555-555555555555",
        business: strategyBusinessRecord(),
      },
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.primary_action).toEqual({
      type: "view_strategy",
      strategy_id: "44444444-4444-4444-8444-444444444444",
      destination: "/strategy/44444444-4444-4444-8444-444444444444",
    });
    expect(response.future_phase.availability).toBe("available");
    expect(response.future_phase.reason).toBe("strategy_active");
    if (response.future_phase.availability === "available") {
      expect(response.future_phase.business).toEqual({
        business_name: "Nile Sweets",
        business_type: "dessert shop",
        city: "Assiut",
        area: "Assiut City",
        profile_version: 2,
      });
    }
  });

  it("keeps an absent strategy snapshot null so clients can use the journey profile", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
      strategy: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "draft",
        currentVersionId: "55555555-5555-4555-8555-555555555555",
        business: null,
      },
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.future_phase.availability).toBe("available");
    if (response.future_phase.availability === "available") {
      expect(response.future_phase.business).toBeNull();
    }
  });

  it("routes a rejected strategy back to its workspace for revision", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
      strategy: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "rejected",
        currentVersionId: "55555555-5555-4555-8555-555555555555",
        business: strategyBusinessRecord(),
      },
    });

    const response = await service.getCurrent("owner-id");

    expect(response.primary_action.type).toBe("view_strategy");
    expect(response.future_phase.status).toBe("rejected");
  });

  it("falls back to the discovery action when the strategy is needs_brief or failed", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
      strategy: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "needs_brief",
        currentVersionId: null,
        business: null,
      },
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.primary_action.type).toBe("view_discovery");
    expect(response.future_phase.availability).toBe("unavailable");
  });

  it("reports content readiness as no_cycle when the owner has no content cycle", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: null,
      strategy: null,
    });
    repository.findContentForOwner.mockResolvedValue({
      cycle: null,
      pack: null,
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.content).toEqual({
      ready: false,
      reason: "no_cycle",
      cycle: null,
      pack: null,
    });
  });

  it("reports pending_decisions for an active cycle with a draft pack", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
      strategy: null,
    });
    repository.findContentForOwner.mockResolvedValue({
      cycle: contentCycleRecord(),
      pack: {
        id: "77777777-7777-4777-8777-777777777777",
        status: "draft",
        weekNumber: 1,
        pendingDecisions: 2,
      },
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.content.ready).toBe(true);
    expect(response.content.reason).toBe("cycle_active");
    if (response.content.pack) {
      expect(response.content.pack.pending_decisions).toBe(2);
    }
  });

  it("reports a failed pack with failed: true", async () => {
    repository.findCurrentForOwner.mockResolvedValue({
      owner: ownerRecord(),
      session: sessionRecord({
        status: "confirmed",
        confirmedProfile: confirmedProfileRecord(),
      }),
      strategy: null,
    });
    repository.findContentForOwner.mockResolvedValue({
      cycle: contentCycleRecord(),
      pack: {
        id: "77777777-7777-4777-8777-777777777777",
        status: "failed",
        weekNumber: 1,
        pendingDecisions: 0,
      },
    });

    const response = await service.getCurrent("owner-id");
    assertResponse(response);

    expect(response.content.ready).toBe(true);
    if (response.content.pack) {
      expect(response.content.pack.failed).toBe(true);
    }
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

function contentCycleRecord(): NonNullable<JourneyContentRecord["cycle"]> {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    status: "active",
    currentWeekNumber: 1,
  };
}

function strategyBusinessRecord(): NonNullable<
  NonNullable<JourneyCurrentRecord["strategy"]>["business"]
> {
  return {
    businessName: "Nile Sweets",
    businessType: "dessert shop",
    city: "Assiut",
    area: "Assiut City",
    profileVersion: 2,
  };
}

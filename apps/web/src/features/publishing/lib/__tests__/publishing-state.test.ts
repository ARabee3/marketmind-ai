import { describe, expect, it } from "vitest";
import type {
  CurrentJourneyResponse,
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublishingTargetPublicV1,
} from "@marketmind/contracts";
import {
  activeIntentForCandidate,
  localCairoToUtc,
  publishingSetupAction,
  publishingStatusRefreshDelay,
  realIntentForCandidate,
  targetSupportsCandidate,
} from "../publishing-state";

const candidate = {
  candidate: { candidate_id: "candidate-1" },
  active_intent_id: "intent-cancelled",
} as unknown as PublicationCandidateSummaryV1;

function intent(
  state: PublicationIntentV1["state"],
  intentId: string,
  mode: PublicationIntentV1["mode"] = "real",
): PublicationIntentV1 {
  return {
    contract_version: "publication-intent-v1",
    intent_id: intentId,
    version: 1,
    business_id: "business-1",
    candidate_id: "candidate-1",
    candidate_checksum: "checksum",
    mode,
    target_id: null,
    scheduled_local: null,
    time_zone: null,
    scheduled_utc: null,
    state,
    approved_decision_id: null,
    created_by_user_id: "owner-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("publishing state helpers", () => {
  it("resolves Cairo winter time with the UTC+02 offset", () => {
    expect(localCairoToUtc("2026-01-15T12:00")).toBe(
      "2026-01-15T10:00:00.000Z",
    );
  });

  it("resolves Cairo summer time with the UTC+03 offset", () => {
    expect(localCairoToUtc("2026-08-15T12:00")).toBe(
      "2026-08-15T09:00:00.000Z",
    );
  });

  it("refreshes dispatching intents frequently", () => {
    expect(
      publishingStatusRefreshDelay(intent("dispatching", "intent-running")),
    ).toBe(4_000);
  });

  it("wakes scheduled intents near their due time without constant polling", () => {
    const scheduled = {
      ...intent("scheduled", "intent-scheduled"),
      scheduled_utc: "2026-08-09T13:03:00.000Z",
    };

    expect(
      publishingStatusRefreshDelay(
        scheduled,
        Date.parse("2026-08-09T12:53:00.000Z"),
      ),
    ).toBe(60_000);
    expect(
      publishingStatusRefreshDelay(
        scheduled,
        Date.parse("2026-08-09T13:03:01.000Z"),
      ),
    ).toBe(4_000);
  });

  it("stops automatic status refresh after a terminal result", () => {
    expect(
      publishingStatusRefreshDelay(intent("succeeded", "intent-done")),
    ).toBeNull();
  });

  it("does not resurrect a cancelled intent from a stale active-intent id", () => {
    expect(
      activeIntentForCandidate(candidate, [
        intent("cancelled", "intent-cancelled"),
      ]),
    ).toBeNull();
  });

  it("falls back to the real lifecycle when a local terminal id is stale", () => {
    expect(
      activeIntentForCandidate(candidate, [
        intent("succeeded", "intent-cancelled", "manual_export"),
        intent("scheduled", "intent-real"),
      ])?.intent_id,
    ).toBe("intent-real");
  });

  it("selects a non-terminal intent when no active id is supplied", () => {
    const withoutActiveId = { ...candidate, active_intent_id: null };
    expect(
      activeIntentForCandidate(withoutActiveId, [
        intent("succeeded", "intent-done"),
        intent("failed", "intent-failed"),
      ])?.intent_id,
    ).toBe("intent-failed");
  });

  it("keeps a completed export separate from the protected real lifecycle", () => {
    const exportIntent = intent("succeeded", "intent-export", "manual_export");
    const realIntent = intent("scheduled", "intent-real");

    expect(
      realIntentForCandidate(candidate, [exportIntent, realIntent])?.intent_id,
    ).toBe("intent-real");
    expect(realIntentForCandidate(candidate, [exportIntent])).toBeNull();
  });

  it("matches Facebook capabilities to text and static-image posts", () => {
    const target = {
      channel: "facebook",
      capabilities: ["static_image", "text"],
    } as unknown as PublishingTargetPublicV1;
    const textCandidate = {
      candidate: { target_channel: "facebook", content_format: "text_post" },
    } as PublicationCandidateSummaryV1;
    const imageCandidate = {
      candidate: {
        target_channel: "facebook",
        content_format: "static_image_post",
      },
    } as PublicationCandidateSummaryV1;

    expect(targetSupportsCandidate(target, textCandidate)).toBe(true);
    expect(targetSupportsCandidate(target, imageCandidate)).toBe(true);
  });

  it("routes a first-time owner to start discovery", () => {
    expect(
      publishingSetupAction(
        journeyWithPrimaryAction({ type: "start_discovery", destination: "/discovery/new" }),
      ),
    ).toEqual({ destination: "/discovery/new", labelKey: "startDiscovery" });
  });

  it("routes an owner mid-interview back to continue discovery", () => {
    expect(
      publishingSetupAction(
        journeyWithPrimaryAction({
          type: "continue_discovery",
          session_id: "session-1",
          destination: "/discovery/interview/session-1",
        }),
      ),
    ).toEqual({
      destination: "/discovery/interview/session-1",
      labelKey: "continueDiscovery",
    });
  });

  it("routes an owner with a draft profile to review it", () => {
    expect(
      publishingSetupAction(
        journeyWithPrimaryAction({
          type: "review_profile",
          session_id: "session-1",
          destination: "/discovery/review/session-1",
        }),
      ),
    ).toEqual({
      destination: "/discovery/review/session-1",
      labelKey: "reviewProfile",
    });
  });

  it("routes an owner with a confirmed profile to the content strategy", () => {
    expect(
      publishingSetupAction(
        journeyWithPrimaryAction({
          type: "view_strategy",
          strategy_id: "strategy-1",
          destination: "/strategy/strategy-1",
        }),
      ),
    ).toEqual({ destination: "/strategy/strategy-1", labelKey: "viewStrategy" });
  });

  it("falls back to start discovery when the journey has no action", () => {
    expect(
      publishingSetupAction(journeyWithPrimaryAction({ type: "none", destination: null })),
    ).toEqual({ destination: "/discovery/new", labelKey: "startDiscovery" });
  });
});

function journeyWithPrimaryAction(
  primaryAction: CurrentJourneyResponse["primary_action"],
): CurrentJourneyResponse {
  return {
    owner: {
      user_id: "owner-1",
      full_name: null,
      email: "owner@example.com",
      email_verified: true,
    },
    journey: {
      state: "no_journey",
      discovery: null,
      profile: null,
    },
    future_phase: {
      phase: "strategy",
      availability: "locked",
      status: "needs_brief",
      reason: "discovery_required",
      destination: null,
    },
    primary_action: primaryAction,
    generated_at: "2026-01-01T00:00:00.000Z",
  };
}

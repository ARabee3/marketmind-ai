import { describe, expect, it } from "vitest";
import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
} from "@marketmind/contracts";
import { activeIntentForCandidate, localCairoToUtc } from "../publishing-state";

const candidate = {
  candidate: { candidate_id: "candidate-1" },
  active_intent_id: "intent-cancelled",
} as unknown as PublicationCandidateSummaryV1;

function intent(
  state: PublicationIntentV1["state"],
  intentId: string,
): PublicationIntentV1 {
  return {
    contract_version: "publication-intent-v1",
    intent_id: intentId,
    version: 1,
    business_id: "business-1",
    candidate_id: "candidate-1",
    candidate_checksum: "checksum",
    mode: "real",
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

  it("does not resurrect a cancelled intent from a stale active-intent id", () => {
    expect(
      activeIntentForCandidate(candidate, [
        intent("cancelled", "intent-cancelled"),
      ]),
    ).toBeNull();
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
});

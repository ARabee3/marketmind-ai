import { describe, expect, it } from "vitest";
import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
} from "@marketmind/contracts";
import { statusForWeek } from "../publication-runway";

function candidate(candidateId: string): PublicationCandidateSummaryV1 {
  return {
    source_state: "active",
    candidate: { candidate_id: candidateId },
  } as PublicationCandidateSummaryV1;
}

function intent(
  candidateId: string,
  mode: PublicationIntentV1["mode"],
  state: PublicationIntentV1["state"],
): PublicationIntentV1 {
  return { candidate_id: candidateId, mode, state } as PublicationIntentV1;
}

describe("PublicationRunway weekly aggregation", () => {
  it("does not mark a week published when only one of three posts is published", () => {
    const candidates = [candidate("one"), candidate("two"), candidate("three")];

    expect(
      statusForWeek(candidates, [intent("one", "real", "succeeded")]),
    ).toBe("needsDecision");
  });

  it("does not let export or simulation replace the real publication state", () => {
    const candidates = [candidate("one")];
    const localIntents = [
      intent("one", "manual_export", "succeeded"),
      intent("one", "simulation", "succeeded"),
    ];

    expect(statusForWeek(candidates, localIntents)).toBe("needsDecision");
  });

  it("marks a week published only when every active post succeeded for real", () => {
    const candidates = [candidate("one"), candidate("two"), candidate("three")];
    const realIntents = candidates.map((entry) =>
      intent(entry.candidate.candidate_id, "real", "succeeded"),
    );

    expect(statusForWeek(candidates, realIntents)).toBe("published");
  });
});

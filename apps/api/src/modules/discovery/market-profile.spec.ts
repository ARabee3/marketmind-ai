import { ResearchObservation } from "./discovery-state";
import {
  emptyMarketAwareBusinessFacts,
  marketContextFromObservations,
} from "./market-profile";

describe("market profile mapping", () => {
  it("starts with every required marketing domain", () => {
    expect(Object.keys(emptyMarketAwareBusinessFacts())).toEqual([
      "identity",
      "offer",
      "customers",
      "differentiation",
      "current_marketing",
      "goals_and_constraints",
    ]);
  });

  it("groups only accepted cited observations into market context", () => {
    const observations: ResearchObservation[] = [
      observation("competitor-1", "competitor", "source-1"),
      observation("market-1", "market_context", "source-2"),
      observation("social-1", "social_signal", "source-3"),
      {
        ...observation("discarded-1", "competitor", "source-4"),
        status: "discarded",
        discard_reason: "Wrong business.",
      },
      observation("uncited-1", "market_context"),
    ];

    const context = marketContextFromObservations(observations);

    expect(
      context.competitor_landscape.map((item) => item.observation_id),
    ).toEqual(["competitor-1"]);
    expect(
      context.local_demand_signals.map((item) => item.observation_id),
    ).toEqual(["market-1"]);
    expect(
      context.digital_presence_signals.map((item) => item.observation_id),
    ).toEqual(["social-1"]);
  });
});

function observation(
  id: string,
  kind: ResearchObservation["kind"],
  sourceRefId?: string,
): ResearchObservation {
  return {
    id,
    source_ref_id: sourceRefId,
    kind,
    statement: `${kind} evidence`,
    confidence: 0.8,
    visibility: "internal",
    status: "accepted",
    metadata: {},
  };
}

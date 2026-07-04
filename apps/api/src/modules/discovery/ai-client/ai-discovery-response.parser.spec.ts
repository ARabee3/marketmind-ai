import { ProviderError } from "../../../common/errors/provider-error";
import { ResearchObservation } from "../discovery-state";
import {
  emptyDiscoveryDomainScores,
  emptyMarketAwareBusinessFacts,
  marketContextFromObservations,
} from "../market-profile";
import { parseAiDiscoveryResult } from "./ai-discovery-response.parser";

describe("parseAiDiscoveryResult", () => {
  it("accepts a canonical question response", () => {
    expect(parseAiDiscoveryResult(questionResult())).toMatchObject({
      action: "ask_next_question",
      next_question: "Who are your best current customers?",
    });
  });

  it("rejects question actions without a question", () => {
    expectInvalid({
      ...questionResult(),
      next_question: undefined,
    });
  });

  it("rejects incomplete canonical uncertainties", () => {
    expectInvalid({
      ...questionResult(),
      updated_uncertainties: [
        {
          field_key: "audience",
          description: "Audience is unknown.",
          severity: "medium",
        },
      ],
    });
  });

  it("rejects observations that violate evidence rules", () => {
    expectInvalid({
      ...questionResult(),
      research_observations: [
        {
          id: "observation-1",
          kind: "competitor",
          statement: "A discarded match.",
          confidence: 0.3,
          visibility: "internal",
          status: "discarded",
          metadata: {},
        },
      ],
    });
    expectInvalid({
      ...questionResult(),
      research_observations: [
        {
          id: "observation-2",
          kind: "competitor",
          statement: "An owner-visible claim without a citation.",
          confidence: 0.8,
          visibility: "owner_visible",
          status: "accepted",
          metadata: {},
        },
      ],
    });
  });

  it("rejects malformed nested profile drafts", () => {
    expectInvalid({
      ...questionResult(),
      action: "produce_profile_draft",
      next_question: undefined,
      profile_draft: {
        id: "draft-1",
        session_id: "session-1",
        version: 1,
        status: "ready_for_confirmation",
        confirmed_facts: emptyMarketAwareBusinessFacts(),
        market_context: marketContextFromObservations([]),
        research_observations: [],
        uncertainties: [
          {
            field_key: "audience",
            description: "Audience is unknown.",
            severity: "medium",
            category: "owner_unknown",
            source: "owner_unknown",
          },
        ],
        owner_goals: [],
        strategy_relevant_notes: [],
        raw_ai_output: {},
      },
    });
  });

  it("rejects market context that rewrites cited evidence", () => {
    const observation: ResearchObservation = {
      id: "observation-1",
      source_ref_id: "source-1",
      kind: "competitor",
      statement: "A nearby restaurant appears in local search.",
      confidence: 0.8,
      visibility: "owner_visible",
      status: "accepted",
      metadata: {},
    };

    expectInvalid({
      ...questionResult(),
      action: "produce_profile_draft",
      next_question: undefined,
      research_observations: [observation],
      profile_draft: {
        id: "draft-1",
        session_id: "session-1",
        version: 1,
        status: "ready_for_confirmation",
        confirmed_facts: emptyMarketAwareBusinessFacts(),
        market_context: {
          ...marketContextFromObservations([observation]),
          competitor_landscape: [
            {
              observation_id: "observation-1",
              source_ref_id: "source-1",
              statement: "The business is definitely the market leader.",
              confidence: 0.8,
            },
          ],
        },
        research_observations: [observation],
        uncertainties: [],
        owner_goals: [],
        strategy_relevant_notes: [],
        raw_ai_output: {},
      },
    });
  });
});

function questionResult(): Record<string, unknown> {
  return {
    action: "ask_next_question",
    next_question: "Who are your best current customers?",
    updated_known_facts: emptyMarketAwareBusinessFacts(),
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: emptyDiscoveryDomainScores(),
    ready_to_summarize: false,
  };
}

function expectInvalid(value: unknown): void {
  try {
    parseAiDiscoveryResult(value);
    throw new Error("Expected parser to reject invalid output.");
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: "AI_DISCOVERY_INVALID_OUTPUT" });
  }
}

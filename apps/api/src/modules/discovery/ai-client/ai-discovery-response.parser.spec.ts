import { ProviderError } from "../../../common/errors/provider-error";
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
        confirmed_facts: {},
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
});

function questionResult(): Record<string, unknown> {
  return {
    action: "ask_next_question",
    next_question: "Who are your best current customers?",
    updated_known_facts: {},
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: {},
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

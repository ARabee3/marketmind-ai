import { AiDiscoveryResult } from "./discovery-state";
import { DiscoveryReadinessService } from "./discovery-readiness.service";
import { emptyMarketAwareBusinessFacts } from "./market-profile";

describe("DiscoveryReadinessService", () => {
  const service = new DiscoveryReadinessService();

  it("accepts balanced owner-business coverage without requiring research", () => {
    const state = service.evaluate(readyResult(), 7);

    expect(state.readiness).toMatchObject({
      ready: true,
      llm_recommended: true,
      blocking_domains: [],
      owner_turn_count: 7,
      max_owner_turns: 15,
    });
    expect(state.readiness.domain_scores.research_confidence).toBe(0);
    expect(state.readiness.domain_scores.market_context).toBe(0);
  });

  it("rejects an overconfident recommendation when structural facts are absent", () => {
    const result = readyResult();
    result.updated_known_facts.offer.core_offerings = [];

    const state = service.evaluate(result, 4);

    expect(state.readiness.ready).toBe(false);
    expect(state.readiness.blocking_domains).toContain("offer");
  });

  it("allows explicit owner unknowns for differentiation and current marketing", () => {
    const result = readyResult();
    result.updated_known_facts.differentiation.owner_claimed_strengths = [];
    result.updated_known_facts.current_marketing.active_channels = [];
    result.domain_scores.differentiation = 0.2;
    result.domain_scores.current_marketing = 0.2;
    result.updated_uncertainties = [
      ownerUnknown("differentiation"),
      ownerUnknown("current_marketing"),
    ];

    const state = service.evaluate(result, 6);

    expect(state.readiness.ready).toBe(true);
    expect(state.readiness.blocking_domains).not.toContain("differentiation");
    expect(state.readiness.blocking_domains).not.toContain("current_marketing");
  });

  it("blocks unresolved high-severity contradictions", () => {
    const result = readyResult();
    result.updated_uncertainties = [
      {
        domain: "customers",
        field_key: "customers.primary_segments",
        description: "The owner gave conflicting customer descriptions.",
        severity: "high",
        category: "contradiction",
        source: "owner_answer",
      },
    ];

    const state = service.evaluate(result, 8);

    expect(state.readiness.ready).toBe(false);
    expect(state.readiness.blocking_domains).toContain("customers");
  });
});

function readyResult(): AiDiscoveryResult {
  const facts = emptyMarketAwareBusinessFacts();
  return {
    action: "ask_next_question",
    next_question: "What is the most important remaining detail?",
    ready_to_summarize: true,
    updated_known_facts: {
      ...facts,
      identity: {
        business_name: "Koshary Corner",
        business_type: "quick service restaurant",
        city: "Cairo",
      },
      offer: {
        ...facts.offer,
        core_offerings: ["koshary bowls"],
      },
      customers: {
        ...facts.customers,
        primary_segments: ["office workers"],
        visit_or_order_occasions: ["weekday lunch"],
      },
      differentiation: {
        ...facts.differentiation,
        owner_claimed_strengths: ["fast lunch service"],
      },
      current_marketing: {
        ...facts.current_marketing,
        active_channels: ["instagram"],
      },
      goals_and_constraints: {
        ...facts.goals_and_constraints,
        growth_goals: ["increase weekday lunch orders"],
        team_capacity: "owner plus one team member",
      },
    },
    updated_uncertainties: [],
    research_observations: [],
    source_refs: [],
    domain_scores: {
      identity: 0.95,
      offer: 0.75,
      customers: 0.8,
      differentiation: 0.65,
      current_marketing: 0.65,
      goals_and_constraints: 0.75,
      market_context: 0,
      research_confidence: 0,
      profile_readiness: 0.85,
    },
  };
}

function ownerUnknown(
  domain: "differentiation" | "current_marketing",
): AiDiscoveryResult["updated_uncertainties"][number] {
  return {
    domain,
    field_key: `${domain}.unknown`,
    description: `The owner does not know the ${domain} detail.`,
    severity: "medium",
    category: "owner_unknown",
    source: "owner_unknown",
  };
}

import {
  DiscoveryDomainScores,
  MarketAwareBusinessFacts,
  MarketContextSnapshot,
  MarketEvidence,
  ResearchObservation,
} from "./discovery-state";

export function emptyDiscoveryDomainScores(): DiscoveryDomainScores {
  return {
    identity: 0,
    offer: 0,
    customers: 0,
    differentiation: 0,
    current_marketing: 0,
    goals_and_constraints: 0,
    market_context: 0,
    research_confidence: 0,
    profile_readiness: 0,
  };
}

export function emptyMarketAwareBusinessFacts(): MarketAwareBusinessFacts {
  return {
    identity: {},
    offer: {
      core_offerings: [],
      best_sellers: [],
      purchase_occasions: [],
    },
    customers: {
      primary_segments: [],
      visit_or_order_occasions: [],
      peak_periods: [],
      customer_needs: [],
    },
    differentiation: {
      owner_claimed_strengths: [],
      customer_choice_reasons: [],
      proof_points: [],
    },
    current_marketing: {
      active_channels: [],
      current_activities: [],
      delivery_platforms: [],
      available_assets: [],
    },
    goals_and_constraints: {
      growth_goals: [],
      operational_constraints: [],
    },
  };
}

export function marketContextFromObservations(
  observations: readonly ResearchObservation[],
): MarketContextSnapshot {
  const context: MarketContextSnapshot = {
    competitor_landscape: [],
    local_demand_signals: [],
    digital_presence_signals: [],
    other_signals: [],
  };

  for (const observation of observations) {
    if (observation.status !== "accepted" || !observation.source_ref_id) {
      continue;
    }

    const evidence: MarketEvidence = {
      observation_id: observation.id,
      source_ref_id: observation.source_ref_id,
      statement: observation.statement,
      confidence: observation.confidence,
    };
    switch (observation.kind) {
      case "competitor":
        context.competitor_landscape.push(evidence);
        break;
      case "market_context":
        context.local_demand_signals.push(evidence);
        break;
      case "digital_presence":
      case "social_signal":
        context.digital_presence_signals.push(evidence);
        break;
      case "metadata":
        context.other_signals.push(evidence);
        break;
    }
  }

  return context;
}

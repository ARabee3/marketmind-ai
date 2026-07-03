import { Injectable } from "@nestjs/common";
import {
  AiDiscoveryResult,
  DiscoveryProfileState,
  DiscoveryReadiness,
  MarketAwareBusinessFacts,
  ProfileUncertainty,
} from "./discovery-state";
import { MAX_DISCOVERY_OWNER_TURNS } from "./market-profile";

const PROFILE_READINESS_THRESHOLD = 0.8;

@Injectable()
export class DiscoveryReadinessService {
  evaluate(
    result: Pick<
      AiDiscoveryResult,
      | "updated_known_facts"
      | "updated_uncertainties"
      | "domain_scores"
      | "ready_to_summarize"
    >,
    ownerTurnCount: number,
  ): DiscoveryProfileState {
    const blockingDomains = this.blockingDomains(
      result.updated_known_facts,
      result.updated_uncertainties,
      result.domain_scores,
    );
    const hasCriticalContradiction = result.updated_uncertainties.some(
      (uncertainty) =>
        uncertainty.domain !== "market_context" &&
        uncertainty.category === "contradiction" &&
        uncertainty.severity === "high",
    );
    for (const uncertainty of result.updated_uncertainties) {
      if (
        uncertainty.domain !== "market_context" &&
        uncertainty.category === "contradiction" &&
        uncertainty.severity === "high" &&
        !blockingDomains.includes(uncertainty.domain)
      ) {
        blockingDomains.push(uncertainty.domain);
      }
    }
    const readiness: DiscoveryReadiness = {
      ready:
        result.ready_to_summarize &&
        result.domain_scores.profile_readiness >= PROFILE_READINESS_THRESHOLD &&
        blockingDomains.length === 0 &&
        !hasCriticalContradiction,
      llm_recommended: result.ready_to_summarize,
      profile_readiness: result.domain_scores.profile_readiness,
      domain_scores: result.domain_scores,
      blocking_domains: blockingDomains,
      owner_turn_count: ownerTurnCount,
      max_owner_turns: MAX_DISCOVERY_OWNER_TURNS,
    };

    return {
      known_facts: result.updated_known_facts,
      uncertainties: result.updated_uncertainties,
      readiness,
    };
  }

  withCompletionReason(
    state: DiscoveryProfileState,
    reason: DiscoveryReadiness["completion_reason"],
  ): DiscoveryProfileState {
    return {
      ...state,
      readiness: {
        ...state.readiness,
        completion_reason: reason,
      },
    };
  }

  private blockingDomains(
    facts: MarketAwareBusinessFacts,
    uncertainties: readonly ProfileUncertainty[],
    scores: AiDiscoveryResult["domain_scores"],
  ): DiscoveryReadiness["blocking_domains"] {
    const blocked: DiscoveryReadiness["blocking_domains"] = [];

    if (
      scores.identity < 0.9 ||
      !present(facts.identity.business_name) ||
      !present(facts.identity.business_type) ||
      !present(facts.identity.city)
    ) {
      blocked.push("identity");
    }

    if (
      scores.offer < 0.7 ||
      (facts.offer.core_offerings.length === 0 &&
        facts.offer.best_sellers.length === 0)
    ) {
      blocked.push("offer");
    }

    if (
      scores.customers < 0.7 ||
      facts.customers.primary_segments.length === 0 ||
      (facts.customers.visit_or_order_occasions.length === 0 &&
        facts.customers.peak_periods.length === 0 &&
        facts.customers.customer_needs.length === 0)
    ) {
      blocked.push("customers");
    }

    if (
      !explicitUnknown(uncertainties, "differentiation") &&
      (scores.differentiation < 0.6 ||
        (facts.differentiation.owner_claimed_strengths.length === 0 &&
          facts.differentiation.customer_choice_reasons.length === 0))
    ) {
      blocked.push("differentiation");
    }

    if (
      !explicitUnknown(uncertainties, "current_marketing") &&
      (scores.current_marketing < 0.6 ||
        (facts.current_marketing.active_channels.length === 0 &&
          facts.current_marketing.current_activities.length === 0 &&
          facts.current_marketing.delivery_platforms.length === 0 &&
          facts.current_marketing.available_assets.length === 0))
    ) {
      blocked.push("current_marketing");
    }

    const constraints = facts.goals_and_constraints;
    if (
      scores.goals_and_constraints < 0.7 ||
      constraints.growth_goals.length === 0 ||
      (!present(constraints.timeframe) &&
        !present(constraints.marketing_budget_range) &&
        !present(constraints.team_capacity) &&
        constraints.operational_constraints.length === 0 &&
        !explicitUnknown(uncertainties, "goals_and_constraints"))
    ) {
      blocked.push("goals_and_constraints");
    }

    return blocked;
  }
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function explicitUnknown(
  uncertainties: readonly ProfileUncertainty[],
  domain: ProfileUncertainty["domain"],
): boolean {
  return uncertainties.some(
    (uncertainty) =>
      uncertainty.domain === domain && uncertainty.category === "owner_unknown",
  );
}

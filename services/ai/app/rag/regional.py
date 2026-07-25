from typing import Literal

from app.rag.schemas import RetrievalCandidate, RegionalCandidate


def _get_tier_priority(tier: str, requested_market: str) -> int:
    """Return priority 0 (best) to 2 (worst) based on the requested market."""
    if requested_market == "egypt":
        if tier == "egypt":
            return 0
        if tier == "mena":
            return 1
        return 2

    if requested_market == "mena":
        if tier == "mena":
            return 0
        return 2  # global

    # For global, everything is global (or effectively priority 0)
    return 0


def _get_fallback_label(tier: str, requested_market: str) -> str | None:
    if requested_market == "egypt" and tier != "egypt":
        return f"Fallback to {tier.upper()} (Egypt-specific unavailable)"
    if requested_market == "mena" and tier == "global":
        return "Fallback to GLOBAL (MENA-specific unavailable)"
    return None


def apply_regional_preference(
    candidates: list[RetrievalCandidate], requested_market: str
) -> list[RegionalCandidate]:
    """Sort candidates by regional relevance, marking fallbacks appropriately.

    Returns the list sorted by:
      1. Tier priority (e.g. Egypt -> MENA -> Global)
      2. Relevance score (descending)
    """
    regional_cands = []
    
    for c in candidates:
        tier = c.payload.get("market_tier", "global").lower()
        is_fallback = _get_tier_priority(tier, requested_market) > 0
        label = _get_fallback_label(tier, requested_market)
        
        regional_cands.append(
            RegionalCandidate(
                candidate=c,
                market_tier=tier,  # type: ignore
                is_fallback=is_fallback,
                fallback_label=label,
            )
        )
        
    # Sort: tier priority (lower is better), then score (higher is better)
    regional_cands.sort(
        key=lambda rc: (
            _get_tier_priority(rc.market_tier, requested_market),
            -rc.candidate.score,
        )
    )
    
    return regional_cands

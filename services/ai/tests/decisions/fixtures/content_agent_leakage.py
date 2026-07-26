"""Content Agent leakage fixture builder."""

from __future__ import annotations

from strategy_contracts import ClaimSource, SourcedClaim


def leaky_executive_summary() -> SourcedClaim:
    return SourcedClaim(
        text="Use #KosharyCorner for all posts. Caption: best koshary in town! 🍽️✨",
        source=ClaimSource.model_synthesis,
        citation_ids=[],
    )


def clean_executive_summary() -> SourcedClaim:
    return SourcedClaim(
        text="Focus on local office workers seeking a quick lunch.",
        source=ClaimSource.model_synthesis,
        citation_ids=[],
    )

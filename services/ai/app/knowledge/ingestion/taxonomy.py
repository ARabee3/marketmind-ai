"""Controlled vocabularies for marketing knowledge front matter.

These values must stay byte-identical to the authoritative lists in:
- Docs/marketing-knowledge/_schema/TAXONOMY.md
- packages/contracts/src/strategy/*.ts
- services/ai/app/qdrant/schemas.py
"""

from typing import FrozenSet


KINDS: FrozenSet[str] = frozenset(
    {
        "framework",
        "objective_playbook",
        "channel_playbook",
        "benchmark_report",
        "content_strategy_playbook",
        "budget_playbook",
        "measurement_playbook",
        "regional_guidance",
        "sector_note",
        "policy",
    }
)

LOCALES: FrozenSet[str] = frozenset({"ar-EG", "en", "mixed"})

MARKETS: FrozenSet[str] = frozenset({"egypt", "mena", "global"})

INDUSTRIES: FrozenSet[str] = frozenset(
    {"retail", "hospitality", "services", "education", "healthcare", "general"}
)

OBJECTIVES: FrozenSet[str] = frozenset(
    {"awareness", "acquisition", "conversion", "retention", "launch"}
)

FUNNEL_STAGES: FrozenSet[str] = frozenset(
    {"awareness", "consideration", "conversion", "retention", "advocacy"}
)

CHANNELS: FrozenSet[str] = frozenset(
    {
        "facebook",
        "instagram",
        "tiktok",
        "google_business_profile",
        "website",
        "delivery_platforms",
    }
)

SEASONS: FrozenSet[str] = frozenset(
    {
        "ramadan",
        "eid_al_fitr",
        "eid_al_adha",
        "back_to_school",
        "summer",
        "winter_holidays",
    }
)

BUDGET_MODES: FrozenSet[str] = frozenset(
    {
        "organic_only",
        "monthly_amount",
        "three_month_amount",
        "scenario_only",
    }
)

EVIDENCE_TIERS: FrozenSet[str] = frozenset(
    {"verified_benchmark", "reviewed_guidance", "contextual_note"}
)

REVIEW_STATUSES: FrozenSet[str] = frozenset(
    {"draft", "approved", "retired", "expired"}
)


REQUIRED_FRONT_MATTER_KEYS: tuple[str, ...] = (
    "slug",
    "version",
    "kind",
    "title",
    "summary",
    "locale",
    "markets",
    "industries",
    "business_models",
    "objectives",
    "funnel_stages",
    "channels",
    "seasons",
    "budget_modes",
    "evidence_tier",
    "review_status",
    "source_references",
    "effective_at",
    "expires_at",
    "author",
    "reviewer",
    "reviewed_at",
    "checksum",
)


# Ordered controlled-vocabulary array fields for validation.
CONTROLLED_ARRAY_FIELDS: tuple[tuple[str, FrozenSet[str], str], ...] = (
    ("markets", MARKETS, "MARKETS"),
    ("industries", INDUSTRIES, "INDUSTRIES"),
    ("objectives", OBJECTIVES, "OBJECTIVES"),
    ("funnel_stages", FUNNEL_STAGES, "FUNNEL_STAGES"),
    ("channels", CHANNELS, "CHANNELS"),
    ("seasons", SEASONS, "SEASONS"),
    ("budget_modes", BUDGET_MODES, "BUDGET_MODES"),
)


def is_valid_slug(slug: str) -> bool:
    """Return True if the slug is a non-empty kebab-case string."""
    if not isinstance(slug, str) or not slug:
        return False
    if not slug[0].isalpha():
        return False
    parts = slug.split("-")
    return all(part and all(c.islower() or c.isdigit() for c in part) for part in parts)

"""
Deterministic marketing decision constants.

Values marked NEEDS MARKETING SIGN-OFF are first-draft heuristics for review.
"""

from strategy_contracts import StrategyObjective

# Tie-break: equal total_score → ascending channel slug (single source of truth).
TIE_BREAK_ORDER = "ascending_channel_slug"

# Candidate channels evaluated for every strategy brief.
STANDARD_CHANNELS: tuple[str, ...] = (
    "instagram",
    "facebook",
    "tiktok",
    "google_business_profile",
    "google_maps",
    "delivery_platforms",
    "website",
)

# Channel slug aliases for existing-presence matching.
CHANNEL_ALIASES: dict[str, tuple[str, ...]] = {
    "instagram": ("instagram", "insta", "ig"),
    "facebook": ("facebook", "fb", "facebook page"),
    "tiktok": ("tiktok", "tik tok"),
    "google_business_profile": (
        "google business profile",
        "google business",
        "gbp",
    ),
    "google_maps": ("google maps", "google map", "gmb"),
    "delivery_platforms": (
        "delivery",
        "talabat",
        "elmenus",
        "delivery platforms",
    ),
    "website": ("website", "web site", "site"),
}

# NEEDS MARKETING SIGN-OFF: minimum total score (of 8.0) for a supporting channel.
SUPPORTING_CHANNEL_MIN_TOTAL_SCORE = 3.0

# NEEDS MARKETING SIGN-OFF: budget scenario multipliers relative to base.
CONSERVATIVE_BUDGET_RATIO = 0.70
GROWTH_BUDGET_RATIO = 1.50

# NEEDS MARKETING SIGN-OFF: per-channel minimum viable monthly spend (EGP).
CHANNEL_MIN_VIABLE_SPEND_EGP: dict[str, int] = {
    "instagram": 500,
    "facebook": 500,
    "tiktok": 800,
    "google_business_profile": 0,
    "google_maps": 0,
    "delivery_platforms": 0,
    "website": 0,
}

# NEEDS MARKETING SIGN-OFF: channel effort tiers for team-capacity scoring.
CHANNEL_EFFORT_TIER: dict[str, str] = {
    "tiktok": "high",
    "instagram": "medium",
    "facebook": "medium",
    "google_business_profile": "low",
    "google_maps": "low",
    "delivery_platforms": "low",
    "website": "low",
}

# Capacity tier ordering (lowest → highest).
CAPACITY_TIER_ORDER: tuple[str, ...] = ("none_solo", "low", "medium", "high")
EFFORT_TIER_ORDER: tuple[str, ...] = ("low", "medium", "high")

# Step-down scores when capacity tier is below required effort tier.
CAPACITY_STEPDOWN_SCORES: dict[int, float] = {
    0: 1.0,
    1: 0.5,
    2: 0.0,
}

# NEEDS MARKETING SIGN-OFF: required asset keyword categories per channel.
CHANNEL_REQUIRED_ASSET_KEYWORDS: dict[str, tuple[str, ...]] = {
    "instagram": ("photo", "video", "image", "reel"),
    "facebook": ("photo", "video", "image"),
    "tiktok": ("video", "short", "reel"),
    "google_business_profile": (),
    "google_maps": (),
    "delivery_platforms": ("menu", "catalog", "photo"),
    "website": (),
}

# Cold-start baseline when channel not in current activities.
EXISTING_PRESENCE_COLD_START = 0.3

# Neutral audience-fit when no channel item retrieved.
AUDIENCE_FIT_NEUTRAL = 0.5

# Evidence tier weights for evidence_strength dimension.
EVIDENCE_TIER_WEIGHTS: dict[str, float] = {
    "verified_benchmark": 1.0,
    "reviewed_guidance": 0.6,
    "contextual_note": 0.3,
}

# NEEDS MARKETING SIGN-OFF: measurement readiness baselines per channel.
MEASUREMENT_READINESS_BASELINE: dict[str, float] = {
    "delivery_platforms": 0.8,
    "google_business_profile": 0.7,
    "google_maps": 0.7,
    "website": 0.5,
    "instagram": 0.4,
    "facebook": 0.4,
    "tiktok": 0.3,
}

# Capacity boost applied to organic social measurement readiness.
MEASUREMENT_CAPACITY_BOOST: dict[str, float] = {
    "none_solo": 0.0,
    "low": 0.1,
    "medium": 0.2,
    "high": 0.3,
}

# Objective → adjacent funnel stages for partial objective_fit credit.
OBJECTIVE_ADJACENT_FUNNEL_STAGES: dict[str, tuple[str, ...]] = {
    "awareness": ("consideration", "discovery"),
    "acquisition": ("awareness", "consideration", "conversion"),
    "conversion": ("acquisition", "consideration"),
    "retention": ("loyalty", "conversion"),
    "launch": ("awareness", "acquisition"),
}

# KPI metrics per primary objective.
OBJECTIVE_KPI_METRICS: dict[StrategyObjective, tuple[str, ...]] = {
    StrategyObjective.awareness: ("reach", "impressions", "profile_views"),
    StrategyObjective.acquisition: ("leads", "inquiries", "new_followers"),
    StrategyObjective.conversion: ("orders", "sales", "conversions"),
    StrategyObjective.retention: ("repeat_customer_rate", "return_visits"),
    StrategyObjective.launch: ("reach", "orders", "new_customers"),
}

# scenario_only default period when paid media is allowed.
SCENARIO_ONLY_DEFAULT_PERIOD = "monthly"

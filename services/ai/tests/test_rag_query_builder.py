from app.rag.query_builder import (
    build_subqueries,
    get_industry_filter,
    get_locale_filter,
    get_market_filter,
)
from app.rag.schemas import RetrievalQueryContext


def test_get_locale_filter():
    assert get_locale_filter("ar-EG") == ["ar-EG", "mixed"]
    assert get_locale_filter("en") == ["en", "mixed"]
    assert get_locale_filter("mixed") == ["ar-EG", "en", "mixed"]


def test_get_market_filter():
    assert get_market_filter("egypt") == ["egypt", "mena", "global"]
    assert get_market_filter("mena") == ["mena", "global"]
    assert get_market_filter("global") == ["global"]


def test_get_industry_filter():
    assert get_industry_filter("retail") == ["retail", "general"]
    assert get_industry_filter("general") == ["general"]
    assert get_industry_filter(None) is None


def test_build_subqueries():
    context = RetrievalQueryContext(
        business_type="retail",
        market="egypt",
        locale="ar-EG",
        objective="awareness",
        funnel_stage="awareness",
        active_channels=["facebook", "instagram"],
        asset_capability=["photos"],
        team_capacity="low",
        budget_mode="monthly_amount",
        industry="fashion",
    )
    
    subqueries = build_subqueries(context)
    
    assert len(subqueries) == 8
    
    cats = {sq.category for sq in subqueries}
    assert cats == {
        "framework_diagnosis",
        "objective_funnel",
        "channel_facebook",
        "channel_instagram",
        "budget_method",
        "measurement_kpi",
        "content_strategy",
        "market_sector_season",
    }
    
    fb = next(sq for sq in subqueries if sq.category == "channel_facebook")
    assert fb.kind_filter == "channel_playbook"
    assert fb.locale_filter == ["ar-EG", "mixed"]
    assert fb.market_filter == ["egypt", "mena", "global"]
    assert fb.industry_filter == ["fashion", "general"]

    framework = next(
        sq for sq in subqueries if sq.category == "framework_diagnosis"
    )
    assert framework.industry_filter == ["fashion", "general"]

    content_strategy = next(
        sq for sq in subqueries if sq.category == "content_strategy"
    )
    assert content_strategy.kind_filter == "content_strategy_playbook"


def test_build_subqueries_organic_only():
    context = RetrievalQueryContext(
        business_type="retail",
        market="egypt",
        locale="ar-EG",
        objective="awareness",
        funnel_stage="awareness",
        active_channels=[],
        asset_capability=[],
        team_capacity="low",
        budget_mode="organic_only",
        industry="fashion",
    )
    
    subqueries = build_subqueries(context)
    
    # Should not include budget_method when organic_only and no active channels
    cats = {sq.category for sq in subqueries}
    assert "budget_method" not in cats
    assert len(cats) == 5


def test_build_subqueries_does_not_duplicate_general_industry():
    context = RetrievalQueryContext(
        business_type="services",
        market="egypt",
        locale="en",
        objective="conversion",
        funnel_stage="conversion",
        active_channels=[],
        asset_capability=[],
        team_capacity="owner",
        budget_mode="organic_only",
        industry="general",
    )

    subqueries = build_subqueries(context)

    assert all(sq.industry_filter == ["general"] for sq in subqueries)

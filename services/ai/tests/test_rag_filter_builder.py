from datetime import datetime, timezone
from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, DatetimeRange

from app.rag.schemas import RetrievalSubquery
from app.rag.filter_builder import build_category_filter


def test_build_category_filter():
    now = datetime(2025, 1, 1, tzinfo=timezone.utc).replace(tzinfo=None)
    
    subquery = RetrievalSubquery(
        category="objective_funnel",
        text="test",
        kind_filter="objective_playbook",
        locale_filter=["ar-EG", "mixed"],
        market_filter=["egypt", "mena", "global"],
    )
    
    q_filter = build_category_filter(subquery, now)
    
    assert isinstance(q_filter, Filter)
    
    must = q_filter.must
    assert len(must) == 5
    
    # Verify review_status
    status_cond = next(c for c in must if getattr(c, "key", None) == "review_status")
    assert getattr(status_cond.match, "value", None) == "approved"
    
    # Verify effective_at
    effective_cond = next(c for c in must if getattr(c, "key", None) == "effective_at")
    assert getattr(effective_cond.range, "lte", None) == now
    
    # Verify kind
    kind_cond = next(c for c in must if getattr(c, "key", None) == "kind")
    assert getattr(kind_cond.match, "value", None) == "objective_playbook"
    
    # Verify locale
    locale_cond = next(c for c in must if getattr(c, "key", None) == "locale")
    assert getattr(locale_cond.match, "any", None) == ["ar-EG", "mixed"]

    # Verify market
    market_cond = next(c for c in must if getattr(c, "key", None) == "markets")
    assert getattr(market_cond.match, "any", None) == ["egypt", "mena", "global"]
    
    # Verify expires_at must_not
    must_not = q_filter.must_not
    assert len(must_not) == 1
    expires_cond = must_not[0]
    assert getattr(expires_cond, "key", None) == "expires_at"
    assert getattr(expires_cond.range, "lte", None) == now


def test_build_category_filter_list_kind():
    now = datetime(2025, 1, 1, tzinfo=timezone.utc).replace(tzinfo=None)
    
    subquery = RetrievalSubquery(
        category="market_sector_season",
        text="test",
        kind_filter=["regional_guidance", "sector_note"],
        locale_filter=None,
        market_filter=None,
    )
    
    q_filter = build_category_filter(subquery, now)
    
    kind_cond = next(c for c in q_filter.must if getattr(c, "key", None) == "kind")
    assert getattr(kind_cond.match, "any", None) == ["regional_guidance", "sector_note"]
    
    # Without locale/market
    assert len(q_filter.must) == 3

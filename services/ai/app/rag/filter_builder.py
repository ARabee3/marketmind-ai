from datetime import datetime

from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, DatetimeRange

from app.rag.schemas import RetrievalSubquery


def build_category_filter(subquery: RetrievalSubquery, now: datetime) -> Filter:
    """Combine eligibility + category-specific filters."""
    now_iso = now.isoformat()
    
    must_conditions = [
        FieldCondition(key="review_status", match=MatchValue(value="approved")),
        FieldCondition(key="effective_at", range=DatetimeRange(lte=now_iso)),
    ]
    
    if isinstance(subquery.kind_filter, list):
        must_conditions.append(
            FieldCondition(key="kind", match=MatchAny(any=subquery.kind_filter))
        )
    else:
        must_conditions.append(
            FieldCondition(key="kind", match=MatchValue(value=subquery.kind_filter))
        )
        
    if subquery.locale_filter:
        must_conditions.append(
            FieldCondition(key="locale", match=MatchAny(any=subquery.locale_filter))
        )
        
    if subquery.market_filter:
        must_conditions.append(
            FieldCondition(key="markets", match=MatchAny(any=subquery.market_filter))
        )
        
    must_not_conditions = [
        FieldCondition(key="expires_at", range=DatetimeRange(lte=now_iso))
    ]
    
    return Filter(must=must_conditions, must_not=must_not_conditions)

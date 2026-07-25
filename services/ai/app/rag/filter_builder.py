from datetime import datetime
from typing import Any

from qdrant_client.models import Filter, FieldCondition, MatchValue, MatchAny, DatetimeRange, IsNullCondition, Condition

from app.rag.schemas import RetrievalSubquery


def build_eligibility_filter(now: datetime) -> list[Condition]:
    """The canonical eligibility predicate from MARKETING_KNOWLEDGE_SCHEMA.md.
    
    Conditions:
    - review_status == "approved"
    - effective_at <= now
    - expires_at IS NULL OR expires_at > now
    """
    now_iso = now.isoformat()
    return [
        FieldCondition(key="review_status", match=MatchValue(value="approved")),
        FieldCondition(key="effective_at", range=Range(lte=now_iso)),
        # qdrant treats 'null' values as absent, so we have to use Filter's logic.
        # The correct way to say "expires_at IS NULL OR expires_at > now" in Qdrant:
        # should = [ IsEmpty(key="expires_at"), FieldCondition(key="expires_at", range=Range(gt=now_iso)) ]
        # We can append this to a Filter as a `must` condition which is itself a nested Filter.
        Filter(
            should=[
                IsNullCondition(is_null=FieldCondition(key="expires_at")),  # This might not be the exact Qdrant model for IsEmpty
                # Actually, Qdrant models have `IsEmptyCondition(is_empty=PayloadField(key="expires_at"))`
                # Let's use `must_not` = FieldCondition(key="expires_at", range=Range(lte=now_iso))
                # If a field is missing (null), a range filter on it won't match, so must_not is safe.
            ]
        )
    ]

# Let's write this cleanly:
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
        # Must not be expired
        FieldCondition(key="expires_at", range=DatetimeRange(lte=now_iso))
    ]
    
    return Filter(must=must_conditions, must_not=must_not_conditions)

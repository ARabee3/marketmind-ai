from app.rag.schemas import RetrievalQueryContext
from app.rag.privacy import sanitize_query_context, sanitize_text


def test_sanitize_text():
    assert sanitize_text("My email is foo@bar.com.") == "My email is [EMAIL_REMOVED]."
    assert sanitize_text("Call me at +201012345678 or 01112345678") == "Call me at [PHONE_REMOVED] or [PHONE_REMOVED]"
    assert sanitize_text("The secret is API_KEY: xyz123") == "The secret is API_KEY: [CREDENTIAL_REMOVED]"


def test_sanitize_query_context():
    context = RetrievalQueryContext(
        business_type="retail",
        market="egypt",
        locale="ar-EG",
        objective="awareness",
        funnel_stage="awareness",
        active_channels=["facebook"],
        asset_capability=["photos"],
        team_capacity="We have 2 people. email manager@example.com for more info. +201000000000",
        budget_mode="organic_only",
        industry="fashion",
    )
    
    sanitized = sanitize_query_context(context)
    
    # Should leave allowed fields unchanged
    assert sanitized.business_type == "retail"
    assert sanitized.market == "egypt"
    assert sanitized.locale == "ar-EG"
    
    # Should sanitize team_capacity
    assert "[EMAIL_REMOVED]" in sanitized.team_capacity
    assert "[PHONE_REMOVED]" in sanitized.team_capacity
    assert "manager@example.com" not in sanitized.team_capacity

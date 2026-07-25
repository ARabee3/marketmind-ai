import re

from app.rag.schemas import RetrievalQueryContext


# Patterns for defense-in-depth against PII
_EMAIL_PATTERN = re.compile(r"[\w\.-]+@[\w\.-]+\.\w+")
_PHONE_PATTERN = re.compile(r"\+?\d{1,4}?[-.\s]?\(?\d{1,3}?\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}")
# Match likely account credentials formats (basic heuristic)
_CREDENTIALS_PATTERN = re.compile(r"(?i)(password|token|secret|api_key)([\s]*[:=][\s]*)([^\s,]+)")


def sanitize_text(text: str | None) -> str:
    """Remove patterns that resemble PII or credentials from free-text fields."""
    if not text:
        return ""
    
    text = _EMAIL_PATTERN.sub("[EMAIL_REMOVED]", text)
    text = _PHONE_PATTERN.sub("[PHONE_REMOVED]", text)
    text = _CREDENTIALS_PATTERN.sub(r"\1\2[CREDENTIAL_REMOVED]", text)
    
    return text.strip()


def sanitize_query_context(context: RetrievalQueryContext) -> RetrievalQueryContext:
    """Return a sanitized copy of the query context ensuring no PII leaks.
    
    The RetrievalQueryContext Pydantic model already restricts fields by design
    (extra="ignore"), so owner_name or exact_address will be dropped during validation.
    This function adds defense-in-depth by scrubbing allowed free-text fields.
    """
    sanitized = context.model_copy()
    
    # Scrub the main free-text field
    sanitized.team_capacity = sanitize_text(sanitized.team_capacity)
    sanitized.free_text_notes = sanitize_text(sanitized.free_text_notes)
    
    return sanitized

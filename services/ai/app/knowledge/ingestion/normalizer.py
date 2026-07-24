"""Text normalization for knowledge chunking.

Rules:
- Convert CRLF to LF.
- Collapse Unicode/ASCII whitespace runs to a single space.
- Trim leading/trailing whitespace.
- Preserve Arabic text, diacritics, direction marks, and punctuation.
- Never transliterate or damage content.
"""

import re
import unicodedata


def normalize_text(text: str) -> str:
    """Normalize whitespace while preserving language content."""
    text = text.replace("\r\n", "\n")
    # Replace any Unicode whitespace (including non-breaking space) with a
    # normal ASCII space, but keep line breaks for Markdown structure.
    text = "".join(
        ch if ch == "\n" or not unicodedata.category(ch).startswith("Z")
        else " "
        for ch in text
    )
    # Collapse multiple spaces, but leave line breaks intact.
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    # Collapse three or more blank lines into two blank lines.
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()
    return text


def normalize_line_endings(text: str) -> str:
    """Return the text with CRLF converted to LF."""
    return text.replace("\r\n", "\n")


def normalize_for_checksum(text: str) -> str:
    """Normalize for chunk checksums: LF endings and trimmed whitespace."""
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+\$", "", text, flags=re.MULTILINE)
    text = text.strip()
    return text

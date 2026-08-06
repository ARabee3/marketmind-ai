"""PII scrubbing unit tests for Content prompt grounding.

Covers the Egyptian landline gap: prompts must redact local landline numbers
(``0[2-9]`` forms and ``+20`` landline forms) in addition to the already
covered mobile ``01[0125]`` numbers.
"""

from __future__ import annotations

from app.content.prompts import _scrub_pii


def test_scrub_pii_redacts_compact_local_landline() -> None:
    assert _scrub_pii("اتصل بنا على 0223456789") == "اتصل بنا على [REDACTED]"


def test_scrub_pii_redacts_spaced_local_landline() -> None:
    assert _scrub_pii("اتصل بنا على 02 2345 6789") == "اتصل بنا على [REDACTED]"


def test_scrub_pii_redacts_international_landline_without_separators() -> None:
    assert _scrub_pii("الهاتف +20223456789") == "الهاتف [REDACTED]"


def test_scrub_pii_redacts_international_landline_with_separators() -> None:
    assert _scrub_pii("الهاتف +20 2 2345 6789") == "الهاتف [REDACTED]"


def test_scrub_pii_still_redacts_mobile_numbers() -> None:
    assert _scrub_pii("اتصل على 01012345678") == "اتصل على [REDACTED]"


def test_scrub_pii_keeps_innocuous_numbers_untouched() -> None:
    assert _scrub_pii("عدد الطلبات 2024 في اليوم") == "عدد الطلبات 2024 في اليوم"
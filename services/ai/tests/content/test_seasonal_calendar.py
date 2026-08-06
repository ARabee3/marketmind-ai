"""Egyptian commercial calendar observance tests.

Covers the review gap: Content grounding should recognize the Egyptian
commercial calendar — Mother's Day (Mar 21), Egyptian Valentine's Day
(Nov 4), White Friday (last Friday of November), and Singles' Day (Nov 11) —
so seasonal prompts can reference real local retail moments.
"""

from __future__ import annotations

from datetime import date

from app.content.seasonal_calendar import observances_for_week


def _ids(week_start: date) -> set[str]:
    return {entry["id"] for entry in observances_for_week(week_start)}


def test_mothers_day_week_is_observed() -> None:
    assert "mothers_day" in _ids(date(2026, 3, 16))


def test_mothers_day_absent_outside_its_week() -> None:
    assert "mothers_day" not in _ids(date(2026, 4, 20))


def test_egyptian_valentines_week_is_observed() -> None:
    assert "egyptian_valentines_day" in _ids(date(2026, 11, 2))


def test_singles_day_week_is_observed() -> None:
    assert "singles_day" in _ids(date(2026, 11, 9))


def test_white_friday_is_the_last_friday_of_november() -> None:
    # 2026-11-27 is the last Friday of November 2026.
    assert "white_friday" in _ids(date(2026, 11, 23))
    assert "white_friday" not in _ids(date(2026, 11, 16))


def test_white_friday_observed_flag_and_label() -> None:
    entries = observances_for_week(date(2026, 11, 23))
    white_friday = next(e for e in entries if e["id"] == "white_friday")
    assert white_friday["label"] == "White Friday"
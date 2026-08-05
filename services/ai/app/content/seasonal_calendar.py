"""Deterministic Egypt seasonal / observance calendar for Content grounding.

Only fixed-date observances and stable seasonal windows are included so the
table never fabricates a fact. Lunar observances (Ramadan, Eid al-Fitr,
Eid al-Adha, Sham El-Nessim) shift roughly 11 days each Gregorian year and
cannot be anchored to a fixed month/day without inventing a date, so they are
intentionally excluded here; AI must not assert their timings from memory.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class _SeasonalWindow:
    id: str
    label: str
    start: tuple[int, int]
    end: tuple[int, int]
    observed: bool = True


_STATIC_WINDOWS: tuple[_SeasonalWindow, ...] = (
    _SeasonalWindow("new_year", "New Year", (1, 1), (1, 1)),
    _SeasonalWindow("coptic_christmas", "Coptic Christmas", (1, 7), (1, 7)),
    _SeasonalWindow("jan25_revolution", "January 25 Revolution Day", (1, 25), (1, 25)),
    _SeasonalWindow("sinai_liberation", "Sinai Liberation Day", (4, 25), (4, 25)),
    _SeasonalWindow("labour_day", "Labour Day", (5, 1), (5, 1)),
    _SeasonalWindow("summer", "Summer season", (6, 1), (8, 31)),
    _SeasonalWindow("revolution_june30", "June 30 Revolution", (6, 30), (6, 30)),
    _SeasonalWindow("back_to_school", "Back-to-school window", (9, 1), (9, 30)),
    _SeasonalWindow("oct6_forces_day", "Armed Forces Day", (10, 6), (10, 6)),
)


def _month_day(value: date) -> tuple[int, int]:
    return value.month, value.day


def _in_window(day: tuple[int, int], start: tuple[int, int], end: tuple[int, int]) -> bool:
    if start <= end:
        return start <= day <= end
    return day >= start or day <= end


def observances_for_week(week_start: date) -> list[dict[str, str]]:
    """Return the observance ids/labels overlapping the 7-day week at week_start."""
    return [
        {"id": window.id, "label": window.label}
        for window in _STATIC_WINDOWS
        if window.observed
        and any(
            _in_window(_month_day(day), window.start, window.end)
            for offset in range(7)
            for day in [date.fromordinal(week_start.toordinal() + offset)]
        )
    ]
"""Plan-content validators not covered by the shared bundle validator.

These functions inspect LLM-authored text in a StrategyPlan for structural,
provenance, and tone issues. They are pure functions: no DB, no HTTP, no LLM.
"""

from __future__ import annotations

import re
from typing import Any

from strategy_contracts import (
    SourcedClaim,
    StrategyPlan,
    StrategyValidationCode,
    StrategyValidationIssue,
)

# Patterns that suggest finished consumer-facing content instead of planning.
_CONTENT_AGENT_LEAKAGE_PATTERNS = (
    re.compile(r"#\w+", re.UNICODE),
    re.compile(r"['\"].*?['\"]", re.UNICODE),
    re.compile(r"\bCaption\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bScript\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bPost\s*\d+\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bStory\s*\d+\s*:", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bReel\s*\d+\s*:", re.IGNORECASE | re.UNICODE),
)

# Heavy emoji presence is a heuristic smell for finished social copy.
_EMOJI_THRESHOLD = 3

# Phrases that imply the plan itself executes rather than proposes.
_EXECUTION_LANGUAGE_PATTERNS = (
    re.compile(r"\bscheduled\s+for\s+publishing\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bads?\s+have\s+been\s+launched\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bbudget\s+has\s+been\s+spent\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bhas\s+been\s+published\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bwe\s+will\s+run\s+the\s+ads?\b", re.IGNORECASE | re.UNICODE),
    re.compile(r"\bauto-?approve\b", re.IGNORECASE | re.UNICODE),
)


def _all_claims(plan: StrategyPlan) -> list[tuple[str, SourcedClaim]]:
    """Yield (field_path, claim) pairs for every SourcedClaim in the plan."""
    claims: list[tuple[str, SourcedClaim]] = []
    claims.append(("executive_summary", plan.executive_summary))
    claims.append(("situation_diagnosis", plan.situation_diagnosis))
    claims.append(("target_audience", plan.target_audience))
    claims.append(("positioning", plan.positioning))
    claims.append(("tone", plan.tone))
    for index, claim in enumerate(plan.assumptions):
        claims.append((f"assumptions[{index}]", claim))
    for index, claim in enumerate(plan.risks):
        claims.append((f"risks[{index}]", claim))
    for index, pillar in enumerate(plan.content_strategy.pillars):
        claims.append((f"content_strategy.pillars[{index}]", pillar))
    for index, mix in enumerate(plan.content_strategy.format_mix):
        claims.append((f"content_strategy.format_mix[{index}]", mix))
    return claims


def _issue(
    code: StrategyValidationCode,
    field: str,
    message: str,
) -> StrategyValidationIssue:
    return StrategyValidationIssue(code=code, field=field, message=message)


def validate_required_sections(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Ensure every required StrategyPlan section is populated."""
    issues: list[StrategyValidationIssue] = []

    if not plan.executive_summary.text.strip():
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "executive_summary", "Executive summary is required.")
        )
    if not plan.situation_diagnosis.text.strip():
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "situation_diagnosis", "Situation diagnosis is required.")
        )
    if not plan.target_audience.text.strip():
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "target_audience", "Target audience is required.")
        )
    if not plan.positioning.text.strip():
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "positioning", "Positioning is required.")
        )
    if not plan.tone.text.strip():
        issues.append(_issue("STRATEGY_RULE_VIOLATION", "tone", "Tone is required."))
    if not plan.content_strategy.pillars:
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "content_strategy.pillars", "At least 3 content pillars are required.")
        )
    if not plan.content_strategy.format_mix:
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "content_strategy.format_mix", "Format mix is required.")
        )
    if not plan.content_strategy.weekly_cadence.strip():
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "content_strategy.weekly_cadence", "Weekly cadence is required.")
        )
    if not plan.content_strategy.weeks:
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "content_strategy.weeks", "12-week roadmap is required.")
        )
    if not plan.kpi_targets:
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "kpi_targets", "At least one KPI target is required.")
        )
    if not plan.assumptions:
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "assumptions", "Assumptions section is required.")
        )
    if not plan.risks:
        issues.append(_issue("STRATEGY_RULE_VIOLATION", "risks", "Risks section is required."))
    if not plan.citations:
        issues.append(
            _issue("STRATEGY_RULE_VIOLATION", "citations", "At least one citation is required.")
        )
    return issues


def validate_fact_assumption_labels(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Detect mislabeled claims: facts need sources, synthesis needs hedges."""
    issues: list[StrategyValidationIssue] = []
    numeric_pattern = re.compile(r"\d[\d,]*(?:\.\d+)?\s*(%|percent|EGP|followers|orders|leads|customers)?", re.IGNORECASE)

    for field, claim in _all_claims(plan):
        if claim.source in ("confirmed_fact", "retrieved_evidence") and not claim.citation_ids:
            issues.append(
                _issue(
                    "STRATEGY_RULE_VIOLATION",
                    field,
                    f"{claim.source} claim must cite a source.",
                )
            )
        if claim.source == "model_synthesis" and numeric_pattern.search(claim.text):
            if not (claim.confidence_note and claim.confidence_note.strip()):
                issues.append(
                    _issue(
                        "STRATEGY_RULE_VIOLATION",
                        field,
                        "model_synthesis claim with a specific number needs a confidence_note.",
                    )
                )
    return issues


def _emoji_count(text: str) -> int:
    """Rough count of emoji characters in text."""
    return sum(1 for char in text if 0x1F300 <= ord(char) <= 0x1F9FF or 0x2600 <= ord(char) <= 0x26FF)


def validate_content_agent_leakage(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Flag planning text that looks like finished social copy."""
    issues: list[StrategyValidationIssue] = []
    for field, claim in _all_claims(plan):
        for pattern in _CONTENT_AGENT_LEAKAGE_PATTERNS:
            if pattern.search(claim.text):
                issues.append(
                    _issue(
                        "STRATEGY_RULE_VIOLATION",
                        field,
                        "Planning text appears to contain finished caption/script/post formatting.",
                    )
                )
                break
        if _emoji_count(claim.text) >= _EMOJI_THRESHOLD:
            issues.append(
                _issue(
                    "STRATEGY_RULE_VIOLATION",
                    field,
                    "Planning text contains heavy emoji usage typical of consumer-facing copy.",
                )
            )
    return issues


def validate_publishing_execution_language(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Flag phrases that imply the plan executes rather than proposes."""
    issues: list[StrategyValidationIssue] = []
    for field, claim in _all_claims(plan):
        for pattern in _EXECUTION_LANGUAGE_PATTERNS:
            if pattern.search(claim.text):
                issues.append(
                    _issue(
                        "STRATEGY_RULE_VIOLATION",
                        field,
                        "Planning text uses execution/publishing language; the Strategy agent only proposes.",
                    )
                )
                break
    return issues


def validate_plan_content(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Run all content validators and return merged issues."""
    return (
        validate_required_sections(plan)
        + validate_fact_assumption_labels(plan)
        + validate_content_agent_leakage(plan)
        + validate_publishing_execution_language(plan)
    )

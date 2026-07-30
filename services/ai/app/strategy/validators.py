"""Strategy plan validation pipeline.

Runs post-generation schema, citation, fact, leakage, arithmetic, section, and
rule validators. The pipeline returns a `StrategyValidationResult` with stable,
machine-readable issue codes so the caller can decide whether to show the plan,
block approval, or retry.
"""

from __future__ import annotations

from strategy_contracts import (
    BusinessProfilePayload,
    DeterministicChannelScorecard,
    KpiTargetMode,
    RetrievedKnowledgePack,
    StrategyBrief,
    StrategyGenerateRequest,
    StrategyPlan,
    StrategyValidationIssue,
    StrategyValidationResult,
    validate_strategy_bundle,
)


class StrategyValidationPipeline:
    """Run all deterministic validators against a generated StrategyPlan."""

    def __init__(self) -> None:
        """Validators are stateless; the pipeline only captures configuration."""

    def validate(
        self,
        plan: StrategyPlan,
        request: StrategyGenerateRequest,
    ) -> StrategyValidationResult:
        """Run the full validation suite.

        Uses the shared contract validator for cross-object policy checks, then
        appends any AI-service-specific validations that are not yet covered.
        """
        contract_result = validate_strategy_bundle(
            business_profile=request.business_profile,
            brief=request.brief,
            retrieval_pack=request.retrieved_knowledge_pack,
            deterministic_channel_scores=request.deterministic_channel_scores,
            plan=plan,
            decision=None,
        )

        extra_issues = self._run_extra_validators(plan, request)
        return StrategyValidationResult(
            valid=contract_result.valid and len(extra_issues) == 0,
            issues=contract_result.issues + extra_issues,
        )

    def _run_extra_validators(
        self,
        plan: StrategyPlan,
        request: StrategyGenerateRequest,
    ) -> list[StrategyValidationIssue]:
        """Run AI-service-specific validations beyond the contract validator."""
        issues: list[StrategyValidationIssue] = []
        issues.extend(_validate_required_sections(plan))
        issues.extend(_validate_input_references(plan, request))
        issues.extend(_validate_benchmarks(plan))
        issues.extend(_validate_owner_facing_language(plan, request))
        return issues


def _validate_required_sections(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Ensure no required textual section is empty or whitespace-only."""
    issues: list[StrategyValidationIssue] = []
    sections = {
        "executive_summary": plan.executive_summary.text,
        "situation_diagnosis": plan.situation_diagnosis.text,
        "target_audience": plan.target_audience.text,
        "positioning": plan.positioning.text,
        "tone": plan.tone.text,
    }
    for field, text in sections.items():
        if not text or not text.strip():
            issues.append(
                StrategyValidationIssue(
                    code="STRATEGY_RULE_VIOLATION",
                    field=f"plan.{field}.text",
                    message=f"Required section {field} is empty.",
                )
            )
    return issues


def _validate_input_references(
    plan: StrategyPlan,
    request: StrategyGenerateRequest,
) -> list[StrategyValidationIssue]:
    """Ensure the plan references the exact inputs supplied by the caller."""
    issues: list[StrategyValidationIssue] = []
    if plan.brief_id != request.brief.id:
        issues.append(
            StrategyValidationIssue(
                code="STRATEGY_RULE_VIOLATION",
                field="plan.brief_id",
                message="Plan brief_id does not match the supplied Strategy Brief.",
            )
        )
    if plan.retrieval_run_id != request.retrieved_knowledge_pack.retrieval_run_id:
        issues.append(
            StrategyValidationIssue(
                code="STRATEGY_RULE_VIOLATION",
                field="plan.retrieval_run_id",
                message="Plan retrieval_run_id does not match the supplied retrieval pack.",
            )
        )
    profile_ref = plan.profile_version
    request_profile = request.business_profile
    if (
        profile_ref.business_profile_version_id != request_profile.id
        or profile_ref.version != request_profile.version
    ):
        issues.append(
            StrategyValidationIssue(
                code="STRATEGY_PROFILE_STALE",
                field="plan.profile_version",
                message="Plan profile_version does not match the supplied Business Profile.",
            )
        )
    return issues


def _validate_benchmarks(plan: StrategyPlan) -> list[StrategyValidationIssue]:
    """Ensure every verified_benchmark_range KPI has a valid citation in the plan.

    This validator cross-checks KPI targets with target_mode
    ``verified_benchmark_range`` against the plan's own citations array to
    catch hallucinated or dangling benchmark references that the model may
    have inserted despite prompt instructions.
    """
    issues: list[StrategyValidationIssue] = []
    citations_by_id = {c.citation_id: c for c in plan.citations}

    for index, target in enumerate(plan.kpi_targets):
        if target.target_mode != KpiTargetMode.verified_benchmark_range:
            continue

        if target.benchmark_citation_id is None:
            issues.append(
                StrategyValidationIssue(
                    code="STRATEGY_INVALID_BENCHMARK",
                    field=f"plan.kpi_targets[{index}].benchmark_citation_id",
                    message=(
                        "KPI target has target_mode 'verified_benchmark_range' "
                        "but benchmark_citation_id is null."
                    ),
                )
            )
            continue

        citation = citations_by_id.get(target.benchmark_citation_id)
        if citation is None:
            issues.append(
                StrategyValidationIssue(
                    code="STRATEGY_INVALID_BENCHMARK",
                    field=f"plan.kpi_targets[{index}].benchmark_citation_id",
                    message=(
                        f"benchmark_citation_id {target.benchmark_citation_id} "
                        "does not match any citation in plan.citations."
                    ),
                )
            )

    return issues


# Arabic Unicode blocks: Arabic, Arabic Supplement, Arabic Extended-A/B,
# and the ArabicPresentation forms used by Egyptain-friendly MSA content.
_ARABIC_RANGES: tuple[tuple[int, int], ...] = (
    (0x0600, 0x06FF),   # Arabic
    (0x0750, 0x077F),   # Arabic Supplement
    (0x08A0, 0x08FF),   # Arabic Extended-A
    (0xFB50, 0xFDFF),   # Arabic Presentation Forms-A
    (0xFE70, 0xFEFF),   # Arabic Presentation Forms-B
)


def _has_arabic_letter(text: str) -> bool:
    """True when *text* contains at least one Arabic-script letter."""
    return any(
        any(start <= ord(ch) <= end for start, end in _ARABIC_RANGES)
        for ch in text
    )


def _owner_facing_prose_texts(plan: StrategyPlan) -> list[tuple[str, str]]:
    """Collect (field_path, text) tuples for every owner-facing prose field.

    Evidence source titles, URLs, citation/chunk IDs, numeric benchmark values
    and technical metadata are intentionally excluded — those stay in their
    original language/script and are not subject to the language check.
    """
    entries: list[tuple[str, str]] = [
        ("plan.executive_summary.text", plan.executive_summary.text),
        ("plan.situation_diagnosis.text", plan.situation_diagnosis.text),
        ("plan.target_audience.text", plan.target_audience.text),
        ("plan.positioning.text", plan.positioning.text),
        ("plan.tone.text", plan.tone.text),
    ]
    for index, channel in enumerate(plan.selected_channels):
        entries.append(
            (f"plan.selected_channels[{index}].rationale.text", channel.rationale.text)
        )
    if plan.budget_scenarios:
        for index, scenario in enumerate(plan.budget_scenarios):
            entries.append(
                (f"plan.budget_scenarios[{index}].notes.text", scenario.notes.text)
            )
    for index, target in enumerate(plan.kpi_targets):
        entries.append(
            (f"plan.kpi_targets[{index}].notes.text", target.notes.text)
        )
    entries.extend(
        (f"plan.assumptions[{index}].text", claim.text)
        for index, claim in enumerate(plan.assumptions)
    )
    entries.extend(
        (f"plan.risks[{index}].text", claim.text)
        for index, claim in enumerate(plan.risks)
    )
    entries.extend(
        (f"plan.blockers[{index}].message", blocker.message)
        for index, blocker in enumerate(plan.blockers)
    )
    entries.extend(
        (f"plan.content_strategy.pillars[{index}].text", claim.text)
        for index, claim in enumerate(plan.content_strategy.pillars)
    )
    for index, week in enumerate(plan.content_strategy.weeks):
        entries.append(
            (f"plan.content_strategy.weeks[{index}].theme", week.theme)
        )
        if week.notes:
            entries.append(
                (f"plan.content_strategy.weeks[{index}].notes", week.notes)
            )
    return entries


def _validate_owner_facing_language(
    plan: StrategyPlan,
    request: StrategyGenerateRequest,
) -> list[StrategyValidationIssue]:
    """Ensure owner-facing prose follows ``brief.plan_language``.

    This is a soft, heuristic check (Unicode script detection), not a full
    translation-quality review. It surfaces a ``STRATEGY_LANGUAGE_MISMATCH``
    issue — never hard-rejects generation — so the owner still gets a draft
    and the team can triage the drift without breaking the lifecycle FSM.
    """
    expected_language = request.brief.plan_language
    # ``mixed`` plans intentionally match the source language of each input;
    # there is no single required script to enforce.
    if expected_language != "ar-EG":
        return []

    issues: list[StrategyValidationIssue] = []
    for field_path, text in _owner_facing_prose_texts(plan):
        if not text or not text.strip():
            # The required-sections validator already flags empty sections.
            continue
        if not _has_arabic_letter(text):
            issues.append(
                StrategyValidationIssue(
                    code="STRATEGY_LANGUAGE_MISMATCH",
                    field=field_path,
                    message=(
                        "Owner-facing field is not written in Arabic even though "
                        "brief.plan_language is ar-EG. Synthesize this field in "
                        "Arabic while preserving evidence URLs and source metadata."
                    ),
                )
            )
    return issues


def validate_plan_against_request(
    plan: StrategyPlan,
    request: StrategyGenerateRequest,
) -> StrategyValidationResult:
    """Convenience entry point that creates a default pipeline and validates."""
    return StrategyValidationPipeline().validate(plan, request)

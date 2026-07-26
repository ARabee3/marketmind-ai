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


def validate_plan_against_request(
    plan: StrategyPlan,
    request: StrategyGenerateRequest,
) -> StrategyValidationResult:
    """Convenience entry point that creates a default pipeline and validates."""
    return StrategyValidationPipeline().validate(plan, request)

"""Reusable Strategy generation/review seam for the Phase 3 graph."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

from error_codes import ERROR_CODES
from orchestration_contracts import ResearchPackV1
from strategy_contracts import (
    StrategyGenerateRequest,
    StrategyPlan,
    StrategyValidationResult,
)

from app.decisions.service import compute_strategy_decisions
from app.providers.base import ProviderError
from app.providers.strategy_provider import StrategyLLMProvider
from app.strategy.assembler import (
    DecisionBundle,
    PromptAssembly,
    assemble_generation_prompt,
)
from app.strategy.retrieval_adapter import contract_pack_to_rag
from app.strategy.validators import validate_plan_against_request

from .contracts import StrategyQualityReviewV1


class Phase3GenerationError(RuntimeError):
    """A bounded Strategy generation failure safe to expose to orchestration."""

    def __init__(self, code: str, message: str, *, details: dict | None = None) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown Phase 3 error code: {code}")
        self.code = code
        self.details = details or {}
        super().__init__(message)


@dataclass(frozen=True)
class StrategyGenerationResult:
    plan: StrategyPlan
    validation: StrategyValidationResult
    provider_attempts: int
    provider_name: str
    prompt_version: str


class StrategyQualityReviewer(Protocol):
    async def review(
        self,
        plan: StrategyPlan,
        validation: StrategyValidationResult,
    ) -> StrategyQualityReviewV1:
        """Return a compact, structured quality decision."""


class DeterministicStrategyQualityReviewer:
    """Hard-gate the artifact without pretending to expose model reasoning."""

    async def review(
        self,
        plan: StrategyPlan,
        validation: StrategyValidationResult,
    ) -> StrategyQualityReviewV1:
        if not validation.valid:
            issue = validation.issues[0] if validation.issues else None
            repairable = bool(issue) and issue.code in {
                "STRATEGY_LANGUAGE_MISMATCH",
                "STRATEGY_RULE_VIOLATION",
                "STRATEGY_BUDGET_MISMATCH",
                "STRATEGY_SCORE_MISMATCH",
            }
            return StrategyQualityReviewV1(
                contract_version="strategy-quality-review-v1",
                artifact_type="strategy_plan",
                valid=False,
                issue_code=issue.code if issue else "ORCHESTRATION_VALIDATION_FAILED",
                field=issue.field if issue else "plan",
                severity="warning" if repairable else "blocking",
                repairable=repairable,
                short_explanation=(
                    issue.message
                    if issue
                    else "The generated Strategy plan failed deterministic validation."
                ),
                recommended_node="strategy" if repairable else "terminal",
            )

        blocking_gaps = [gap for gap in plan.knowledge_gaps if gap.severity.value == "blocking"]
        blocking_blockers = [
            blocker for blocker in plan.blockers if blocker.severity.value == "blocking"
        ]
        if blocking_gaps or blocking_blockers:
            item = blocking_blockers[0] if blocking_blockers else blocking_gaps[0]
            code = item.code if blocking_blockers else "STRATEGY_KNOWLEDGE_GAP"
            field = "plan.blockers" if blocking_blockers else "plan.knowledge_gaps"
            return StrategyQualityReviewV1(
                contract_version="strategy-quality-review-v1",
                artifact_type="strategy_plan",
                valid=False,
                issue_code=code,
                field=field,
                severity="blocking",
                repairable=False,
                short_explanation=(
                    "The Strategy contains a blocking owner or evidence gap and cannot "
                    "be approved automatically."
                ),
                recommended_node="owner",
            )

        return StrategyQualityReviewV1(
            contract_version="strategy-quality-review-v1",
            artifact_type="strategy_plan",
            valid=True,
            severity="info",
            repairable=False,
            short_explanation="Strategy contract and deterministic quality gates passed.",
            recommended_node="owner",
        )


def _repair_prompt(prompt: PromptAssembly, instruction: str, attempt: int) -> PromptAssembly:
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "TARGETED REPLAN: regenerate the complete StrategyPlan while preserving "
            "all immutable identifiers, deterministic scorecards, citations, and "
            "owner-confirmed facts. Resolve only the stated review issue."
        ),
        user_prompt=f"{prompt.user_prompt}\n\nTargeted review repair: {instruction}",
        metadata={
            **prompt.metadata,
            "targeted_replan": True,
            "targeted_replan_attempt": attempt,
        },
    )


class StrategySegment:
    """Calls the existing deterministic + provider + validation pipeline."""

    def __init__(
        self,
        provider: StrategyLLMProvider,
        *,
        model_name: str = "phase3",
        max_provider_attempts: int = 3,
    ) -> None:
        if max_provider_attempts < 1:
            raise ValueError("max_provider_attempts must be positive")
        self.provider = provider
        self.model_name = model_name
        self.max_provider_attempts = max_provider_attempts

    async def generate(
        self,
        request: StrategyGenerateRequest,
        *,
        repair_instruction: str | None = None,
        replan_attempt: int = 0,
        research_pack: ResearchPackV1 | None = None,
        deadline_at: str | None = None,
        token_budget: int | None = None,
        cost_budget_usd: float | None = None,
    ) -> StrategyGenerationResult:
        _validate_execution_budget(
            deadline_at=deadline_at,
            token_budget=token_budget,
            cost_budget_usd=cost_budget_usd,
        )
        try:
            rag_pack = contract_pack_to_rag(request.retrieved_knowledge_pack)
            decisions = compute_strategy_decisions(
                business_profile=request.business_profile,
                brief=request.brief,
                retrieval_pack=rag_pack,
            )
            prompt = assemble_generation_prompt(
                request=request,
                decision_bundle=DecisionBundle(
                    channel_scores=request.deterministic_channel_scores,
                    budget_scenarios=decisions.budget_scenarios,
                    kpi_targets=decisions.kpi_targets,
                ),
                provider_name=self.provider.name,
                model=self.model_name,
                research_pack=research_pack,
            )
        except Exception as exc:
            raise Phase3GenerationError(
                "ORCHESTRATION_VALIDATION_FAILED",
                f"Strategy prompt preparation failed: {exc}",
            ) from exc

        current_prompt = prompt
        if repair_instruction:
            current_prompt = _repair_prompt(prompt, repair_instruction, replan_attempt)
        # The deterministic outputs are part of the prompt metadata and are
        # checked again by the shared validation pipeline after generation.
        current_prompt = PromptAssembly(
            system_prompt=current_prompt.system_prompt,
            user_prompt=current_prompt.user_prompt,
            metadata={
                **current_prompt.metadata,
                "deterministic_channel_scores": [
                    score.model_dump(mode="json")
                    for score in request.deterministic_channel_scores
                ],
            },
        )

        last_validation: StrategyValidationResult | None = None
        last_provider_error: ProviderError | None = None
        for attempt in range(1, self.max_provider_attempts + 1):
            timeout_seconds = _remaining_deadline_seconds(deadline_at)
            if timeout_seconds is not None and timeout_seconds <= 0:
                raise Phase3GenerationError(
                    "ORCHESTRATION_BUDGET_EXCEEDED",
                    "Strategy generation deadline was reached before the provider attempt.",
                )
            try:
                if timeout_seconds is None:
                    plan = await self.provider.generate_strategy_plan(current_prompt)
                else:
                    async with asyncio.timeout(timeout_seconds):
                        plan = await self.provider.generate_strategy_plan(current_prompt)
            except TimeoutError as exc:
                raise Phase3GenerationError(
                    "ORCHESTRATION_BUDGET_EXCEEDED",
                    "Strategy provider exceeded the remaining orchestration deadline.",
                    details={"deadline_at": deadline_at},
                ) from exc
            except ProviderError as exc:
                last_provider_error = exc
                if not exc.retryable or attempt == self.max_provider_attempts:
                    raise Phase3GenerationError(
                        "ORCHESTRATION_PROVIDER_UNSUPPORTED",
                        f"Strategy provider failed after {attempt} attempt(s): {exc}",
                        details={"provider_code": exc.code, "retryable": exc.retryable},
                    ) from exc
                current_prompt = _repair_prompt(
                    current_prompt,
                    f"Provider returned a retryable failure: {exc}",
                    attempt,
                )
                continue
            except Exception as exc:
                raise Phase3GenerationError(
                    "ORCHESTRATION_PROVIDER_UNSUPPORTED",
                    f"Strategy provider failed unexpectedly: {exc}",
                ) from exc

            validation = validate_plan_against_request(plan=plan, request=request)
            last_validation = validation
            if validation.valid:
                return StrategyGenerationResult(
                    plan=plan,
                    validation=validation,
                    provider_attempts=attempt,
                    provider_name=self.provider.name,
                    prompt_version=str(current_prompt.metadata.get("prompt_version", "unknown")),
                )
            if attempt < self.max_provider_attempts:
                issues = "; ".join(issue.message for issue in validation.issues[:4])
                current_prompt = _repair_prompt(current_prompt, issues, attempt)

        details: dict = {}
        if last_validation is not None:
            details["issues"] = [
                issue.model_dump(mode="json") for issue in last_validation.issues
            ]
        if last_provider_error is not None:
            details["provider_code"] = last_provider_error.code
        raise Phase3GenerationError(
            "ORCHESTRATION_VALIDATION_FAILED",
            "Strategy provider did not produce a valid plan within the bounded retry limit.",
            details=details,
        )


def _remaining_deadline_seconds(deadline_at: str | None) -> float | None:
    if deadline_at is None:
        return None
    deadline = datetime.fromisoformat(deadline_at.replace("Z", "+00:00"))
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return (deadline - datetime.now(timezone.utc)).total_seconds()


def _validate_execution_budget(
    *,
    deadline_at: str | None,
    token_budget: int | None,
    cost_budget_usd: float | None,
) -> None:
    if token_budget is not None and token_budget <= 0:
        raise Phase3GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "Strategy generation cannot start with an exhausted token budget.",
        )
    if cost_budget_usd is not None and cost_budget_usd <= 0:
        raise Phase3GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "Strategy generation cannot start with an exhausted cost budget.",
        )
    remaining = _remaining_deadline_seconds(deadline_at)
    if remaining is not None and remaining <= 0:
        raise Phase3GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "Strategy generation cannot start after its deadline.",
            details={"deadline_at": deadline_at},
        )

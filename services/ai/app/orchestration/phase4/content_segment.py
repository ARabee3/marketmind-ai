"""Reusable Content generation/review seam for the isolated Phase 4 graph."""

from __future__ import annotations

import asyncio
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone

from content_contracts import (
    AiContentGenerateRequest,
    ContentItemVersion,
    ContentPack,
    ContentValidationResult,
)
from error_codes import ERROR_CODES

from app.content.assembler import PromptAssembly, assemble_generation_prompt
from app.content.service import generate_content_pack_with_repair
from app.content.validators import validate_generated_content_pack
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider

from .contracts import ContentQualityReviewV1


class Phase4GenerationError(RuntimeError):
    """A bounded Content-generation failure safe to expose to orchestration."""

    def __init__(self, code: str, message: str, *, details: dict | None = None) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown Phase 4 error code: {code}")
        self.code = code
        self.details = details or {}
        super().__init__(message)


@dataclass(frozen=True)
class ContentGenerationResult:
    pack: ContentPack
    item_versions: list[ContentItemVersion]
    validation: ContentValidationResult
    provider_name: str
    prompt_version: str
    estimated_token_usage: int = 0
    estimated_cost_usd: float = 0.0
    provider_attempts: int = 1


@dataclass(frozen=True)
class _ExecutionBudget:
    max_output_tokens: int | None
    provider_attempts: int
    prompt_tokens: int
    active: bool


class ContentSegment:
    """Calls the existing deterministic Content provider/validator pipeline."""

    def __init__(
        self,
        provider: ContentLLMProvider,
        *,
        model_name: str = "phase4-content",
        max_provider_attempts: int = 3,
        cost_ceiling_usd_per_token: float = 0.0001,
    ) -> None:
        if max_provider_attempts < 1:
            raise ValueError("max_provider_attempts must be positive")
        if cost_ceiling_usd_per_token <= 0:
            raise ValueError("cost_ceiling_usd_per_token must be positive")
        self.provider = provider
        self.model_name = model_name
        self.max_provider_attempts = max_provider_attempts
        # This is an intentionally conservative deployment-bound ceiling.  It
        # prevents a run from authorizing more tokens than its USD budget can
        # cover even when a provider does not report usage to this adapter.
        self.cost_ceiling_usd_per_token = cost_ceiling_usd_per_token

    async def generate(
        self,
        request: AiContentGenerateRequest,
        *,
        repair_instruction: str | None = None,
        replan_attempt: int = 0,
        deadline_at: str | None = None,
        token_budget: int | None = None,
        cost_budget_usd: float | None = None,
        token_budget_used: int = 0,
        cost_budget_used_usd: float = 0.0,
    ) -> ContentGenerationResult:
        _validate_execution_budget(
            deadline_at=deadline_at,
            token_budget=token_budget,
            cost_budget_usd=cost_budget_usd,
        )
        try:
            prompt = assemble_generation_prompt(
                request,
                provider_name=self.provider.name,
                model=self.model_name,
            )
        except Exception as exc:
            raise Phase4GenerationError(
                "ORCHESTRATION_VALIDATION_FAILED",
                f"Content prompt preparation failed: {exc}",
            ) from exc

        current_prompt = _targeted_replan_prompt(
            prompt,
            repair_instruction,
            replan_attempt,
        )
        timeout_seconds = _remaining_deadline_seconds(deadline_at)
        if timeout_seconds is not None and timeout_seconds <= 0:
            raise Phase4GenerationError(
                "ORCHESTRATION_BUDGET_EXCEEDED",
                "Content generation cannot start after its deadline.",
                details={"deadline_at": deadline_at},
            )

        budget = _plan_execution_budget(
            current_prompt,
            token_budget=token_budget,
            cost_budget_usd=cost_budget_usd,
            token_budget_used=token_budget_used,
            cost_budget_used_usd=cost_budget_used_usd,
            cost_ceiling_usd_per_token=self.cost_ceiling_usd_per_token,
            max_provider_attempts=self.max_provider_attempts,
        )

        try:
            if timeout_seconds is None:
                items = await generate_content_pack_with_repair(
                    self.provider,
                    current_prompt,
                    request=request,
                    max_attempts=budget.provider_attempts,
                    max_output_tokens=budget.max_output_tokens,
                )
            else:
                async with asyncio.timeout(timeout_seconds):
                    items = await generate_content_pack_with_repair(
                        self.provider,
                        current_prompt,
                        request=request,
                        max_attempts=budget.provider_attempts,
                        max_output_tokens=budget.max_output_tokens,
                    )
        except TimeoutError as exc:
            raise Phase4GenerationError(
                "ORCHESTRATION_BUDGET_EXCEEDED",
                "Content provider exceeded the remaining orchestration deadline.",
                details={"deadline_at": deadline_at},
            ) from exc
        except ProviderError as exc:
            code = exc.code if exc.code in ERROR_CODES else "CONTENT_PROVIDER_FAILURE"
            raise Phase4GenerationError(
                code,
                f"Content provider failed: {exc}",
                details={"provider_code": exc.code, "retryable": exc.retryable},
            ) from exc
        except Exception as exc:
            raise Phase4GenerationError(
                "CONTENT_PROVIDER_FAILURE",
                f"Content provider failed unexpectedly: {exc}",
            ) from exc

        estimated_output_tokens = _estimate_json_tokens(
            [item.model_dump(mode="json") for item in items]
        )
        estimated_token_usage = budget.prompt_tokens + estimated_output_tokens
        if budget.active and budget.max_output_tokens is not None:
            available_tokens = budget.prompt_tokens + budget.max_output_tokens
            if estimated_token_usage > available_tokens:
                raise Phase4GenerationError(
                    "ORCHESTRATION_BUDGET_EXCEEDED",
                    "Content provider output exceeded the remaining orchestration budget.",
                    details={
                        "estimated_token_usage": estimated_token_usage,
                        "available_tokens": available_tokens,
                    },
                )
        estimated_cost_usd = estimated_token_usage * self.cost_ceiling_usd_per_token
        if cost_budget_usd is not None and (
            cost_budget_used_usd + estimated_cost_usd > cost_budget_usd
        ):
            raise Phase4GenerationError(
                "ORCHESTRATION_BUDGET_EXCEEDED",
                "Content provider output exceeded the remaining cost budget.",
                details={
                    "estimated_cost_usd": round(estimated_cost_usd, 8),
                    "cost_budget_usd": cost_budget_usd,
                },
            )

        validation = validate_generated_content_pack(
            request,
            items,
            enforce_asset_readiness=False,
        )
        if not validation.valid:
            issue = validation.issues[0]
            code = issue.code if issue.code in ERROR_CODES else "ORCHESTRATION_VALIDATION_FAILED"
            raise Phase4GenerationError(
                code,
                f"{issue.field}: {issue.message}",
                details={"issues": [item.model_dump(mode="json") for item in validation.issues]},
            )

        return ContentGenerationResult(
            pack=_build_draft_pack(request, items),
            item_versions=items,
            validation=validation,
            provider_name=self.provider.name,
            prompt_version=str(current_prompt.metadata.get("prompt_version", "unknown")),
            estimated_token_usage=estimated_token_usage,
            estimated_cost_usd=estimated_cost_usd,
            provider_attempts=budget.provider_attempts,
        )


class ContentQualityReviewer:
    """Deterministic hard gate for a generated Content pack."""

    async def review(
        self,
        item_versions: list[ContentItemVersion],
        validation: ContentValidationResult,
    ) -> ContentQualityReviewV1:
        if validation.valid:
            repeated_caption = _first_repeated_caption(item_versions)
            if repeated_caption is not None:
                return ContentQualityReviewV1(
                    contract_version="content-quality-review-v1",
                    artifact_type="content_pack",
                    valid=False,
                    issue_code="CONTENT_POLICY_VIOLATION",
                    field="item_versions.caption_variants",
                    severity="warning",
                    repairable=True,
                    short_explanation=(
                        "Content item captions must be meaningfully varied; "
                        f"items {repeated_caption[0]} and {repeated_caption[1]} repeat the same caption."
                    ),
                    recommended_node="content",
                )
            return ContentQualityReviewV1(
                contract_version="content-quality-review-v1",
                artifact_type="content_pack",
                valid=True,
                severity="info",
                repairable=False,
                short_explanation=(
                    f"Content pack contains {len(item_versions)} validated draft item(s)."
                ),
                recommended_node="owner",
            )

        issue = validation.issues[0] if validation.issues else None
        repairable_codes = {
            "CONTENT_SCHEMA_FAILURE",
            "CONTENT_CHANNEL_MISMATCH",
            "CONTENT_OFFER_UNAPPROVED",
            "CONTENT_POLICY_VIOLATION",
            "CONTENT_UNSUPPORTED_CLAIM",
            "CONTENT_VERSION_CONFLICT",
        }
        repairable = bool(issue) and issue.code in repairable_codes
        return ContentQualityReviewV1(
            contract_version="content-quality-review-v1",
            artifact_type="content_pack",
            valid=False,
            issue_code=issue.code if issue else "ORCHESTRATION_VALIDATION_FAILED",
            field=issue.field if issue else "item_versions",
            severity="warning" if repairable else "blocking",
            repairable=repairable,
            short_explanation=(
                issue.message
                if issue
                else "The Content pack failed deterministic validation."
            ),
            recommended_node="content" if repairable else "terminal",
        )


def _build_draft_pack(
    request: AiContentGenerateRequest,
    items: list[ContentItemVersion],
) -> ContentPack:
    now = datetime.now(timezone.utc)
    return ContentPack(
        id=request.content_pack_id,
        contract_version="content-v1",
        content_cycle_id=request.week_context.content_cycle_id,
        weekly_claim_id=request.week_context.weekly_claim_id,
        week_number=request.week_context.week_number,
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        profile_version_id=request.business_profile.id,
        week_context_id=request.week_context.id,
        status="draft",
        retry_eligible=False,
        item_ids=[item.content_item_id for item in items],
        created_at=now,
        updated_at=now,
    )


def _targeted_replan_prompt(
    prompt: PromptAssembly,
    instruction: str | None,
    attempt: int,
) -> PromptAssembly:
    if not instruction:
        return prompt
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "TARGETED CONTENT REPLAN: regenerate the complete Content pack while "
            "preserving the exact Strategy, profile, week context, channels, and "
            "owner instructions. Resolve only the stated review issue."
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            f"Targeted review repair (attempt {attempt}): {instruction}"
        ),
        metadata={
            **prompt.metadata,
            "targeted_replan": True,
            "targeted_replan_attempt": attempt,
        },
        context=prompt.context,
    )


def _estimate_json_tokens(value: object) -> int:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    return max(1, math.ceil(len(encoded) / 3))


def _estimate_prompt_tokens(prompt: PromptAssembly) -> int:
    return _estimate_json_tokens(
        {"system": prompt.system_prompt, "user": prompt.user_prompt}
    )


def _plan_execution_budget(
    prompt: PromptAssembly,
    *,
    token_budget: int | None,
    cost_budget_usd: float | None,
    token_budget_used: int,
    cost_budget_used_usd: float,
    cost_ceiling_usd_per_token: float,
    max_provider_attempts: int,
) -> _ExecutionBudget:
    _validate_execution_budget(
        deadline_at=None,
        token_budget=token_budget,
        cost_budget_usd=cost_budget_usd,
    )
    prompt_tokens = _estimate_prompt_tokens(prompt)
    token_limits: list[int] = []
    if token_budget is not None:
        token_limits.append(token_budget - token_budget_used)
    if cost_budget_usd is not None:
        remaining_cost = cost_budget_usd - cost_budget_used_usd
        token_limits.append(math.floor(remaining_cost / cost_ceiling_usd_per_token))
    if not token_limits:
        return _ExecutionBudget(
            max_output_tokens=None,
            provider_attempts=max_provider_attempts,
            prompt_tokens=0,
            active=False,
        )
    available_tokens = min(token_limits)
    if available_tokens <= prompt_tokens:
        raise Phase4GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "The remaining orchestration budget cannot fit the Content prompt.",
            details={
                "prompt_tokens": prompt_tokens,
                "available_tokens": max(0, available_tokens),
            },
        )
    # An explicit orchestration budget is a total run budget.  Use one provider
    # attempt so provider repair retries cannot multiply the reserved spend;
    # graph-level replanning receives the remaining budget from its checkpoint.
    return _ExecutionBudget(
        max_output_tokens=available_tokens - prompt_tokens,
        provider_attempts=1,
        prompt_tokens=prompt_tokens,
        active=True,
    )


def _first_repeated_caption(
    item_versions: list[ContentItemVersion],
) -> tuple[int, int] | None:
    seen: dict[str, int] = {}
    for index, item in enumerate(item_versions, start=1):
        for variant in item.caption_variants:
            normalized = " ".join(variant.caption.casefold().split())
            if not normalized:
                continue
            previous = seen.get(normalized)
            if previous is not None:
                return previous, index
            seen[normalized] = index
    return None


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
        raise Phase4GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "Content generation cannot start with an exhausted token budget.",
        )
    if cost_budget_usd is not None and cost_budget_usd <= 0:
        raise Phase4GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "Content generation cannot start with an exhausted cost budget.",
        )
    remaining = _remaining_deadline_seconds(deadline_at)
    if remaining is not None and remaining <= 0:
        raise Phase4GenerationError(
            "ORCHESTRATION_BUDGET_EXCEEDED",
            "Content generation cannot start after its deadline.",
            details={"deadline_at": deadline_at},
        )

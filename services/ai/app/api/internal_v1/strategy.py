import asyncio
from typing import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, ValidationError
from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from strategy_contracts import (
    BudgetScenario,
    BusinessProfilePayload,
    DeterministicChannelScorecard,
    KpiTarget,
    StrategyBrief,
    StrategyGenerateRequest,
    StrategyGenerateResponse,
    StrategyPlan,
    StrategyReviseRequest,
    StrategyValidationResult,
)

from app.core.config import Settings, get_settings
from app.db.client import get_db
from app.decisions.errors import DecisionRuleInputError
from app.decisions.explanations import ChannelScoreExplanation, StrategyDecisionBundle
from app.decisions.service import compute_strategy_decisions
from app.providers.base import ProviderError
from app.providers.strategy_provider import StrategyLLMProvider, create_strategy_provider
from app.qdrant.client import create_qdrant_client
from app.rag.errors import RetryableRetrievalError, NonRetryableRetrievalError
from app.rag.schemas import KnowledgeGap, RetrievalQueryContext, RetrievedKnowledgePack
from app.rag.retrieval_service import retrieve_strategy_knowledge
from app.strategy.assembler import (
    DecisionBundle,
    PromptAssembly,
    assemble_generation_prompt,
    assemble_revision_prompt,
)
from app.strategy.retrieval_adapter import contract_pack_to_rag
from app.strategy.validators import validate_plan_against_request


router = APIRouter(prefix="/internal/v1/ai/strategy", tags=["internal-ai-strategy"])
_MAX_GENERATION_ATTEMPTS = 3


async def get_qdrant() -> AsyncGenerator[AsyncQdrantClient, None]:
    client = create_qdrant_client()
    try:
        yield client
    finally:
        await client.close()


@router.post(
    "/retrieve",
    response_model=RetrievedKnowledgePack,
    summary="Retrieve Strategy Knowledge",
    description="Retrieves a filtered, deduplicated, and privacy-scrubbed knowledge pack.",
)
async def retrieve_knowledge(
    strategy_id: UUID,
    brief_id: UUID,
    profile_version_id: UUID,
    query_context: RetrievalQueryContext,
    db_session: AsyncSession = Depends(get_db),
    qdrant_client: AsyncQdrantClient = Depends(get_qdrant),
    settings: Settings = Depends(get_settings),
) -> RetrievedKnowledgePack:
    """Retrieve marketing knowledge using the filtered RAG pipeline."""
    try:
        pack = await retrieve_strategy_knowledge(
            db_session=db_session,
            qdrant_client=qdrant_client,
            settings=settings,
            strategy_id=strategy_id,
            brief_id=brief_id,
            profile_version_id=profile_version_id,
            query_context=query_context,
        )
        return pack
    except RetryableRetrievalError as e:
        raise HTTPException(
            status_code=503,
            detail={"error_type": "retryable", "message": e.message},
        )
    except NonRetryableRetrievalError as e:
        raise HTTPException(
            status_code=400,
            detail={"error_type": "non_retryable", "message": e.message},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error_type": "unknown", "message": str(e)},
        )


class ScoreStrategyRequest(BaseModel):
    """Request body for deterministic strategy scoring."""

    business_profile: BusinessProfilePayload
    brief: StrategyBrief
    retrieval_pack: RetrievedKnowledgePack


class ScoreStrategyResponse(BaseModel):
    """Response body for deterministic strategy scoring."""

    deterministic_channel_scores: list[DeterministicChannelScorecard]
    selected_channels: list[DeterministicChannelScorecard]
    channel_explanations: list[ChannelScoreExplanation]
    budget_scenarios: list[BudgetScenario] | None
    kpi_targets: list[KpiTarget]
    knowledge_gaps: list[KnowledgeGap]


def _language_correction_prompt(
    prompt: PromptAssembly,
    validation: StrategyValidationResult,
    attempt: int,
) -> PromptAssembly:
    mismatch_fields = [
        issue.field
        for issue in validation.issues
        if issue.code == "STRATEGY_LANGUAGE_MISMATCH"
    ]
    fields = ", ".join(mismatch_fields)
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "MANDATORY LANGUAGE CORRECTION: The previous output failed the "
            "owner-facing language gate. Regenerate the complete plan in the "
            "language required by brief.plan_language. Keep URLs, identifiers, "
            "enum values, and provenance metadata unchanged. Do not merely add "
            "a token from the required script."
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            f"Fields that failed the language gate: {fields}."
        ),
        metadata={**prompt.metadata, "language_retry_attempt": attempt},
    )


def _invalid_output_repair_prompt(
    prompt: PromptAssembly,
    error: ProviderError,
    attempt: int,
) -> PromptAssembly:
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "MANDATORY OUTPUT REPAIR: The previous output was rejected because it did "
            "not match the StrategyPlan contract. Regenerate the complete plan as a "
            "single valid JSON object. Reproduce EVERY deterministic channel scorecard "
            "from the supplied channel_scores verbatim in all_channel_scores, select "
            "channels ONLY from those scorecards, and keep every numeric total, enum "
            "value, identifier, and provenance metadata unchanged."
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            f"Validation errors from the rejected output: {error}"
        ),
        metadata={**prompt.metadata, "invalid_output_repair_attempt": attempt},
    )


async def _generate_validated_plan(
    provider: StrategyLLMProvider,
    prompt: PromptAssembly,
    request: StrategyGenerateRequest,
) -> tuple[StrategyPlan, StrategyValidationResult]:
    current_prompt = prompt

    for attempt in range(_MAX_GENERATION_ATTEMPTS):
        try:
            plan = await provider.generate_strategy_plan(current_prompt)
        except ProviderError as error:
            if (
                error.code == "AI_PROVIDER_INVALID_OUTPUT"
                and attempt < _MAX_GENERATION_ATTEMPTS - 1
            ):
                current_prompt = _invalid_output_repair_prompt(
                    prompt=prompt,
                    error=error,
                    attempt=attempt + 1,
                )
                continue
            if not error.retryable or attempt == _MAX_GENERATION_ATTEMPTS - 1:
                status_code = 503 if error.retryable else 400
                raise HTTPException(
                    status_code=status_code,
                    detail={
                        "error_type": error.code,
                        "message": str(error),
                        "retryable": error.retryable,
                    },
                )
            await asyncio.sleep(2 ** attempt)
            continue

        validation = validate_plan_against_request(plan=plan, request=request)
        language_issues = [
            issue
            for issue in validation.issues
            if issue.code == "STRATEGY_LANGUAGE_MISMATCH"
        ]
        if not language_issues:
            return plan, validation

        if attempt == _MAX_GENERATION_ATTEMPTS - 1:
            raise HTTPException(
                status_code=422,
                detail={
                    "error_type": "STRATEGY_LANGUAGE_MISMATCH",
                    "message": (
                        "The provider did not return owner-facing content in "
                        "brief.plan_language after bounded retries."
                    ),
                    "issues": [
                        issue.model_dump(mode="json") for issue in language_issues
                    ],
                },
            )

        current_prompt = _language_correction_prompt(
            prompt=prompt,
            validation=validation,
            attempt=attempt + 1,
        )

    raise RuntimeError("Strategy generation attempts exhausted unexpectedly.")


@router.post(
    "/score",
    response_model=ScoreStrategyResponse,
    summary="Score Strategy Deterministically",
    description="Runs the deterministic channel scoring, selection, budget, and KPI pipeline.",
)
async def score_strategy(
    request: ScoreStrategyRequest = Body(...),
) -> ScoreStrategyResponse:
    """Run deterministic strategy scoring without LLM generation."""
    try:
        bundle = compute_strategy_decisions(
            business_profile=request.business_profile,
            brief=request.brief,
            retrieval_pack=request.retrieval_pack,
        )
    except DecisionRuleInputError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "invalid_input",
                "field": e.field,
                "message": e.message,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error_type": "unknown", "message": str(e)},
        )

    return ScoreStrategyResponse(
        deterministic_channel_scores=bundle.channel_scorecards,
        selected_channels=bundle.selected_channels,
        channel_explanations=bundle.channel_explanations,
        budget_scenarios=bundle.budget_scenarios,
        kpi_targets=bundle.kpi_targets,
        knowledge_gaps=bundle.knowledge_gaps,
    )


# ---------------------------------------------------------------------------
# Strategy generation
# ---------------------------------------------------------------------------


@router.post(
    "/generate",
    response_model=StrategyGenerateResponse,
    summary="Generate grounded Strategy plan",
    description=(
        "Generates a structured 12-week StrategyPlan from the confirmed profile, "
        "strategy brief, persisted retrieval pack, and deterministic decision outputs."
    ),
)
async def generate_strategy(
    request: StrategyGenerateRequest = Body(...),
    settings: Settings = Depends(get_settings),
) -> StrategyGenerateResponse:
    """Generate a grounded StrategyPlan using the configured LLM provider.

    The endpoint:
    1. Adapts the contract retrieval pack to the RAG service shape.
    2. Runs deterministic scoring to obtain budget scenarios and KPI targets.
    3. Assembles a provenance-aware prompt.
    4. Calls the LLM provider with safe retry for transient failures.
    5. Parses and returns the plan.
    """
    try:
        rag_pack = contract_pack_to_rag(request.retrieved_knowledge_pack)
        decisions = compute_strategy_decisions(
            business_profile=request.business_profile,
            brief=request.brief,
            retrieval_pack=rag_pack,
        )
    except DecisionRuleInputError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "invalid_input",
                "field": e.field,
                "message": e.message,
            },
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error_type": "validation_error",
                "message": str(e),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error_type": "decision_failure",
                "message": str(e),
            },
        )

    bundle = DecisionBundle(
        channel_scores=request.deterministic_channel_scores,
        budget_scenarios=decisions.budget_scenarios,
        kpi_targets=decisions.kpi_targets,
    )

    model_name = settings.openai_model or settings.gemini_model or "mock"
    try:
        prompt = assemble_generation_prompt(
            request=request,
            decision_bundle=bundle,
            provider_name=settings.ai_provider_mode,
            model=model_name,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "input_mismatch",
                "message": str(e),
            },
        )

    provider = create_strategy_provider(settings)
    plan, validation = await _generate_validated_plan(
        provider=provider,
        prompt=prompt,
        request=request,
    )

    return StrategyGenerateResponse(
        plan=plan,
        validation=validation,
    )


# ---------------------------------------------------------------------------
# Strategy revision
# ---------------------------------------------------------------------------


@router.post(
    "/revise",
    response_model=StrategyGenerateResponse,
    summary="Revise a Strategy plan from owner feedback",
    description=(
        "Creates a new immutable version of a StrategyPlan based on the owner's "
        "explicit revision notes. The previous plan is preserved unmodified."
    ),
)
async def revise_strategy(
    request: StrategyReviseRequest = Body(...),
    settings: Settings = Depends(get_settings),
) -> StrategyGenerateResponse:
    """Generate a revised StrategyPlan from owner feedback.

    The endpoint:
    1. Runs deterministic scoring on the request inputs.
    2. Assembles a revision prompt that includes the previous plan as read-only context.
    3. Calls the LLM provider with safe retry.
    4. Validates the revised plan and returns it.
    """
    try:
        rag_pack = contract_pack_to_rag(request.retrieved_knowledge_pack)
        decisions = compute_strategy_decisions(
            business_profile=request.business_profile,
            brief=request.brief,
            retrieval_pack=rag_pack,
        )
    except DecisionRuleInputError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "invalid_input",
                "field": e.field,
                "message": e.message,
            },
        )
    except ValidationError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error_type": "validation_error",
                "message": str(e),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error_type": "decision_failure",
                "message": str(e),
            },
        )

    bundle = DecisionBundle(
        channel_scores=request.deterministic_channel_scores,
        budget_scenarios=decisions.budget_scenarios,
        kpi_targets=decisions.kpi_targets,
    )

    model_name = settings.openai_model or settings.gemini_model or "mock"
    try:
        prompt = assemble_revision_prompt(
            request=request,
            decision_bundle=bundle,
            provider_name=settings.ai_provider_mode,
            model=model_name,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "input_mismatch",
                "message": str(e),
            },
        )

    provider = create_strategy_provider(settings)
    plan, validation = await _generate_validated_plan(
        provider=provider,
        prompt=prompt,
        request=request,
    )

    return StrategyGenerateResponse(
        plan=plan,
        validation=validation,
    )

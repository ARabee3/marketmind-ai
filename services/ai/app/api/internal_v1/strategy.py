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
    StrategyBriefV2,
    StrategyGenerateRequest,
    StrategyGenerateResponse,
    StrategyPlan,
    StrategyPlanV2,
    StrategyReviseRequest,
    StrategyValidationResult,
)

from app.core.config import Settings, get_settings
from app.db.client import get_db
from app.decisions.errors import DecisionRuleInputError
from app.decisions.explanations import ChannelScoreExplanation, StrategyDecisionBundle
from app.decisions.service import compute_strategy_decisions, compute_strategy_v2_decisions
from app.providers.base import ProviderError
from app.providers.strategy_provider import (
    StrategyLLMProvider,
    StrategyPlanV2,
    create_strategy_provider,
)
from app.qdrant.client import create_qdrant_client
from app.rag.errors import RetryableRetrievalError, NonRetryableRetrievalError
from app.rag.schemas import KnowledgeGap, RetrievalQueryContext, RetrievedKnowledgePack
from app.rag.retrieval_service import retrieve_strategy_knowledge
from app.strategy.assembler import (
    DecisionBundle,
    PromptAssembly,
    assemble_generation_prompt,
    assemble_generation_v2_prompt,
    assemble_revision_prompt,
    assemble_revision_v2_prompt,
)
from app.strategy.retrieval_adapter import contract_pack_to_rag
from app.strategy.validators import (
    validate_plan_against_request,
    validate_v2_plan_against_request,
)


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
    brief: StrategyBrief | StrategyBriefV2
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


def _validation_repair_prompt(
    prompt: PromptAssembly,
    validation: StrategyValidationResult,
    attempt: int,
) -> PromptAssembly:
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "MANDATORY PLAN VALIDATION REPAIR: The previous output failed the "
            "Strategy policy. Regenerate the complete plan so every validation "
            "issue is resolved. Keep deterministic channel scores, identifiers, "
            "and provenance metadata unchanged. This is a planning-only output: "
            "rewrite affected prose as a strategic explanation, proposal, or "
            "conditional owner decision. In particular, channel_commitments[*].rationale "
            "must explain channel fit and role, never state or imply that a post was, "
            "is, or will be published; an ad was, is, or will be launched; money was, "
            "is, or will be spent; or anything was auto-approved. Do not echo the "
            "validation message as output."
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            "Validation issues to resolve: "
            f"{[issue.model_dump(mode='json') for issue in validation.issues]}"
        ),
        metadata={**prompt.metadata, "validation_retry_attempt": attempt},
    )


async def _generate_validated_plan(
    provider: StrategyLLMProvider,
    prompt: PromptAssembly,
    request: StrategyGenerateRequest,
    *,
    output_model: type[StrategyPlan] | type[StrategyPlanV2] = StrategyPlan,
    normalize_plan=None,
    validate=None,
) -> tuple[StrategyPlan | StrategyPlanV2, StrategyValidationResult]:
    validate = validate or validate_plan_against_request
    current_prompt = PromptAssembly(
        system_prompt=prompt.system_prompt,
        user_prompt=prompt.user_prompt,
        metadata={
            **prompt.metadata,
            "deterministic_channel_scores": [
                score.model_dump(mode="json")
                for score in request.deterministic_channel_scores
            ],
        },
    )

    for attempt in range(_MAX_GENERATION_ATTEMPTS):
        try:
            plan = await provider.generate_strategy_plan(
                current_prompt, output_model=output_model
            )
            if normalize_plan is not None:
                plan = normalize_plan(plan, request)
        except ProviderError as error:
            if (
                error.code == "AI_PROVIDER_INVALID_OUTPUT"
                and attempt < _MAX_GENERATION_ATTEMPTS - 1
            ):
                current_prompt = _invalid_output_repair_prompt(
                    prompt=current_prompt,
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

        validation = validate(plan=plan, request=request)
        if validation.valid:
            return plan, validation

        if attempt == _MAX_GENERATION_ATTEMPTS - 1:
            raise HTTPException(
                status_code=422,
                detail={
                    "error_type": "STRATEGY_PLAN_VALIDATION_FAILED",
                    "message": (
                        "The provider did not return a Strategy plan that satisfies "
                        "the contract after bounded retries."
                    ),
                    "issues": [
                        issue.model_dump(mode="json") for issue in validation.issues
                    ],
                },
            )

        language_only = all(
            issue.code == "STRATEGY_LANGUAGE_MISMATCH"
            for issue in validation.issues
        )
        if language_only:
            current_prompt = _language_correction_prompt(
                prompt=current_prompt,
                validation=validation,
                attempt=attempt + 1,
            )
        else:
            current_prompt = _validation_repair_prompt(
                prompt=current_prompt,
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
        if isinstance(request.brief, StrategyBriefV2):
            bundle = compute_strategy_v2_decisions(
                business_profile=request.business_profile,
                brief=request.brief,
                retrieval_pack=request.retrieval_pack,
            )
        else:
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
    is_v2 = request.contract_version == "strategy-v2"
    try:
        rag_pack = contract_pack_to_rag(request.retrieved_knowledge_pack)
        if is_v2:
            decisions = compute_strategy_v2_decisions(
                business_profile=request.business_profile,
                brief=request.brief,
                retrieval_pack=rag_pack,
            )
        else:
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
        if is_v2:
            prompt = assemble_generation_v2_prompt(
                request=request,
                decision_bundle=bundle,
                provider_name=settings.ai_provider_mode,
                model=model_name,
            )
        else:
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
        output_model=StrategyPlanV2 if is_v2 else StrategyPlan,
        normalize_plan=_normalize_v2_plan if is_v2 else None,
        validate=validate_v2_plan_against_request if is_v2 else None,
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
    is_v2 = request.contract_version == "strategy-v2"
    try:
        rag_pack = contract_pack_to_rag(request.retrieved_knowledge_pack)
        if is_v2:
            decisions = compute_strategy_v2_decisions(
                business_profile=request.business_profile,
                brief=request.brief,
                retrieval_pack=rag_pack,
            )
        else:
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
        if is_v2:
            prompt = assemble_revision_v2_prompt(
                request=request,
                decision_bundle=bundle,
                provider_name=settings.ai_provider_mode,
                model=model_name,
            )
        else:
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
        output_model=StrategyPlanV2 if is_v2 else StrategyPlan,
        normalize_plan=_normalize_v2_plan if is_v2 else None,
        validate=validate_v2_plan_against_request if is_v2 else None,
    )

    return StrategyGenerateResponse(
        plan=plan,
        validation=validation,
    )


def _normalize_v2_plan(
    plan: StrategyPlanV2,
    request: StrategyGenerateRequest,
) -> StrategyPlanV2:
    """Deterministically enforce the owner-first invariant on a v2 plan.

    Channel, role, setup state, and capability state always come from the
    brief's channel choices; the content handoff is projected from the plan's
    calendar weeks. This runs after every provider response, before validation.
    """
    from app.providers.strategy_provider import _normalize_v2_commitments_and_handoff

    plan_dict = plan.model_dump(mode="json")
    choices = [
        {
            "channel": choice.channel.value,
            "role": choice.role.value,
            "setup_state": choice.setup_state.value,
            "public_url": choice.public_url,
            "publishing_target_id": choice.publishing_target_id,
            "note": choice.note,
        }
        for choice in request.brief.channel_choices
    ]
    normalized = _normalize_v2_commitments_and_handoff(
        plan_dict,
        PromptAssembly(
            system_prompt="",
            user_prompt="",
            metadata={"channel_choices": choices},
        ),
    )
    return StrategyPlanV2.model_validate(normalized)

import logging
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from pydantic import ValidationError

from app.core.errors import ErrorBody, provider_error
from app.discovery.question_language import question_matches_language
from app.discovery.research_context_pack import build_research_context_pack
from app.discovery.schemas import (
    AiDiscoveryRespondRequest,
    AiDiscoveryResult,
    AiDiscoveryStartRequest,
    AiDiscoverySummarizeRequest,
    BusinessProfileDraft,
    DiscoveryModelOutput,
    LanguageMode,
    MarketAwareBusinessFacts,
    MarketContextSnapshot,
    MarketEvidence,
    ResearchObservation,
    SourceRef,
    Uncertainty,
    UncertaintyInput,
)
from app.providers.base import DiscoveryProvider, DiscoveryProviderRequest, ProviderError, TurnKind

logger = logging.getLogger(__name__)


class DiscoveryService:
    def __init__(self, provider: DiscoveryProvider) -> None:
        self.provider = provider

    async def start(self, request: AiDiscoveryStartRequest) -> AiDiscoveryResult:
        return await self._run("start", request)

    async def respond(self, request: AiDiscoveryRespondRequest) -> AiDiscoveryResult:
        return await self._run("respond", request)

    async def summarize(self, request: AiDiscoverySummarizeRequest) -> AiDiscoveryResult:
        return await self._run("summarize", request)

    async def _run(
        self,
        turn_kind: TurnKind,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
    ) -> AiDiscoveryResult:
        accepted_observations, accepted_sources = self._accepted_research(request)
        provider_payload = request.model_dump(mode="json")
        provider_payload["intelligence"]["research_observations"] = [
            observation.model_dump(mode="json")
            for observation in accepted_observations
        ]
        provider_payload["intelligence"]["source_refs"] = [
            source.model_dump(mode="json") for source in accepted_sources
        ]
        provider_payload["intelligence"]["research_context_pack"] = (
            build_research_context_pack(accepted_observations, accepted_sources)
        )
        provider_request = DiscoveryProviderRequest(
            session_id=request.session_id,
            turn_kind=turn_kind,
            language_mode=request.language_mode,
            payload=provider_payload,
        )
        logger.info("discovery_provider_call mode=%s turn=%s", self.provider.name, turn_kind)
        try:
            raw_output = await self.provider.generate_structured(provider_request)
            model_output = DiscoveryModelOutput.model_validate(raw_output)
        except ValidationError as exc:
            logger.warning("discovery_provider_invalid_output mode=%s", self.provider.name)
            return self._safe_failure(
                request,
                provider_error(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    "The AI provider returned an invalid Discovery response. Please retry.",
                    retryable=True,
                ),
                validation_errors=exc.errors(),
            )
        except ProviderError as exc:
            logger.warning("discovery_provider_error mode=%s code=%s", self.provider.name, exc.code)
            return self._safe_failure(
                request,
                provider_error(exc.code, str(exc), retryable=exc.retryable),
            )

        if not self._valid_turn_output(turn_kind, model_output, request.language_mode):
            return self._safe_failure(
                request,
                provider_error(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    "The AI provider returned an action that is invalid for this Discovery turn.",
                    retryable=True,
                ),
            )

        return self._to_result(
            request,
            model_output,
            accepted_observations,
            accepted_sources,
        )

    def _to_result(
        self,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
        output: DiscoveryModelOutput,
        accepted_observations: list[ResearchObservation],
        accepted_sources: list[SourceRef],
    ) -> AiDiscoveryResult:
        normalized_facts = self._normalize_facts(request, output)
        profile_draft = None
        if output.action == "produce_profile_draft":
            profile_draft = self._build_profile_draft(
                request,
                output,
                accepted_observations,
                normalized_facts,
            )

        return AiDiscoveryResult(
            action=output.action,
            next_question=output.next_question,
            suggested_answers=(
                output.suggested_answers
                if output.action in {"ask_next_question", "ask_clarification"}
                else []
            ),
            updated_known_facts=normalized_facts,
            updated_uncertainties=output.updated_uncertainties,
            research_observations=accepted_observations,
            source_refs=accepted_sources,
            domain_scores=output.domain_scores,
            ready_to_summarize=output.ready_to_summarize,
            profile_draft=profile_draft,
            safe_error=None,
        )

    def _build_profile_draft(
        self,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
        output: DiscoveryModelOutput,
        accepted_observations: list[ResearchObservation],
        normalized_facts: MarketAwareBusinessFacts,
    ) -> BusinessProfileDraft:
        if not isinstance(request, AiDiscoverySummarizeRequest):
            raise ValueError("Profile drafts may only be built during summarize turns.")

        uncertainties = self._completion_uncertainties(
            output.updated_uncertainties,
            request,
        )
        return BusinessProfileDraft(
            id=str(uuid5(NAMESPACE_URL, f"marketmind:profile-draft:{request.session_id}:1")),
            session_id=request.session_id,
            version=1,
            status="ready_for_confirmation",
            completeness=request.completion_context.completeness,
            completion_reason=request.completion_context.reason,
            readiness=request.completion_context.readiness,
            confirmed_facts=normalized_facts,
            market_context=self._market_context(accepted_observations),
            research_observations=accepted_observations,
            uncertainties=[
                Uncertainty(**uncertainty.model_dump(), resolved=False)
                for uncertainty in uncertainties
            ],
            owner_goals=output.owner_goals,
            strategy_relevant_notes=output.strategy_relevant_notes,
            raw_ai_output=output.model_dump(mode="json"),
        )

    def _safe_failure(
        self,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
        safe_error: ErrorBody,
        validation_errors: list[dict[str, Any]] | None = None,
    ) -> AiDiscoveryResult:
        accepted_observations, accepted_sources = self._accepted_research(request)
        details = {"validation_errors": validation_errors} if validation_errors else {}
        error = safe_error.model_copy(update={"details": details})
        return AiDiscoveryResult(
            action="safe_failure",
            next_question=None,
            suggested_answers=[],
            updated_known_facts=self._normalize_facts(
                request,
                DiscoveryModelOutput(
                    action="safe_failure",
                    updated_known_facts=MarketAwareBusinessFacts(),
                    updated_uncertainties=[],
                    domain_scores={},
                    ready_to_summarize=False,
                ),
            ),
            updated_uncertainties=[],
            research_observations=accepted_observations,
            source_refs=accepted_sources,
            domain_scores={},
            ready_to_summarize=False,
            profile_draft=None,
            safe_error=error,
        )

    def _normalize_facts(
        self,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
        output: DiscoveryModelOutput,
    ) -> MarketAwareBusinessFacts:
        facts = output.updated_known_facts
        intake = request.intake
        identity = facts.identity.model_copy(
            update={
                "business_name": facts.identity.business_name or intake.business_name,
                "business_type": facts.identity.business_type or intake.business_type,
                "city": facts.identity.city or intake.city,
                "area": facts.identity.area or intake.area,
            }
        )
        goals = _unique_strings(
            [
                *facts.goals_and_constraints.growth_goals,
                *output.owner_goals,
                *([intake.owner_goal_text] if intake.owner_goal_text else []),
            ]
        )
        goals_and_constraints = facts.goals_and_constraints.model_copy(
            update={"growth_goals": goals}
        )
        submitted_channels = [
            link.platform
            for link in intake.social_links
            if link.platform != "delivery"
        ]
        delivery_platforms = [
            link.platform for link in intake.social_links if link.platform == "delivery"
        ]
        current_marketing = facts.current_marketing.model_copy(
            update={
                "active_channels": _unique_strings(
                    [*facts.current_marketing.active_channels, *submitted_channels]
                ),
                "delivery_platforms": _unique_strings(
                    [
                        *facts.current_marketing.delivery_platforms,
                        *delivery_platforms,
                    ]
                ),
            }
        )

        return facts.model_copy(
            update={
                "identity": identity,
                "current_marketing": current_marketing,
                "goals_and_constraints": goals_and_constraints,
            }
        )

    def _market_context(
        self,
        observations: list[ResearchObservation],
    ) -> MarketContextSnapshot:
        grouped: dict[str, list[MarketEvidence]] = {
            "competitor_landscape": [],
            "local_demand_signals": [],
            "digital_presence_signals": [],
            "other_signals": [],
        }
        for observation in observations:
            if not observation.source_ref_id:
                continue
            evidence = MarketEvidence(
                observation_id=observation.id,
                source_ref_id=observation.source_ref_id,
                statement=observation.statement,
                confidence=observation.confidence,
            )
            if observation.kind == "competitor":
                grouped["competitor_landscape"].append(evidence)
            elif observation.kind == "market_context":
                grouped["local_demand_signals"].append(evidence)
            elif observation.kind in {"digital_presence", "social_signal"}:
                grouped["digital_presence_signals"].append(evidence)
            else:
                grouped["other_signals"].append(evidence)

        return MarketContextSnapshot(**grouped)

    def _accepted_research(
        self,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
    ) -> tuple[list[ResearchObservation], list[SourceRef]]:
        observations = [
            observation
            for observation in request.intelligence.research_observations
            if observation.status == "accepted"
        ]
        referenced_source_ids = {
            observation.source_ref_id
            for observation in observations
            if observation.source_ref_id
        }
        sources = [
            source
            for source in request.intelligence.source_refs
            if source.id in referenced_source_ids
        ]
        return observations, sources

    def _valid_turn_output(
        self,
        turn_kind: TurnKind,
        output: DiscoveryModelOutput,
        language_mode: LanguageMode,
    ) -> bool:
        if turn_kind == "summarize":
            return (
                output.action == "produce_profile_draft"
                and output.next_question is None
            )
        if output.action not in {"ask_next_question", "ask_clarification"}:
            return False
        if not output.next_question or not output.next_question.strip():
            return False
        return question_matches_language(output.next_question, language_mode)

    def _completion_uncertainties(
        self,
        uncertainties: list[UncertaintyInput],
        request: AiDiscoverySummarizeRequest,
    ) -> list[UncertaintyInput]:
        result = list(uncertainties)
        existing_domains = {uncertainty.domain for uncertainty in result}
        for domain in request.completion_context.readiness.blocking_domains:
            if domain in existing_domains:
                continue
            result.append(
                UncertaintyInput(
                    domain=domain,
                    field_key=f"{domain}.completion_gap",
                    description=(
                        f"The {domain.replace('_', ' ')} domain was incomplete "
                        f"when Discovery ended because of "
                        f"{request.completion_context.reason}."
                    ),
                    severity="medium",
                    category="missing_information",
                    source="ai_inference",
                )
            )
        return result


def _unique_strings(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value.strip() for value in values if value.strip()))

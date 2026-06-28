import logging
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from pydantic import ValidationError

from app.core.errors import ErrorBody, provider_error
from app.discovery.schemas import (
    AiDiscoveryRespondRequest,
    AiDiscoveryResult,
    AiDiscoveryStartRequest,
    AiDiscoverySummarizeRequest,
    BusinessProfileDraft,
    DiscoveryModelOutput,
    ResearchObservation,
    SourceRef,
    Uncertainty,
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
        profile_draft = None
        if output.action == "produce_profile_draft":
            profile_draft = self._build_profile_draft(
                request,
                output,
                accepted_observations,
            )

        return AiDiscoveryResult(
            action=output.action,
            next_question=output.next_question,
            updated_known_facts=output.updated_known_facts,
            updated_uncertainties=output.updated_uncertainties,
            research_observations=accepted_observations,
            source_refs=accepted_sources,
            domain_scores=output.domain_scores,
            profile_draft=profile_draft,
            safe_error=None,
        )

    def _build_profile_draft(
        self,
        request: AiDiscoveryStartRequest | AiDiscoveryRespondRequest | AiDiscoverySummarizeRequest,
        output: DiscoveryModelOutput,
        accepted_observations: list[ResearchObservation],
    ) -> BusinessProfileDraft:
        return BusinessProfileDraft(
            id=str(uuid5(NAMESPACE_URL, f"marketmind:profile-draft:{request.session_id}:1")),
            session_id=request.session_id,
            version=1,
            status="ready_for_confirmation",
            confirmed_facts=output.updated_known_facts,
            research_observations=accepted_observations,
            uncertainties=[
                Uncertainty(**uncertainty.model_dump(), resolved=False)
                for uncertainty in output.updated_uncertainties
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
            updated_known_facts={},
            updated_uncertainties=[],
            research_observations=accepted_observations,
            source_refs=accepted_sources,
            domain_scores={},
            profile_draft=None,
            safe_error=error,
        )

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

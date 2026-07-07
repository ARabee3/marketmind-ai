from typing import Any

from app.discovery.schemas import ResearchObservation, SourceRef


def build_research_context_pack(
    observations: list[ResearchObservation],
    sources: list[SourceRef],
) -> dict[str, list[dict[str, Any]]]:
    source_by_id = {source.id: source for source in sources}
    accepted: list[dict[str, Any]] = []
    unconfirmed: list[dict[str, Any]] = []
    competitors: list[dict[str, Any]] = []
    social_signals: list[dict[str, Any]] = []
    market_signals: list[dict[str, Any]] = []
    suggested_questions: list[dict[str, Any]] = []

    for observation in observations:
        item = _observation_context_item(
            observation,
            source_by_id.get(observation.source_ref_id or ""),
        )
        is_unconfirmed = (
            observation.metadata.get("evidence_tier") == "needs_confirmation"
        )
        if is_unconfirmed:
            unconfirmed.append(item)
        else:
            accepted.append(item)

        match observation.kind:
            case "competitor":
                competitors.append(item)
            case "digital_presence" | "social_signal":
                social_signals.append(item)
            case "market_context":
                if not is_unconfirmed:
                    market_signals.append(item)
            case "metadata":
                pass
            case unreachable:
                raise ValueError(f"Unhandled observation kind: {unreachable}")

        question = observation.metadata.get("suggested_owner_question")
        if isinstance(question, str) and question.strip():
            suggested_questions.append(
                {
                    "observation_id": observation.id,
                    "question": question.strip(),
                }
            )

    return {
        "accepted_observations": accepted,
        "unconfirmed_findings": unconfirmed,
        "competitor_candidates": competitors,
        "social_presence_signals": social_signals,
        "market_context_signals": market_signals,
        "suggested_owner_questions": suggested_questions,
        "source_quality_notes": [_source_quality_note(source) for source in sources],
    }


def _observation_context_item(
    observation: ResearchObservation,
    source: SourceRef | None,
) -> dict[str, Any]:
    return {
        "observation_id": observation.id,
        "source_ref_id": observation.source_ref_id,
        "kind": observation.kind,
        "statement": observation.statement,
        "confidence": observation.confidence,
        "evidence_tier": observation.metadata.get("evidence_tier"),
        "classification": observation.metadata.get("classification"),
        "source_title": source.title if source else None,
        "source_url": source.url if source else None,
        "source_platform": source.platform if source else None,
    }


def _source_quality_note(source: SourceRef) -> dict[str, Any]:
    return {
        "source_ref_id": source.id,
        "platform": source.platform,
        "provider": source.metadata.get("provider", source.platform),
        "confidence": source.confidence,
        "enrichment_status": source.metadata.get("enrichment_status"),
    }

from typing import Literal

from pydantic import BaseModel, Field, model_validator

ReviewOutcome = Literal["approved", "revision_requested", "unavailable"]
RelevanceLabel = Literal["relevant", "not_relevant"]


class RetrievalQueryInput(BaseModel):
    business_type: str = Field(min_length=1)
    market: str = Field(min_length=1)
    locale: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    funnel_stage: str = Field(min_length=1)
    active_channels: list[str]
    asset_capability: list[str]
    team_capacity: str = Field(min_length=1)
    budget_mode: str = Field(min_length=1)
    industry: str | None = None
    paid_media_allowed: bool = True


class ExpectedRetrieval(BaseModel):
    expected_chunk_ids: list[str]
    forbidden_chunk_ids: list[str]
    required_gap_categories: list[str]
    min_top5_hit_rate: float = 0.8
    # Optional human labels used only for the honest ranking metrics. Legacy
    # cases remain valid and are reported as unmeasured until their returned
    # top-five candidates are labeled.
    relevance_labels: dict[str, RelevanceLabel] = Field(default_factory=dict)
    known_relevant_chunk_ids: list[str] = Field(default_factory=list)
    relevance_labels_complete: bool = False

    @model_validator(mode="after")
    def validate_complete_relevance_set(self) -> "ExpectedRetrieval":
        """Prevent a declared-complete set from silently omitting relevance."""

        if not self.relevance_labels_complete:
            return self

        labeled_relevant = {
            chunk_id
            for chunk_id, label in self.relevance_labels.items()
            if label == "relevant"
        }
        known_relevant = set(self.known_relevant_chunk_ids)
        if labeled_relevant != known_relevant:
            raise ValueError(
                "known_relevant_chunk_ids must exactly match relevance_labels "
                "marked relevant when relevance_labels_complete is true"
            )
        return self


class HardFilterCase(BaseModel):
    chunk_id: str = Field(min_length=1)
    filter_reason: str = Field(min_length=1)


class EvalCase(BaseModel):
    id: str = Field(min_length=1)
    sector: str = Field(min_length=1)
    language: str = Field(min_length=1)
    description: str = Field(min_length=1)
    query_input: RetrievalQueryInput
    expected_retrieval: ExpectedRetrieval
    hard_filter_cases: list[HardFilterCase]
    reviewer: str = Field(min_length=1)
    reviewed_at: str = Field(min_length=1)
    review_outcome: ReviewOutcome = "unavailable"
    review_notes: str = "Legacy case review did not record owner approval or revision outcome."


class EvalDataset(BaseModel):
    version: str = Field(min_length=1)
    cases: list[EvalCase]
    created_at: str = Field(min_length=1)

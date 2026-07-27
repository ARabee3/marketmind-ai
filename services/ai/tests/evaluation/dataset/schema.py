from pydantic import BaseModel, Field


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


class EvalDataset(BaseModel):
    version: str = Field(min_length=1)
    cases: list[EvalCase]
    created_at: str = Field(min_length=1)

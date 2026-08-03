"""Immutable Content evaluation case schema (Phase 1).

This is the contract-eval case format: every case references either a frozen
#107 fixture or an inline ``ContentPolicyFixture``, and carries the expected
deterministic outcome plus named-human rubric slots and reviewer sign-offs.

The schema version lets the format evolve without breaking old cases.
"""

from __future__ import annotations

from typing import Literal

from content_contracts import (
    ContentChannel,
    ContentErrorCode,
    ContentFormat,
    ContentPolicyFixture,
    FrozenModel,
)
from pydantic import Field, model_validator

ContentEvalSchemaVersion = Literal["content-eval-v1"]
Sector = Literal["hospitality", "retail", "services", "education", "healthcare"]
ContentEvalLanguageMode = Literal["ar", "en", "mixed"]
HardOutcome = Literal["pass", "fail"]
ContentProviderMode = Literal["normal", "timeout", "failed_image"]
FailureCategory = Literal[
    "no_failure",
    "unapproved_strategy",
    "stale_profile",
    "cycle_paused",
    "cycle_completed",
    "week_out_of_range",
    "week_already_claimed",
    "channel_mismatch",
    "unsupported_claim",
    "offer_unapproved",
    "policy_violation",
    "asset_required",
    "schema_failure",
    "version_conflict",
    "approval_blocked",
    "provider_failure",
    "candidate_tampered",
    "candidate_revoked",
    "prompt_injection",
    "revision_preservation",
]


class PillarRef(FrozenModel):
    """One content pillar from the approved Strategy snapshot."""

    pillar_id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class StrategySnapshot(FrozenModel):
    """Owner-approved Strategy snapshot the case is testing against."""

    approved_channels: list[ContentChannel] = Field(min_length=1)
    pillars: list[PillarRef] = Field(min_length=1)
    tone: str = Field(min_length=1)
    formats: list[ContentFormat] = Field(min_length=1)
    content_count: int = Field(ge=3, le=5)
    fact_sources: list[str] = Field(min_length=1)
    owner_inputs: list[str]


class NextWeekContext(FrozenModel):
    """Owner-confirmed next-week context, or the explicit absence of one."""

    promotion_mode: Literal["none", "owner_approved"]
    promotion_text: str | None = None
    promotion_terms: list[str] = []
    valid_from: str | None = None
    valid_until: str | None = None
    must_include: list[str] = []
    must_avoid: list[str] = []
    approved_asset_ids: list[str] = []
    cta_destination_type: Literal["phone", "whatsapp", "website", "address", "none"]
    cta_destination_value: str | None = None


class CycleState(FrozenModel):
    """Rolling-cycle state the case exercises."""

    content_cycle_id: str = Field(min_length=1)
    week_number: int = Field(ge=1, le=13)
    prior_content_pack_id: str | None = None
    next_week_context: NextWeekContext | None = None
    next_week_context_absent: bool = False


class ProtectedFictionalFields(FrozenModel):
    """Synthetic business data that must never leak or be mutated."""

    business_name: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    handles: list[str]
    addresses: list[str]
    prices: list[str]
    offer_terms: list[str]
    owner_text: str = Field(min_length=1)


class ExpectedHardOutcome(FrozenModel):
    """Per-guardrail pass/fail expectations and the resulting error codes."""

    expected_result: HardOutcome
    per_guardrail: dict[str, HardOutcome] = {}
    expected_error_codes: list[ContentErrorCode] = []


class RubricScore(FrozenModel):
    """One dimension scored by a named human reviewer, never by the model."""

    score: int = Field(ge=0, le=5)
    reviewer_handle: str = Field(min_length=1)
    reviewed_at: str = Field(min_length=1)
    notes: str = ""


class HumanRubric(FrozenModel):
    """Human-reviewed rubric: language, tone, usefulness, pillar, CTA."""

    language: RubricScore
    tone: RubricScore
    usefulness: RubricScore
    pillar_alignment: RubricScore
    cta: RubricScore


class ReviewerSignOff(FrozenModel):
    """One named reviewer slot with a per-case sign-off."""

    role: str = Field(min_length=1)
    handle: str = Field(min_length=1)
    signed_off: bool = False
    signed_at: str | None = None
    notes: str = ""


class ReviewerSignOffs(FrozenModel):
    """The four up-front reviewer assignments, locked per case."""

    owner_mokhtar: ReviewerSignOff
    eval_mostafa: ReviewerSignOff
    ai_product_merzk: ReviewerSignOff
    safety_rabee: ReviewerSignOff


class ContentEvalCase(FrozenModel):
    """One immutable Content evaluation case.

    References either a frozen #107 fixture via ``fixture_ref`` or an inline
    ``ContentPolicyFixture``. The schema version isolates the eval format from
    the contract version so old cases keep validating after either one changes.
    """

    case_id: str = Field(min_length=1)
    schema_version: ContentEvalSchemaVersion
    sector: Sector
    language_mode: ContentEvalLanguageMode
    strategy_snapshot: StrategySnapshot
    cycle_state: CycleState
    protected_fictional_fields: ProtectedFictionalFields
    expected_hard_outcome: ExpectedHardOutcome
    failure_category: FailureCategory
    human_rubric: HumanRubric
    reviewers: ReviewerSignOffs
    description: str = Field(min_length=1)
    fixture_ref: str | None = None
    policy_fixture: ContentPolicyFixture | None = None
    provider_mode: ContentProviderMode | None = None
    created_at: str = Field(min_length=1)
    updated_at: str | None = None

    @model_validator(mode="after")
    def check_one_fixture_source(self) -> "ContentEvalCase":
        if self.fixture_ref is None and self.policy_fixture is None:
            raise ValueError(
                "An eval case must reference either fixture_ref or policy_fixture."
            )
        return self

    @model_validator(mode="after")
    def check_outcome_matches_error_codes(self) -> "ContentEvalCase":
        if self.expected_hard_outcome.expected_result == "fail":
            if not self.expected_hard_outcome.expected_error_codes:
                raise ValueError(
                    "A failure case must list at least one expected error code."
                )
        else:
            if self.expected_hard_outcome.expected_error_codes:
                raise ValueError(
                    "A passing case must not list expected error codes."
                )
        return self

    @model_validator(mode="after")
    def check_no_failure_category_for_pass(self) -> "ContentEvalCase":
        if (
            self.expected_hard_outcome.expected_result == "pass"
            and self.failure_category not in {"no_failure", "revision_preservation"}
        ):
            raise ValueError(
                "A passing case must use failure_category='no_failure' or "
                "'revision_preservation'."
            )
        return self

    @model_validator(mode="after")
    def check_next_week_context_absence(self) -> "ContentEvalCase":
        if self.cycle_state.next_week_context_absent:
            if self.cycle_state.next_week_context is not None:
                raise ValueError(
                    "next_week_context_absent=True requires next_week_context=None."
                )
        else:
            if self.cycle_state.next_week_context is None:
                raise ValueError(
                    "next_week_context_absent=False requires a next_week_context."
                )
        return self

    @property
    def is_final(self) -> bool:
        """A case is final only when every named reviewer has signed off."""
        return all(
            reviewer.signed_off
            for reviewer in (
                self.reviewers.owner_mokhtar,
                self.reviewers.eval_mostafa,
                self.reviewers.ai_product_merzk,
                self.reviewers.safety_rabee,
            )
        )

    @property
    def average_rubric_score(self) -> float:
        """Average of the five human rubric scores."""
        scores = [
            self.human_rubric.language.score,
            self.human_rubric.tone.score,
            self.human_rubric.usefulness.score,
            self.human_rubric.pillar_alignment.score,
            self.human_rubric.cta.score,
        ]
        return sum(scores) / len(scores)


class ContentEvalDataset(FrozenModel):
    """A versioned dataset of Content evaluation cases."""

    version: str = Field(min_length=1)
    schema_version: ContentEvalSchemaVersion = "content-eval-v1"
    cases: list[ContentEvalCase]
    created_at: str = Field(min_length=1)
    updated_at: str | None = None


# Re-export the frozen reviewers so callers can build them without hard-coding
# handles in every case file.
DEFAULT_REVIEWER_HANDLES = {
    "owner_mokhtar": "@MOKHXXXXXX",
    "eval_mostafa": "@MostafaAhmed22",
    "ai_product_merzk": "@mostafamerzk",
    "safety_rabee": "@ARabee3",
}


def default_reviewer_signoffs(
    *,
    owner_mokhtar_notes: str = "",
    eval_mostafa_notes: str = "",
    ai_product_merzk_notes: str = "",
    safety_rabee_notes: str = "",
) -> ReviewerSignOffs:
    """Build the four locked reviewer slots with no sign-offs yet."""
    return ReviewerSignOffs(
        owner_mokhtar=ReviewerSignOff(
            role="Owner",
            handle="@MOKHXXXXXX",
            notes=owner_mokhtar_notes,
        ),
        eval_mostafa=ReviewerSignOff(
            role="Eval reviewer",
            handle="@MostafaAhmed22",
            notes=eval_mostafa_notes,
        ),
        ai_product_merzk=ReviewerSignOff(
            role="AI/product reviewer",
            handle="@mostafamerzk",
            notes=ai_product_merzk_notes,
        ),
        safety_rabee=ReviewerSignOff(
            role="Safety reviewer",
            handle="@ARabee3",
            notes=safety_rabee_notes,
        ),
    )


def to_contract_language_mode(mode: ContentEvalLanguageMode) -> str:
    """Map eval case language_mode to the #107 contract language mode.

    The eval schema uses the shorter ``ar`` for brevity; the contract expects
    ``ar-EG``.
    """
    if mode == "ar":
        return "ar-EG"
    return mode


__all__ = [
    "ContentEvalSchemaVersion",
    "Sector",
    "ContentEvalLanguageMode",
    "HardOutcome",
    "FailureCategory",
    "PillarRef",
    "StrategySnapshot",
    "NextWeekContext",
    "CycleState",
    "ProtectedFictionalFields",
    "ExpectedHardOutcome",
    "RubricScore",
    "HumanRubric",
    "ReviewerSignOff",
    "ReviewerSignOffs",
    "ContentEvalCase",
    "ContentEvalDataset",
    "ContentProviderMode",
    "DEFAULT_REVIEWER_HANDLES",
    "default_reviewer_signoffs",
    "to_contract_language_mode",
]

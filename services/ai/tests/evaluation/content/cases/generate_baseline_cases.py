"""Generate Phase 2 baseline coverage case files with inline policy fixtures.

Each case is self-contained: the eval schema carries a complete
``ContentPolicyFixture`` so the Phase 4 deterministic validators can run against it
without needing to reconstruct the fixture from a fragment reference.

Produces one JSON dataset per sector under ``cases/`` with three cases each:
- 15 baseline cases total (3 per sector × 5 sectors)
- Language modes distributed evenly (one ar, one en, one mixed per sector)
- All required rolling-cycle scenarios covered
- All protected fields use synthetic fictional business data

Run from the ``services/ai`` directory:

    python tests/evaluation/content/cases/generate_baseline_cases.py
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Add the AI service root and the frozen contract package so imports resolve
# when the script is run directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
sys.path.insert(
    0, str(Path(__file__).resolve().parents[6] / "packages" / "contracts" / "python")
)

from content_contracts import (
    ContentAsset,
    ContentAssetKind,
    ContentAssetStatus,
    ContentCaptionVariant,
    ContentClaimSource,
    ContentCtaDestination,
    ContentDecision,
    ContentGenerationProvenance,
    ContentItemVersion,
    ContentPack,
    ContentPolicyFixture,
    ContentPromotion,
    ContentRecommendedWindow,
    ContentStrategyDecisionRef,
    ContentStrategyTrace,
    ContentWeekContext,
    FrozenModel,
)

from tests.evaluation.content.schema import (
    ContentEvalCase,
    ContentEvalDataset,
    CycleState,
    ExpectedHardOutcome,
    FailureCategory,
    HumanRubric,
    NextWeekContext,
    ProtectedFictionalFields,
    RubricScore,
    StrategySnapshot,
    default_reviewer_signoffs,
)


OUTPUT_DIR = Path(__file__).resolve().parent
REVIEWER = "@mostafamerzk"
REVIEWED_AT = "2026-08-03"
DATASET_VERSION = "content-eval-baseline-v1"

BASE_POLICY_FIXTURE_PATH = (
    Path(__file__).resolve().parents[6]
    / "packages"
    / "contracts"
    / "examples"
    / "content-pack-week-1-ar.example.json"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uuid(seed: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, seed))


def _rubric(score: int = 4, notes: str = "") -> HumanRubric:
    return HumanRubric(
        language=RubricScore(
            score=score, reviewer_handle=REVIEWER, reviewed_at=REVIEWED_AT, notes=notes
        ),
        tone=RubricScore(
            score=score, reviewer_handle=REVIEWER, reviewed_at=REVIEWED_AT, notes=notes
        ),
        usefulness=RubricScore(
            score=score, reviewer_handle=REVIEWER, reviewed_at=REVIEWED_AT, notes=notes
        ),
        pillar_alignment=RubricScore(
            score=score, reviewer_handle=REVIEWER, reviewed_at=REVIEWED_AT, notes=notes
        ),
        cta=RubricScore(
            score=score, reviewer_handle=REVIEWER, reviewed_at=REVIEWED_AT, notes=notes
        ),
        dialect=RubricScore(
            score=score, reviewer_handle=REVIEWER, reviewed_at=REVIEWED_AT, notes=notes
        ),
    )


def _strategy_snapshot(
    *,
    channels: list[str],
    pillars: list[tuple[str, str]],
    tone: str,
    formats: list[str],
    content_count: int,
    fact_sources: list[str],
    owner_inputs: list[str],
    funnel_stages: list[str] | None = None,
) -> StrategySnapshot:
    return StrategySnapshot(
        approved_channels=channels,  # type: ignore[arg-type]
        pillars=[{"pillar_id": pid, "name": name} for pid, name in pillars],
        tone=tone,
        formats=formats,  # type: ignore[arg-type]
        content_count=content_count,
        fact_sources=fact_sources,
        owner_inputs=owner_inputs,
        funnel_stages=funnel_stages or [],
    )


def _protected(
    *,
    business_name: str,
    owner_name: str,
    handles: list[str],
    addresses: list[str],
    prices: list[str],
    offer_terms: list[str],
    owner_text: str,
) -> ProtectedFictionalFields:
    return ProtectedFictionalFields(
        business_name=business_name,
        owner_name=owner_name,
        handles=handles,
        addresses=addresses,
        prices=prices,
        offer_terms=offer_terms,
        owner_text=owner_text,
    )


def _cycle(
    *,
    cycle_id: str,
    week_number: int,
    prior_pack_id: str | None = None,
    next_context: NextWeekContext | None = None,
    next_absent: bool = False,
) -> CycleState:
    return CycleState(
        content_cycle_id=cycle_id,
        week_number=week_number,
        prior_content_pack_id=prior_pack_id,
        next_week_context=next_context,
        next_week_context_absent=next_absent,
    )


def _case(
    *,
    case_id: str,
    sector: str,
    language_mode: str,
    strategy_snapshot: StrategySnapshot,
    cycle_state: CycleState,
    protected: ProtectedFictionalFields,
    expected_result: str,
    per_guardrail: dict[str, str],
    expected_error_codes: list[str],
    failure_category: FailureCategory,
    rubric: HumanRubric,
    description: str,
    policy_fixture: ContentPolicyFixture,
) -> ContentEvalCase:
    return ContentEvalCase(
        case_id=case_id,
        schema_version="content-eval-v1",
        sector=sector,  # type: ignore[arg-type]
        language_mode=language_mode,  # type: ignore[arg-type]
        strategy_snapshot=strategy_snapshot,
        cycle_state=cycle_state,
        protected_fictional_fields=protected,
        expected_hard_outcome=ExpectedHardOutcome(
            expected_result=expected_result,  # type: ignore[arg-type]
            per_guardrail=per_guardrail,
            expected_error_codes=expected_error_codes,  # type: ignore[arg-type]
        ),
        failure_category=failure_category,
        human_rubric=rubric,
        reviewers=default_reviewer_signoffs(),
        description=description,
        fixture_ref=None,
        policy_fixture=policy_fixture,
        created_at=REVIEWED_AT,
    )


def _load_base_policy_fixture() -> ContentPolicyFixture:
    return ContentPolicyFixture.model_validate(
        json.loads(BASE_POLICY_FIXTURE_PATH.read_text(encoding="utf-8"))
    )


def _build_caption_variants(
    *,
    language_mode: str,
    theme: str,
    promotion_text: str | None,
    promotion_terms: list[str],
    must_include: list[str],
    cta: str | None,
) -> list[ContentCaptionVariant]:
    """Produce deterministic caption variants for the language mode."""
    if language_mode == "en":
        parts = [f"Explore this week's focus: {theme}."]
        if promotion_text:
            parts.append(promotion_text)
        if promotion_terms:
            parts.append(f"Terms: {'; '.join(promotion_terms)}")
        parts.extend(must_include)
        if cta:
            parts.append(cta)
        caption = " ".join(parts)
        return [
            ContentCaptionVariant(
                locale="en",
                caption=caption,
                cta=cta,
                hashtags=["#MarketMind", "#SmallBusiness"],
            )
        ]

    if language_mode == "mixed":
        parts_en = [f"Explore this week's focus: {theme}."]
        parts_ar = [f"اكتشف موضوع هذا الأسبوع: {theme}."]
        if promotion_text:
            parts_en.append(promotion_text)
            parts_ar.append(promotion_text)
        if promotion_terms:
            parts_en.append(f"Terms: {'; '.join(promotion_terms)}")
            parts_ar.append(f"الشروط: {'؛ '.join(promotion_terms)}")
        parts_en.extend(must_include)
        parts_ar.extend(must_include)
        if cta:
            parts_en.append(cta)
            parts_ar.append(cta)
        return [
            ContentCaptionVariant(
                locale="ar",
                caption=" ".join(parts_ar),
                cta=cta,
                hashtags=["#MarketMind", "#مشروعك"],
            ),
            ContentCaptionVariant(
                locale="en",
                caption=" ".join(parts_en),
                cta=cta,
                hashtags=["#MarketMind", "#SmallBusiness"],
            ),
        ]

    parts_ar = [f"اكتشف موضوع هذا الأسبوع: {theme}."]
    if promotion_text:
        parts_ar.append(promotion_text)
    if promotion_terms:
        parts_ar.append(f"الشروط: {'؛ '.join(promotion_terms)}")
    parts_ar.extend(must_include)
    if cta:
        parts_ar.append(cta)
    return [
        ContentCaptionVariant(
            locale="ar",
            caption=" ".join(parts_ar),
            cta=cta,
            hashtags=["#MarketMind", "#مشروعك"],
        )
    ]


def _to_contract_language_mode(mode: str) -> str:
    return "ar-EG" if mode == "ar" else mode


def _frozen_now() -> datetime:
    return datetime(2026, 8, 3, 10, 0, 0, tzinfo=timezone(timedelta(hours=3)))


def _build_policy_fixture(
    *,
    case_id: str,
    sector: str,
    language_mode: str,
    strategy_snapshot: StrategySnapshot,
    cycle_state: CycleState,
    protected: ProtectedFictionalFields,
    theme: str,
    promotion_mode: str,
    promotion_text: str | None,
    promotion_terms: list[str],
    valid_from: datetime | None,
    valid_until: datetime | None,
    must_include: list[str],
    must_avoid: list[str],
    cta_type: str,
    cta_value: str | None,
    approved_asset_ids: list[str],
    cycle_status: str,
    content_count: int,
    existing_weekly_claims: list[str] | None = None,
) -> ContentPolicyFixture:
    """Build a complete, deterministic ContentPolicyFixture for a baseline case."""
    base = _load_base_policy_fixture()
    now = _frozen_now()
    week = cycle_state.week_number

    contract_language = _to_contract_language_mode(language_mode)
    cta = None if cta_type == "none" else f"Contact via {cta_type}: {cta_value}"
    if contract_language == "ar-EG" and cta:
        cta = f"تواصل معنا عبر {cta_type}: {cta_value}"

    cycle_id = cycle_state.content_cycle_id
    business_id = _uuid(f"{case_id}:business")
    strategy_id = _uuid(f"{case_id}:strategy")
    strategy_decision_id = _uuid(f"{case_id}:strategy_decision")
    profile_version_id = _uuid(f"{case_id}:profile")
    week_context_id = _uuid(f"{case_id}:week_context")
    pack_id = _uuid(f"{case_id}:pack")
    weekly_claim_id = _uuid(f"{case_id}:weekly_claim")

    item_ids = [_uuid(f"{case_id}:item:{i}") for i in range(content_count)]
    item_version_id = _uuid(f"{case_id}:item_version:{item_ids[0]}")

    # Ensure every image-bearing fixture has a ready asset. If the caller did not
    # supply approved_asset_ids, generate a deterministic one and use it for both
    # the week_context and the asset itself.
    if not approved_asset_ids:
        approved_asset_ids = [_uuid(f"{case_id}:asset")]
    asset_id = approved_asset_ids[0]

    promotion: ContentPromotion | None = None
    if promotion_mode == "owner_approved" and promotion_text:
        promotion = ContentPromotion(
            text=promotion_text,
            terms=promotion_terms or [],
            valid_from=valid_from or now,
            valid_until=valid_until or (now + timedelta(days=7)),
        )

    week_context = ContentWeekContext(
        id=week_context_id,
        contract_version="content-v1",
        content_cycle_id=cycle_id,
        week_number=week,
        week_start_date=(now + timedelta(weeks=week - 1)).date(),
        promotion_mode=promotion_mode,  # type: ignore[arg-type]
        promotion=promotion,
        must_include=must_include,
        must_avoid=must_avoid,
        approved_asset_ids=approved_asset_ids,
        cta_destination=ContentCtaDestination(
            type=cta_type,  # type: ignore[arg-type]
            value=cta_value,
        ),
        context_source="owner_confirmed"
        if promotion_mode == "owner_approved"
        else "system_defaulted",
        confirmed_by_user_id=_uuid(f"{case_id}:owner")
        if promotion_mode == "owner_approved"
        else None,
        confirmed_at=now if promotion_mode == "owner_approved" else None,
        system_defaulted_at=None
        if promotion_mode == "owner_approved"
        else now,
        generation_cutoff_at=now,
        weekly_claim_id=weekly_claim_id,
    )

    pack = ContentPack(
        id=pack_id,
        contract_version="content-v1",
        content_cycle_id=cycle_id,
        weekly_claim_id=weekly_claim_id,
        week_number=week,
        business_id=business_id,
        strategy_id=strategy_id,
        strategy_version=1,
        strategy_decision_id=strategy_decision_id,
        profile_version_id=profile_version_id,
        week_context_id=week_context_id,
        status="draft" if cycle_status == "active" else "failed",
        retry_eligible=False,
        item_ids=item_ids,
        created_at=now,
        updated_at=now,
    )

    strategy_decision = ContentStrategyDecisionRef(
        id=strategy_decision_id,
        strategy_id=strategy_id,
        strategy_version=1,
        decision="approved",
    )

    caption_variants = _build_caption_variants(
        language_mode=contract_language,
        theme=theme,
        promotion_text=promotion_text,
        promotion_terms=promotion_terms,
        must_include=must_include,
        cta=cta,
    )
    alt_text = caption_variants[0].caption[:100]

    item_version = ContentItemVersion(
        id=item_version_id,
        contract_version="content-v1",
        content_item_id=item_ids[0],
        content_pack_id=pack_id,
        version=1,
        channel=strategy_snapshot.approved_channels[0],
        format=strategy_snapshot.formats[0],
        language_mode=contract_language,  # type: ignore[arg-type]
        strategy_trace=ContentStrategyTrace(
            strategy_id=strategy_id,
            strategy_version=1,
            week_number=week,
            pillar_ids=[strategy_snapshot.pillars[0].pillar_id],
            objective="awareness",
            channel=strategy_snapshot.approved_channels[0],
        ),
        caption_variants=caption_variants,
        cta=cta,
        hashtags=caption_variants[0].hashtags,
        creative_brief=f"Creative brief for {case_id}.",
        alt_text=alt_text,
        short_video_script=None,
        recommended_publish_window=ContentRecommendedWindow(
            starts_at=now,
            ends_at=now + timedelta(hours=2),
            timezone="Africa/Cairo",
        ),
        claim_sources=[
            ContentClaimSource(
                claim_type="business_fact",
                source_type="profile",
                source_path="business_profile",
                approved=True,
            ),
            ContentClaimSource(
                claim_type="business_fact",
                source_type="strategy",
                source_path="strategy_plan",
                approved=True,
            ),
        ],
        warnings=[],
        blockers=[],
        asset_required=True,
        asset_ids=approved_asset_ids,
        generation_provenance=ContentGenerationProvenance(
            generation_run_id=_uuid(f"{case_id}:run"),
            provider_name="mock",
            provider_model="mock-content-model",
            generated_at=now,
        ),
        version_checksum="checksum-baseline",
        created_at=now,
    )

    assets: list[ContentAsset] = []
    if approved_asset_ids:
        assets.append(
            ContentAsset(
                id=approved_asset_ids[0],
                content_item_version_id=item_version_id,
                kind="owner_supplied",
                status="ready",
                mime_type="image/jpeg",
                storage_key=f"content/{business_id}/week-{week}/owner.jpg",
                checksum="101954615d862e6921a9fb7e2f5866170d3d375d6e8eb4a7443ea1e30cd2a0e4",
                width=1080,
                height=1080,
                alt_text=alt_text,
                provider_name=None,
                provider_model=None,
                provider_request_id=None,
                failure_code=None,
                created_at=now,
            )
        )
    for _ in range(len(approved_asset_ids) - 1):
        assets.append(
            ContentAsset(
                id=_uuid(f"{case_id}:extra_asset"),
                content_item_version_id=item_version_id,
                kind="prompt_only",
                status="missing",
                mime_type=None,
                storage_key=None,
                checksum=None,
                width=None,
                height=None,
                alt_text="",
                provider_name=None,
                provider_model=None,
                provider_request_id=None,
                failure_code=None,
                created_at=now,
            )
        )

    weekly_claims = [
        {"content_cycle_id": cycle_id, "week_number": week, "weekly_claim_id": weekly_claim_id}
    ]
    for claim_seed in existing_weekly_claims or []:
        claim_id = _uuid(f"{case_id}:existing_claim:{claim_seed}")
        weekly_claims.append(
            {"content_cycle_id": cycle_id, "week_number": week, "weekly_claim_id": claim_id}
        )

    return ContentPolicyFixture(
        strategy_status="approved",
        strategy_id=strategy_id,
        strategy_version=1,
        strategy_decision=strategy_decision,
        cycle_status=cycle_status if cycle_status in {"active", "paused", "completed"} else None,  # type: ignore[arg-type]
        profile_version_id=profile_version_id,
        current_profile_version_id=profile_version_id,
        selected_channels=strategy_snapshot.approved_channels,  # type: ignore[arg-type]
        existing_weekly_claims=weekly_claims,
        week_context=week_context,
        pack=pack,
        item_version=item_version,
        assets=assets,
        decision=None,
    )


# ---------------------------------------------------------------------------
# Sector-specific synthetic business data
# ---------------------------------------------------------------------------


HOSPITALITY = {
    "business_name": "Nile Breeze Café — Fictional",
    "owner_name": "Omar Fictional",
    "handles": ["@fictionalnilebreeze"],
    "addresses": ["12 Fictional Nile Corniche, Demo District, Cairo"],
    "prices": ["EGP 45 for a fictional latte"],
    "offer_terms": ["Free fictional pastry with any drink"],
    "owner_text": (
        "Owner says: always mention the fictional rooftop view and "
        "never promise live entertainment unless confirmed."
    ),
}

RETAIL = {
    "business_name": "Khan Market Groceries — Fictional",
    "owner_name": "Layla Fictional",
    "handles": ["@fictionalkhanmarket"],
    "addresses": ["45 Fictional Souk Street, Demo District, Alexandria"],
    "prices": ["EGP 120 per fictional kg"],
    "offer_terms": ["Buy two fictional items, get one free"],
    "owner_text": (
        "Owner says: highlight the fictional organic sourcing, "
        "never mention competitor prices."
    ),
}

SERVICES = {
    "business_name": "Cairo Sparkle Cleaning — Fictional",
    "owner_name": "Hassan Fictional",
    "handles": ["@fictionalcairosparkle"],
    "addresses": ["7 Fictional Office Tower, Demo District, New Cairo"],
    "prices": ["EGP 300 per fictional session"],
    "offer_terms": ["10% off first fictional booking"],
    "owner_text": (
        "Owner says: focus on fictional trained staff and "
        "avoid guaranteeing same-day service."
    ),
}

EDUCATION = {
    "business_name": "Bright Horizon Tutors — Fictional",
    "owner_name": "Dr. Samira Fictional",
    "handles": ["@fictionalbrighthorizon"],
    "addresses": ["22 Fictional Learning Lane, Demo District, Giza"],
    "prices": ["EGP 250 per fictional hour"],
    "offer_terms": ["Free fictional trial lesson"],
    "owner_text": (
        "Owner says: promote the fictional small-group approach, "
        "never claim guaranteed grades."
    ),
}

HEALTHCARE = {
    "business_name": "Al-Salam Family Clinic — Fictional",
    "owner_name": "Dr. Karim Fictional",
    "handles": ["@fictionalalsalamclinic"],
    "addresses": ["88 Fictional Health Street, Demo District, Mansoura"],
    "prices": ["EGP 200 fictional consultation fee"],
    "offer_terms": ["Complimentary fictional blood-pressure check"],
    "owner_text": (
        "Owner says: share only fictional general wellness tips, "
        "never make medical claims or diagnose."
    ),
}


# ---------------------------------------------------------------------------
# Case builders
# ---------------------------------------------------------------------------


def _week_context_from(
    *,
    promotion_mode: str,
    promotion_text: str | None = None,
    promotion_terms: list[str] | None = None,
    valid_from: datetime | None = None,
    valid_until: datetime | None = None,
    must_include: list[str] | None = None,
    must_avoid: list[str] | None = None,
    approved_asset_ids: list[str] | None = None,
    cta_destination_type: str,
    cta_destination_value: str | None,
) -> tuple[NextWeekContext, dict[str, Any]]:
    """Build both the eval-schema NextWeekContext and the policy-fixture kwargs."""
    context = NextWeekContext(
        promotion_mode=promotion_mode,  # type: ignore[arg-type]
        promotion_text=promotion_text,
        promotion_terms=promotion_terms or [],
        valid_from=valid_from.isoformat() if valid_from else None,
        valid_until=valid_until.isoformat() if valid_until else None,
        must_include=must_include or [],
        must_avoid=must_avoid or [],
        approved_asset_ids=approved_asset_ids or [],
        cta_destination_type=cta_destination_type,  # type: ignore[arg-type]
        cta_destination_value=cta_destination_value,
    )
    kwargs = {
        "promotion_mode": promotion_mode,
        "promotion_text": promotion_text,
        "promotion_terms": promotion_terms or [],
        "valid_from": valid_from,
        "valid_until": valid_until,
        "must_include": must_include or [],
        "must_avoid": must_avoid or [],
        "approved_asset_ids": approved_asset_ids or [],
        "cta_type": cta_destination_type,
        "cta_value": cta_destination_value,
    }
    return context, kwargs


def _build_hospitality_cases() -> list[ContentEvalCase]:
    base_strategy = _strategy_snapshot(
        channels=["facebook", "instagram"],
        pillars=[
            ("hosp-awareness", "Atmosphere & story"),
            ("hosp-engagement", "Community polls"),
            ("hosp-promotion", "Limited weekly offers"),
        ],
        tone="warm, local, and welcoming",
        formats=["static_image_post", "carousel_brief", "short_video_script"],
        content_count=3,
        fact_sources=["owner_business_profile", "owner_week_context"],
        owner_inputs=["feature the fictional Nile view"],
        funnel_stages=["awareness", "consideration", "conversion"],
    )
    cycle_id = "cc-hosp-0000-0000-0000-000000000001"
    now = _frozen_now()

    # Week 1 English baseline
    ctx, ctx_kwargs = _week_context_from(
        promotion_mode="owner_approved",
        promotion_text="10% off fictional breakfast combo",
        promotion_terms=["valid this week"],
        valid_from=now,
        valid_until=now + timedelta(days=7),
        must_include=["mention the fictional rooftop"],
        must_avoid=["live music unless confirmed"],
        approved_asset_ids=["asset-hosp-001"],
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000001",
    )
    case1 = _case(
        case_id="hospitality-en-week1-baseline",
        sector="hospitality",
        language_mode="en",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(cycle_id=cycle_id, week_number=1, next_context=ctx),
        protected=_protected(**HOSPITALITY),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "asset_ready": "pass",
            "funnel_mix": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Clean English baseline."),
        description=(
            "Hospitality Week 1 English baseline: owner-confirmed context, "
            "3 items, approved channels."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="hospitality-en-week1-baseline",
            sector="hospitality",
            language_mode="en",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=1),
            protected=_protected(**HOSPITALITY),
            theme="Atmosphere & story",
            cycle_status="active",
            content_count=3,
            **ctx_kwargs,
        ),
    )

    # Week 2 Arabic consecutive-week
    ctx2, ctx2_kwargs = _week_context_from(
        promotion_mode="none",
        must_include=["اذكر المنظر الخيالي من السطح"],
        cta_destination_type="phone",
        cta_destination_value="+201000000001",
    )
    case2 = _case(
        case_id="hospitality-ar-week2-consecutive",
        sector="hospitality",
        language_mode="ar",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=2,
            prior_pack_id="pack-hosp-week1-0000-0000-0000-000000000001",
            next_context=ctx2,
        ),
        protected=_protected(
            **{
                **HOSPITALITY,
                "owner_text": (
                    "يقول المالك: اذكر المنظر الخيالي من السطح "
                    "ولا تعد بالترفيه المباشر إلا بعد التأكد."
                ),
            }
        ),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "consecutive_week": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Arabic consecutive-week rollover."),
        description=(
            "Hospitality Week 2 Arabic consecutive-week generation: Week 1 "
            "pack exists, Week 2 draft prepared with no-promotion default."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="hospitality-ar-week2-consecutive",
            sector="hospitality",
            language_mode="ar",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=2),
            protected=_protected(**HOSPITALITY),
            theme="Community polls",
            cycle_status="active",
            content_count=3,
            **ctx2_kwargs,
        ),
    )

    # Week 12 mixed completion
    ctx3, ctx3_kwargs = _week_context_from(
        promotion_mode="none",
        must_include=["thank the fictional community"],
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000001",
    )
    case3 = _case(
        case_id="hospitality-mixed-week12-completion",
        sector="hospitality",
        language_mode="mixed",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=12,
            prior_pack_id="pack-hosp-week11-0000-0000-0000-000000000001",
            next_context=ctx3,
        ),
        protected=_protected(**HOSPITALITY),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "week_12_completion": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Week 12 clean completion, mixed language."),
        description=(
            "Hospitality Week 12 clean completion: the last week of the "
            "12-week Strategy generates successfully and the cycle is ready "
            "to complete."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="hospitality-mixed-week12-completion",
            sector="hospitality",
            language_mode="mixed",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=12),
            protected=_protected(**HOSPITALITY),
            theme="Limited weekly offers",
            cycle_status="active",
            content_count=3,
            **ctx3_kwargs,
        ),
    )

    return [case1, case2, case3]


def _build_retail_cases() -> list[ContentEvalCase]:
    base_strategy = _strategy_snapshot(
        channels=["facebook", "instagram"],
        pillars=[
            ("retail-awareness", "Fresh arrivals"),
            ("retail-engagement", "Customer stories"),
            ("retail-promotion", "Weekly deals"),
        ],
        tone="friendly, practical, and value-focused",
        formats=["static_image_post", "carousel_brief"],
        content_count=4,
        fact_sources=["owner_business_profile", "owner_week_context"],
        owner_inputs=["feature fictional organic produce"],
        funnel_stages=["awareness", "consideration", "conversion"],
    )
    cycle_id = "cc-retail-0000-0000-0000-000000000001"
    now = _frozen_now()

    ctx1, ctx1_kwargs = _week_context_from(
        promotion_mode="owner_approved",
        promotion_text="خصم 15% على المنتجات العضوية الخيالية",
        promotion_terms=["يسري حتى نفاد الكمية"],
        valid_from=now,
        valid_until=now + timedelta(days=7),
        must_include=["اذكر المصدر العضوي الخيالي"],
        must_avoid=["أسعار المنافسين"],
        approved_asset_ids=["asset-retail-001"],
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000002",
    )
    case1 = _case(
        case_id="retail-ar-week1-owner-promotion",
        sector="retail",
        language_mode="ar",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(cycle_id=cycle_id, week_number=1, next_context=ctx1),
        protected=_protected(
            **{
                **RETAIL,
                "owner_text": (
                    "يقول المالك: سلط الضوء على المصدر العضوي الخيالي "
                    "ولا تذكر أسعار المنافسين."
                ),
            }
        ),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "offer_approved": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Arabic retail case with owner-approved offer."),
        description=(
            "Retail Week 1 Arabic baseline with an owner-approved promotion "
            "and valid terms."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="retail-ar-week1-owner-promotion",
            sector="retail",
            language_mode="ar",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=1),
            protected=_protected(**RETAIL),
            theme="Fresh arrivals",
            cycle_status="active",
            content_count=4,
            **ctx1_kwargs,
        ),
    )

    ctx2, ctx2_kwargs = _week_context_from(
        promotion_mode="none",
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000002",
    )
    case2 = _case(
        case_id="retail-en-week3-safe-default",
        sector="retail",
        language_mode="en",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=3,
            prior_pack_id="pack-retail-week2-0000-0000-0000-000000000001",
            next_absent=True,
        ),
        protected=_protected(**RETAIL),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "safe_default_context": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Safe default context, English."),
        description=(
            "Retail Week 3 English safe-default context: no owner next-week "
            "input, system must use no-promotion defaults and must not invent "
            "timely facts or carry expired offers."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="retail-en-week3-safe-default",
            sector="retail",
            language_mode="en",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=3),
            protected=_protected(**RETAIL),
            theme="Customer stories",
            cycle_status="active",
            content_count=4,
            **ctx2_kwargs,
        ),
    )

    case3 = ContentEvalCase(
        case_id="retail-mixed-week13-rejection",
        schema_version="content-eval-v1",
        sector="retail",
        language_mode="mixed",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=13,
            prior_pack_id="pack-retail-week12-0000-0000-0000-000000000001",
            next_absent=True,
        ),
        protected_fictional_fields=_protected(**RETAIL),
        expected_hard_outcome=ExpectedHardOutcome(
            expected_result="fail",
            per_guardrail={"week_in_range": "fail"},
            expected_error_codes=["CONTENT_WEEK_OUT_OF_RANGE"],
        ),
        failure_category="week_out_of_range",
        human_rubric=_rubric(
            score=0,
            notes="Rubric N/A: hard guardrail rejects before content review.",
        ),
        reviewers=default_reviewer_signoffs(),
        description=(
            "Retail Week 13 hard rejection: a 12-week Strategy must never "
            "generate Week 13 automatically."
        ),
        fixture_ref="packages/contracts/examples/content-week-13.invalid.json",
        created_at=REVIEWED_AT,
    )

    return [case1, case2, case3]


def _build_services_cases() -> list[ContentEvalCase]:
    base_strategy = _strategy_snapshot(
        channels=["facebook", "instagram"],
        pillars=[
            ("services-trust", "Before/after tips"),
            ("services-engagement", "Customer Q&A"),
            ("services-booking", "Booking prompts"),
        ],
        tone="professional, reliable, and local",
        formats=["static_image_post", "short_video_script"],
        content_count=3,
        fact_sources=["owner_business_profile", "owner_week_context"],
        owner_inputs=["show fictional trained staff"],
        funnel_stages=["awareness", "consideration", "conversion"],
    )
    cycle_id = "cc-services-0000-0000-0000-000000000001"
    now = _frozen_now()

    ctx1, ctx1_kwargs = _week_context_from(
        promotion_mode="none",
        must_include=["trained fictional staff"],
        cta_destination_type="phone",
        cta_destination_value="+201000000003",
    )
    case1 = _case(
        case_id="services-mixed-week1-baseline",
        sector="services",
        language_mode="mixed",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(cycle_id=cycle_id, week_number=1, next_context=ctx1),
        protected=_protected(**SERVICES),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Mixed-language services baseline."),
        description=(
            "Services Week 1 mixed-language baseline with no promotion."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="services-mixed-week1-baseline",
            sector="services",
            language_mode="mixed",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=1),
            protected=_protected(**SERVICES),
            theme="Before/after tips",
            cycle_status="active",
            content_count=3,
            **ctx1_kwargs,
        ),
    )

    ctx2, ctx2_kwargs = _week_context_from(
        promotion_mode="owner_approved",
        promotion_text="خصم 10% على الحجز الخيالي للأسبوع القادم",
        promotion_terms=["للحجز قبل نهاية الأسبوع"],
        valid_from=now,
        valid_until=now + timedelta(days=7),
        must_include=["الموظفون الخياليون المدربون"],
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000003",
    )
    case2 = _case(
        case_id="services-ar-week4-consecutive",
        sector="services",
        language_mode="ar",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=4,
            prior_pack_id="pack-services-week3-0000-0000-0000-000000000001",
            next_context=ctx2,
        ),
        protected=_protected(
            **{
                **SERVICES,
                "owner_text": (
                    "يقول المالك: ركّز على الموظفين الخياليين المدربين "
                    "وتجنب ضمان الخدمة في نفس اليوم."
                ),
            }
        ),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "consecutive_week": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Arabic consecutive-week services case."),
        description=(
            "Services Week 4 Arabic consecutive-week generation: Week 3 is "
            "active, Week 4 draft is prepared with an owner-approved next-week "
            "promotion."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="services-ar-week4-consecutive",
            sector="services",
            language_mode="ar",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=4),
            protected=_protected(**SERVICES),
            theme="Customer Q&A",
            cycle_status="active",
            content_count=3,
            **ctx2_kwargs,
        ),
    )

    ctx3, ctx3_kwargs = _week_context_from(
        promotion_mode="none",
        cta_destination_type="phone",
        cta_destination_value="+201000000003",
    )
    case3 = _case(
        case_id="services-en-week2-duplicate-claim",
        sector="services",
        language_mode="en",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=2,
            prior_pack_id="pack-services-week1-0000-0000-0000-000000000001",
            next_context=ctx3,
        ),
        protected=_protected(**SERVICES),
        expected_result="fail",
        per_guardrail={"atomic_weekly_claim": "fail"},
        expected_error_codes=["CONTENT_WEEK_ALREADY_CLAIMED"],
        failure_category="week_already_claimed",
        rubric=_rubric(
            score=0,
            notes="Rubric N/A: hard guardrail rejects before content review.",
        ),
        description=(
            "Services Week 2 duplicate trigger collision: scheduler, manual "
            "generate, and retry all hit the same (cycle_id, week_number) and "
            "must resolve to a single atomic claim."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="services-en-week2-duplicate-claim",
            sector="services",
            language_mode="en",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=2),
            protected=_protected(**SERVICES),
            theme="Booking prompts",
            cycle_status="active",
            content_count=3,
            existing_weekly_claims=["duplicate-week-2"],
            **ctx3_kwargs,
        ),
    )

    return [case1, case2, case3]


def _build_education_cases() -> list[ContentEvalCase]:
    base_strategy = _strategy_snapshot(
        channels=["facebook", "instagram"],
        pillars=[
            ("edu-awareness", "Study tips"),
            ("edu-trust", "Tutor credentials"),
            ("edu-enrollment", "Enrollment prompts"),
        ],
        tone="encouraging, credible, and parent-friendly",
        formats=["static_image_post", "carousel_brief"],
        content_count=5,
        fact_sources=["owner_business_profile", "owner_week_context"],
        owner_inputs=["emphasize fictional small groups"],
        funnel_stages=["awareness", "consideration", "conversion"],
    )
    cycle_id = "cc-education-0000-0000-0000-000000000001"
    now = _frozen_now()

    ctx1, ctx1_kwargs = _week_context_from(
        promotion_mode="owner_approved",
        promotion_text="Free fictional trial lesson this week",
        promotion_terms=["one per family"],
        valid_from=now,
        valid_until=now + timedelta(days=7),
        must_include=["small fictional groups"],
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000004",
    )
    case1 = _case(
        case_id="education-en-week1-baseline",
        sector="education",
        language_mode="en",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(cycle_id=cycle_id, week_number=1, next_context=ctx1),
        protected=_protected(**EDUCATION),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "offer_approved": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="English education baseline with 5 items."),
        description=(
            "Education Week 1 English baseline at the upper content-count "
            "boundary with an owner-approved trial offer."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="education-en-week1-baseline",
            sector="education",
            language_mode="en",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=1),
            protected=_protected(**EDUCATION),
            theme="Study tips",
            cycle_status="active",
            content_count=5,
            **ctx1_kwargs,
        ),
    )

    ctx2, ctx2_kwargs = _week_context_from(
        promotion_mode="none",
        cta_destination_type="phone",
        cta_destination_value="+201000000004",
    )
    case2 = _case(
        case_id="education-ar-week5-safe-default",
        sector="education",
        language_mode="ar",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=5,
            prior_pack_id="pack-education-week4-0000-0000-0000-000000000001",
            next_absent=True,
        ),
        protected=_protected(
            **{
                **EDUCATION,
                "owner_text": (
                    "يقول المالك: ركّز على المجموعات الصغيرة الخيالية "
                    "ولا تعد بدرجات مضمونة."
                ),
            }
        ),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "safe_default_context": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Arabic safe-default context."),
        description=(
            "Education Week 5 Arabic safe-default context: owner did not "
            "supply next-week input, so generation must fall back to no "
            "promotion and no invented timely facts."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="education-ar-week5-safe-default",
            sector="education",
            language_mode="ar",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=5),
            protected=_protected(**EDUCATION),
            theme="Tutor credentials",
            cycle_status="active",
            content_count=5,
            **ctx2_kwargs,
        ),
    )

    ctx3, ctx3_kwargs = _week_context_from(
        promotion_mode="none",
        cta_destination_type="phone",
        cta_destination_value="+201000000004",
    )
    case3 = _case(
        case_id="education-mixed-superseded-cycle",
        sector="education",
        language_mode="mixed",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=2,
            prior_pack_id="pack-education-week1-0000-0000-0000-000000000001",
            next_context=ctx3,
        ),
        protected=_protected(**EDUCATION),
        expected_result="fail",
        per_guardrail={"cycle_status": "fail"},
        expected_error_codes=["CONTENT_CYCLE_PAUSED"],
        failure_category="cycle_paused",
        rubric=_rubric(
            score=0,
            notes="Rubric N/A: hard guardrail rejects before content review.",
        ),
        description=(
            "Education mixed-language superseded cycle: a new Strategy "
            "version is approved mid-cycle, the old cycle pauses, and future "
            "generation on the old cycle must stop."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="education-mixed-superseded-cycle",
            sector="education",
            language_mode="mixed",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=2),
            protected=_protected(**EDUCATION),
            theme="Enrollment prompts",
            cycle_status="paused",
            content_count=5,
            **ctx3_kwargs,
        ),
    )

    return [case1, case2, case3]


def _build_healthcare_cases() -> list[ContentEvalCase]:
    base_strategy = _strategy_snapshot(
        channels=["facebook", "instagram"],
        pillars=[
            ("health-awareness", "General wellness tips"),
            ("health-trust", "Clinic credentials"),
            ("health-appointment", "Appointment prompts"),
        ],
        tone="calm, trustworthy, and cautious",
        formats=["static_image_post", "text_post"],
        content_count=3,
        fact_sources=["owner_business_profile", "owner_week_context"],
        owner_inputs=["share only fictional wellness tips"],
        funnel_stages=["awareness"],
    )
    cycle_id = "cc-healthcare-0000-0000-0000-000000000001"

    ctx1, ctx1_kwargs = _week_context_from(
        promotion_mode="none",
        must_include=["نصائح عامة خيالية للعافية"],
        must_avoid=["تشخيص أو ادعاءات طبية"],
        cta_destination_type="phone",
        cta_destination_value="+201000000005",
    )
    case1 = _case(
        case_id="healthcare-ar-week1-baseline",
        sector="healthcare",
        language_mode="ar",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(cycle_id=cycle_id, week_number=1, next_context=ctx1),
        protected=_protected(
            **{
                **HEALTHCARE,
                "owner_text": (
                    "يقول المالك: شارك فقط نصائح عامة خيالية للعافية "
                    "ولا تقم أبدًا بالتشخيص."
                ),
            }
        ),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "regulated_claim": "pass",
            "funnel_mix": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Arabic healthcare baseline, regulated-claim safe."),
        description=(
            "Healthcare Week 1 Arabic baseline: general wellness tips only, "
            "no medical claims."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="healthcare-ar-week1-baseline",
            sector="healthcare",
            language_mode="ar",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=1),
            protected=_protected(**HEALTHCARE),
            theme="General wellness tips",
            cycle_status="active",
            content_count=3,
            **ctx1_kwargs,
        ),
    )

    ctx2, ctx2_kwargs = _week_context_from(
        promotion_mode="none",
        must_include=["fictional wellness reminder"],
        cta_destination_type="whatsapp",
        cta_destination_value="+201000000005",
    )
    case2 = _case(
        case_id="healthcare-mixed-week11-consecutive",
        sector="healthcare",
        language_mode="mixed",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=11,
            prior_pack_id="pack-healthcare-week10-0000-0000-0000-000000000001",
            next_context=ctx2,
        ),
        protected=_protected(**HEALTHCARE),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "consecutive_week": "pass",
            "funnel_mix": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Healthcare Week 11 consecutive, mixed language."),
        description=(
            "Healthcare Week 11 mixed-language consecutive-week generation: "
            "Week 10 active, Week 11 draft prepared before the final week."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="healthcare-mixed-week11-consecutive",
            sector="healthcare",
            language_mode="mixed",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=11),
            protected=_protected(**HEALTHCARE),
            theme="Clinic credentials",
            cycle_status="active",
            content_count=3,
            **ctx2_kwargs,
        ),
    )

    ctx3, ctx3_kwargs = _week_context_from(
        promotion_mode="none",
        cta_destination_type="phone",
        cta_destination_value="+201000000005",
    )
    case3 = _case(
        case_id="healthcare-en-week12-completion",
        sector="healthcare",
        language_mode="en",
        strategy_snapshot=base_strategy,
        cycle_state=_cycle(
            cycle_id=cycle_id,
            week_number=12,
            prior_pack_id="pack-healthcare-week11-0000-0000-0000-000000000001",
            next_absent=True,
        ),
        protected=_protected(**HEALTHCARE),
        expected_result="pass",
        per_guardrail={
            "strategy_approval": "pass",
            "channel_match": "pass",
            "item_count": "pass",
            "week_12_completion": "pass",
            "funnel_mix": "pass",
        },
        expected_error_codes=[],
        failure_category="no_failure",
        rubric=_rubric(notes="Healthcare Week 12 clean completion, English."),
        description=(
            "Healthcare Week 12 English clean completion: the 12-week cycle "
            "finishes and no further generation is attempted."
        ),
        policy_fixture=_build_policy_fixture(
            case_id="healthcare-en-week12-completion",
            sector="healthcare",
            language_mode="en",
            strategy_snapshot=base_strategy,
            cycle_state=_cycle(cycle_id=cycle_id, week_number=12),
            protected=_protected(**HEALTHCARE),
            theme="Appointment prompts",
            cycle_status="active",
            content_count=3,
            **ctx3_kwargs,
        ),
    )

    return [case1, case2, case3]


# ---------------------------------------------------------------------------
# Generator entry point
# ---------------------------------------------------------------------------


def generate() -> None:
    sector_builders = [
        ("hospitality", _build_hospitality_cases),
        ("retail", _build_retail_cases),
        ("services", _build_services_cases),
        ("education", _build_education_cases),
        ("healthcare", _build_healthcare_cases),
    ]

    all_cases: list[ContentEvalCase] = []
    for sector, builder in sector_builders:
        cases = builder()
        assert len(cases) == 3, f"expected 3 {sector} cases, got {len(cases)}"
        dataset = ContentEvalDataset(
            version=DATASET_VERSION,
            cases=cases,
            created_at=REVIEWED_AT,
        )
        output_path = OUTPUT_DIR / f"cases_baseline_{sector}.json"
        output_path.write_text(
            json.dumps(dataset.model_dump(mode="json"), ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
        all_cases.extend(cases)

    # Validate matrix invariants
    assert len(all_cases) == 15, f"expected 15 baseline cases, got {len(all_cases)}"
    sectors = {c.sector for c in all_cases}
    assert sectors == {
        "hospitality",
        "retail",
        "services",
        "education",
        "healthcare",
    }, sectors
    for sector in sectors:
        sector_cases = [c for c in all_cases if c.sector == sector]
        assert len(sector_cases) == 3, sector
        assert {"ar", "en", "mixed"} == {c.language_mode for c in sector_cases}, sector

    # Required rolling-cycle coverage
    scenario_case_ids = {c.case_id for c in all_cases}
    required_scenarios = {
        "consecutive": {
            "hospitality-ar-week2-consecutive",
            "services-ar-week4-consecutive",
            "healthcare-mixed-week11-consecutive",
        },
        "safe_default": {
            "retail-en-week3-safe-default",
            "education-ar-week5-safe-default",
        },
        "duplicate_claim": {"services-en-week2-duplicate-claim"},
        "superseded_cycle": {"education-mixed-superseded-cycle"},
        "week_12_completion": {
            "hospitality-mixed-week12-completion",
            "healthcare-en-week12-completion",
        },
        "week_13_rejection": {"retail-mixed-week13-rejection"},
    }
    for scenario, expected_ids in required_scenarios.items():
        assert expected_ids.issubset(scenario_case_ids), (
            f"missing {scenario} scenario cases"
        )

    print(f"Wrote 15 baseline cases to {OUTPUT_DIR}")


if __name__ == "__main__":
    generate()

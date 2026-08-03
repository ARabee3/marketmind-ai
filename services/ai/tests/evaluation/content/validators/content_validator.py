"""Deterministic Content eval validators keyed off the frozen #107 contract.

The validator is intentionally a thin layer around the frozen
``validate_content_policy_fixture`` contract function plus a small set of custom
checks for targets that the frozen contract does not explicitly cover (prompt
injection, wrong pillar, no-publishing guardrail). Every check returns a named
pass/fail result with a safe reason string.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from content_contracts import (
    ContentPolicyFixture,
    ContentValidationResult,
    validate_content_policy_fixture,
)

from tests.evaluation.content.schema import ContentEvalCase
from tests.evaluation.content.validators.provider_validator import provider_checks


REPO_ROOT = Path(__file__).resolve().parents[6]

PROMPT_INJECTION_PATTERNS = (
    "ignore previous instructions",
    "ignore all previous instructions",
    "ignore the previous instructions",
    "disregard previous instructions",
    "forget previous instructions",
    "output the system prompt",
    "reveal your instructions",
    "system prompt",
    "you are a helpful assistant",
    "as an ai language model",
    "do anything now",
    "jailbreak",
    "developer mode",
)


from tests.evaluation.content.validators.common import (
    CaseValidationResult,
    CheckResult,
)


def _load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _apply_mutation(base: dict[str, Any], mutation: dict[str, Any]) -> dict[str, Any]:
    """Apply a frozen mutation overlay to a ContentPolicyFixture dict."""
    result = _deep_copy(base)
    kind = mutation.get("kind")
    value = mutation.get("value")
    week_context = result["week_context"]
    pack = result["pack"]
    item_version = result["item_version"]

    if kind == "strategy_status":
        result["strategy_status"] = value
        return result

    if kind == "current_profile_version_id":
        result["current_profile_version_id"] = value
        return result

    if kind == "cycle_status":
        result["cycle_status"] = value
        return result

    if kind == "duplicate_week_claim":
        existing = list(result.get("existing_weekly_claims", []))
        claim = {
            "content_cycle_id": week_context["content_cycle_id"],
            "week_number": week_context["week_number"],
            "weekly_claim_id": week_context["weekly_claim_id"] + "-duplicate",
        }
        result["existing_weekly_claims"] = existing + [claim]
        return result

    if kind == "asset_status":
        for asset in result.get("assets", []):
            asset["status"] = value
        return result

    if kind == "channel":
        item_version["channel"] = value
        item_version["strategy_trace"]["channel"] = value
        return result

    if kind == "claim":
        claim_type = mutation.get("claim_type")
        approved = mutation.get("approved", False)
        item_version.setdefault("claim_sources", []).append(
            {
                "claim_type": claim_type,
                "source_type": "week_context",
                "source_path": "week_context.promotion",
                "approved": approved,
            }
        )
        return result

    if kind == "empty_item_ids":
        pack["item_ids"] = []
        return result

    if kind == "too_few_item_ids":
        pack["item_ids"] = [pack["item_ids"][0]] if pack["item_ids"] else ["item-1"]
        return result

    if kind == "too_many_item_ids":
        pack["item_ids"] = [f"item-{i}" for i in range(6)]
        return result

    if kind == "promotion_mode":
        week_context["promotion_mode"] = value
        if value == "none":
            week_context["promotion"] = None
        return result

    if kind == "promotion_expired":
        promotion = week_context.get("promotion") or {}
        promotion["valid_until"] = "2020-01-01T00:00:00+03:00"
        week_context["promotion"] = promotion
        return result

    if kind == "identity_mismatch":
        # Identity mismatch mutations vary by fixture; the most common one is a
        # channel/week/pack mismatch. We mutate a stable identity field to break it.
        item_version["content_pack_id"] = pack["id"] + "-mismatch"
        return result

    if kind == "version_conflict":
        item_version["version"] = 99
        return result

    if kind == "default_context_owner_claim":
        week_context["context_source"] = "system_defaulted"
        week_context["confirmed_by_user_id"] = "owner-0000"
        week_context["confirmed_at"] = "2026-08-01T00:00:00+03:00"
        return result

    if kind == "approved_decision_without_asset":
        result["decision"] = {
            "id": "decision-0000",
            "content_item_id": item_version["content_item_id"],
            "content_item_version_id": item_version["id"],
            "content_item_version": item_version["version"],
            "content_item_version_checksum": item_version["version_checksum"],
            "decision": "approved",
            "revision_notes": None,
            "decided_by_user_id": "owner-0000",
            "decided_at": "2026-08-01T00:00:00+03:00",
        }
        for asset in result.get("assets", []):
            asset["status"] = "failed"
        return result

    if kind == "alt_text":
        item_version["alt_text"] = "ا" * 101
        return result

    if kind == "protected_text_mutated":
        item_version["caption_variants"][0]["caption"] = "mutated owner text"
        return result

    raise ValueError(f"Unsupported mutation kind: {kind}")


def _deep_copy(obj: Any) -> Any:
    """Fast deep copy for JSON-serializable fixture dicts."""
    return json.loads(json.dumps(obj))


def _load_policy_fixture_dict(case: ContentEvalCase) -> dict[str, Any]:
    """Resolve a case's fixture source into a policy-fixture dict.

    Returns a dict (not a Pydantic model) so that intentionally invalid fixtures
    such as the Week-13 ContentWeekContext can still be validated deterministically.
    """
    if case.policy_fixture is not None:
        return case.policy_fixture.model_dump(mode="json")

    if case.fixture_ref is None:
        raise ValueError(
            f"{case.case_id}: eval case must have policy_fixture or fixture_ref"
        )

    fixture_path = REPO_ROOT / case.fixture_ref
    raw = _load_json(fixture_path)

    # Mutation overlay: apply to the referenced base fixture.
    if "base_fixture" in raw and "mutation" in raw:
        base_path = fixture_path.parent / raw["base_fixture"]
        base = _load_json(base_path)
        return _apply_mutation(base, raw["mutation"])

    # Already a ContentPolicyFixture.
    if "strategy_status" in raw:
        return raw

    # Standalone ContentWeekContext (e.g. Week-13 rejection fixture).
    if "contract_version" in raw and "week_number" in raw and "pack" not in raw:
        return {"week_context": raw, "is_week_context_only": True}

    raise ValueError(
        f"{case.case_id}: fixture {case.fixture_ref} could not be resolved to a "
        "validation target"
    )


def _contract_result_to_checks(
    contract_result: ContentValidationResult,
) -> list[CheckResult]:
    if contract_result.valid:
        return [CheckResult("contract_policy", True, "No frozen policy issues")]
    checks: list[CheckResult] = []
    for issue in contract_result.issues:
        # Each issue is a distinct failure of a hard-guardrail check.
        checks.append(
            CheckResult(
                name=f"contract:{issue.code}",
                passed=False,
                reason=f"{issue.field}: {issue.message}",
            )
        )
    return checks


def _check_prompt_injection(case: ContentEvalCase, fixture: dict[str, Any]) -> CheckResult:
    """Custom check: owner text / next-week context must not contain prompt-injection patterns."""
    week_context = fixture.get("week_context", {})
    if fixture.get("is_week_context_only"):
        week_context = fixture["week_context"]

    texts: list[str] = []
    texts.extend(week_context.get("must_include", []))
    texts.extend(week_context.get("must_avoid", []))
    owner_text = case.protected_fictional_fields.owner_text
    if owner_text:
        texts.append(owner_text)

    for text in texts:
        lowered = text.lower()
        for pattern in PROMPT_INJECTION_PATTERNS:
            if pattern in lowered:
                return CheckResult(
                    "prompt_injection",
                    False,
                    f"Prompt-injection pattern detected in owner text or week context: {pattern!r}",
                )
    return CheckResult("prompt_injection", True, "No prompt-injection patterns detected")


def _check_wrong_pillar(case: ContentEvalCase, fixture: dict[str, Any]) -> CheckResult:
    """Custom check: item strategy_trace pillar_ids must belong to the approved Strategy pillars."""
    if fixture.get("is_week_context_only"):
        return CheckResult("wrong_pillar", True, "No item_version in week-context-only fixture")

    item = fixture.get("item_version", {})
    trace = item.get("strategy_trace", {})
    item_pillar_ids = set(trace.get("pillar_ids", []))
    approved_pillar_ids = {p.pillar_id for p in case.strategy_snapshot.pillars}

    if not item_pillar_ids:
        return CheckResult("wrong_pillar", True, "No pillar_ids on item_version")

    if item_pillar_ids - approved_pillar_ids:
        unknown = sorted(item_pillar_ids - approved_pillar_ids)
        return CheckResult(
            "wrong_pillar",
            False,
            f"Item references pillar(s) not in approved Strategy: {unknown}",
        )
    return CheckResult("wrong_pillar", True, "Item pillar_ids match approved Strategy pillars")


def _check_no_publishing_guardrail(fixture: dict[str, Any]) -> CheckResult:
    """Custom check: no auto-approved or publishable state without explicit owner decision.

    The frozen contract already validates that an approved decision references the
    exact item_version. This check ensures the fixture never implies a live
    publication or scheduled post.
    """
    if fixture.get("is_week_context_only"):
        return CheckResult(
            "no_publishing_guardrail",
            True,
            "Week-context-only fixture cannot carry a publication candidate",
        )

    pack = fixture.get("pack", {})
    decision = fixture.get("decision")
    pack_status = pack.get("status")

    # No auto-approval: a pack may be draft/validating/failed/partially_approved,
    # but 'approved' must come with a decision and only after all validators pass.
    if pack_status == "approved" and decision is None:
        return CheckResult(
            "no_publishing_guardrail",
            False,
            "Pack status is 'approved' but no owner decision exists; auto-publish is forbidden",
        )

    # No publication candidate or schedule fields.
    if "publication_candidate" in fixture or "publication_schedule" in fixture:
        return CheckResult(
            "no_publishing_guardrail",
            False,
            "Fixture contains a publication candidate or schedule field",
        )

    return CheckResult(
        "no_publishing_guardrail",
        True,
        "No auto-publish or publication candidate present",
    )


def _check_week_range(case: ContentEvalCase, fixture: dict[str, Any]) -> CheckResult:
    """Check week_number bounds for the case's intended week.

    The eval schema allows week_number up to 13 so the rejection case can be
    represented; the contract ContentWeekContext rejects 13, so this check is
    run on the raw fixture dict.
    """
    week_context = fixture.get("week_context", {})
    if fixture.get("is_week_context_only"):
        week_context = fixture["week_context"]
    fixture_week = week_context.get("week_number", case.cycle_state.week_number)

    if fixture_week == 13:
        return CheckResult(
            "week_in_range",
            False,
            "Week 13 is outside the allowed 1-12 range for a 12-week Strategy",
        )
    if fixture_week == 12 and fixture.get("cycle_status") == "completed":
        return CheckResult(
            "week_12_completion",
            True,
            "Week 12 generated and cycle marked completed",
        )
    return CheckResult(
        "week_in_range",
        True,
        f"Week {fixture_week} is within the allowed 1-12 range",
    )


def _check_funnel_mix(case: ContentEvalCase) -> CheckResult:
    """Advisory: flag a homogeneous funnel mix on the week pack.

    Never a hard blocker. Funnel stages are advisory metadata supplied on the
    eval case's StrategySnapshot; a pack whose items all share one funnel stage
    (e.g. all ``conversion``) surfaces a caution so the human reviewer inspects
    balance across the funnel.
    """
    stages = case.strategy_snapshot.funnel_stages
    if not stages:
        return CheckResult(
            "funnel_mix", True, "No funnel stages declared; funnel-mix advisory skipped"
        )

    distinct = len(set(stages))
    if distinct <= 1:
        return CheckResult(
            "funnel_mix",
            True,
            f"Advisory: all {len(stages)} items share funnel stage(s) "
            f"{sorted(set(stages))}; blend awareness/consideration/conversion",
        )
    return CheckResult(
        "funnel_mix",
        True,
        f"Advisory: funnel stages span {distinct} stage(s); balanced mix",
    )


def validate_case(case: ContentEvalCase) -> CaseValidationResult:
    """Run the deterministic Phase 4 validators against one eval case."""
    try:
        fixture = _load_policy_fixture_dict(case)
    except Exception as exc:
        return CaseValidationResult(
            case_id=case.case_id,
            checked=False,
            checks=[],
            error=f"Fixture load failed: {exc}",
        )

    checks: list[CheckResult] = []

    # 1. Schema validity / frozen contract policy gate.
    if fixture.get("is_week_context_only"):
        # Week-13 and similar standalone contexts are validated by the custom
        # week-range check rather than the full contract fixture validator.
        checks.append(_check_week_range(case, fixture))
    else:
        try:
            # Validate as a ContentPolicyFixture dict. The contract function
            # returns a ContentValidationResult with one issue per hard-guardrail.
            contract_result = validate_content_policy_fixture(fixture)
            checks.extend(_contract_result_to_checks(contract_result))
        except Exception as exc:
            checks.append(
                CheckResult(
                    "contract_policy",
                    False,
                    f"Contract validator raised an exception: {exc}",
                )
            )

    # 2. Custom deterministic checks.
    checks.append(_check_prompt_injection(case, fixture))
    checks.append(_check_wrong_pillar(case, fixture))
    checks.append(_check_no_publishing_guardrail(fixture))
    checks.append(_check_funnel_mix(case))

    # 3. Week-range / completion checks for all fixtures.
    if not fixture.get("is_week_context_only"):
        checks.append(_check_week_range(case, fixture))

    # 4. Phase 5 fake-provider checks for cases that request a provider mode.
    if case.provider_mode is not None:
        try:
            provider_check_results = asyncio.run(provider_checks(case, fixture))
        except Exception as exc:
            provider_check_results = [
                CheckResult(
                    "provider_execution",
                    False,
                    f"Provider check execution failed: {exc}",
                )
            ]
        checks.extend(provider_check_results)

    return CaseValidationResult(
        case_id=case.case_id,
        checked=True,
        checks=checks,
    )

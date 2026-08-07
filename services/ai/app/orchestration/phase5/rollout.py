"""Explicit rollout/rollback decisions for the disabled-by-default graph."""

from collections.abc import Collection

from .contracts import OrchestrationRolloutDecisionV1


def decide_rollout(
    *,
    orchestration_enabled: bool,
    feature_cohort: str,
    allowed_cohorts: Collection[str] = (),
    shadow_mode: bool = False,
) -> OrchestrationRolloutDecisionV1:
    """Return a visible decision; no caller is implicitly routed to the graph."""

    if not orchestration_enabled:
        return OrchestrationRolloutDecisionV1(
            contract_version="orchestration-rollout-v1",
            enabled=False,
            mode="disabled",
            feature_cohort=feature_cohort,
            reason="AI_ORCHESTRATION_ENABLED is false; current paths remain authoritative.",
            rollback_action="none",
        )
    if shadow_mode:
        return OrchestrationRolloutDecisionV1(
            contract_version="orchestration-rollout-v1",
            enabled=True,
            mode="shadow",
            feature_cohort=feature_cohort,
            reason="Shadow mode records comparison evidence without domain writes or owner-visible replacement.",
            rollback_action="disable_flag",
        )
    if feature_cohort not in set(allowed_cohorts):
        return OrchestrationRolloutDecisionV1(
            contract_version="orchestration-rollout-v1",
            enabled=False,
            mode="disabled",
            feature_cohort=feature_cohort,
            reason="The enabled flag is set but this cohort is not on the reviewed demo allow-list.",
            rollback_action="disable_flag",
        )
    return OrchestrationRolloutDecisionV1(
        contract_version="orchestration-rollout-v1",
        enabled=True,
        mode="allowlist",
        feature_cohort=feature_cohort,
        reason="The cohort is explicitly allow-listed after the Phase 5 gates.",
        rollback_action="disable_flag",
    )

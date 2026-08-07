"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getCurrentJourney } from "@/lib/api/journey";
import { getStrategy, getStrategyVersion, getStrategyVersions } from "@/lib/api/strategy";
import { createContentCycle } from "@/lib/api/content-cycle";
import {
  type ContentEntryState,
  resolveApprovedContentStrategy,
} from "../lib/content-cycle-state";
import {
  computeFingerprint,
  getOrCreateIdempotencyKey,
  clearIdempotencyKey,
} from "../lib/content-cycle-idempotency";
import {
  type WeekContextDraft,
  createEmptyWeekContextDraft,
  serializeWeekContext,
  validateWeekContextDraft,
} from "../lib/content-cycle-form";
import { cairoDateFromStrategyStart } from "../lib/content-cycle-schedule";
import { contentErrorKey } from "../lib/content-cycle-errors";
import { CycleThesisHeader } from "./cycle-thesis-header";
import { ApprovedStrategyHandoff } from "./approved-strategy-handoff";
import { WeekContextForm } from "./week-context-form";
import { ContentReadiness } from "./content-readiness";

export function ContentCycleEntry() {
  const t = useTranslations("ContentCycle.entry");
  const tActions = useTranslations("ContentCycle.actions");
  const tErrors = useTranslations("ContentCycle.errors");
  const router = useRouter();

  const [state, setState] = useState<ContentEntryState>({ phase: "loading" });
  const [week1Draft, setWeek1Draft] = useState<WeekContextDraft>(createEmptyWeekContextDraft());
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let isSubscribed = true;

    async function loadEntry() {
      try {
        const journeyRes = await getCurrentJourney();
        if (!isSubscribed) return;

        const cycle = journeyRes.content?.cycle;
        if (cycle) {
          const currentWeek = cycle.current_week;
          if (currentWeek >= 1 && currentWeek <= 12) {
            setState({ phase: "redirecting", cycleId: cycle.id, week: currentWeek });
            router.replace(`/content/${cycle.id}/weeks/${currentWeek}`);
            return;
          }
          setState({ phase: "load_error", errorKey: "invalidServerWeek" });
          return;
        }

        // Check Strategy ID from journey future_phase object
        const strategyId =
          journeyRes.future_phase?.phase === "strategy" &&
          journeyRes.future_phase.availability === "available"
            ? journeyRes.future_phase.strategy_id
            : null;
        if (!strategyId) {
          // Check if strategy is in journey profile
          const profile = journeyRes.journey?.profile;
          if (!profile) {
            setState({
              phase: "blocked",
              reason: "no_profile",
              destination: "/discovery/new",
            });
            return;
          }
          setState({
            phase: "blocked",
            reason: "no_strategy",
            destination: "/strategy/new",
          });
          return;
        }

        // Fetch Strategy and Strategy Version summary in parallel
        const [stratApi, versions] = await Promise.all([
          getStrategy(strategyId),
          getStrategyVersions(strategyId),
        ]);

        if (!isSubscribed) return;

        // For a fresh entry, resolve by the currently approved version
        // (currentVersionId) and fetch its exact plan instead of latestPlan,
        // so a newer draft version never blocks starting the cycle.
        const currentSummary =
          stratApi.currentVersionId === null
            ? null
            : versions.find((v) => v.status === "approved" && v.version_id === stratApi.currentVersionId) ?? null;
        const lockedPlan =
          currentSummary === null
            ? null
            : await getStrategyVersion(strategyId, currentSummary.version);

        if (!isSubscribed) return;

        const resolution = resolveApprovedContentStrategy(
          journeyRes,
          stratApi,
          versions,
          currentSummary && lockedPlan
            ? { strategyVersion: currentSummary.version, strategyDecisionId: currentSummary.decision?.id, plan: lockedPlan }
            : {},
        );
        if ("blocker" in resolution) {
          setState({
            phase: "blocked",
            reason: resolution.blocker,
            destination: resolution.destination,
          });
          return;
        }

        setState({ phase: "ready_to_start", approved: resolution.approved });
      } catch (err: unknown) {
        if (!isSubscribed) return;
        setState({ phase: "load_error", errorKey: contentErrorKey(err as { status?: number; code?: string; message?: string }) });
      }
    }

    void loadEntry();

    return () => {
      isSubscribed = false;
    };
  }, [router]);

  const handleStartCycle = async () => {
    if (state.phase !== "ready_to_start" || isStarting) return;

    const validation = validateWeekContextDraft(week1Draft);
    if (!validation.isValid) {
      setStartError(t("contextRequired"));
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const approved = state.approved;
      const startDate = cairoDateFromStrategyStart(approved.brief.start_date);
      const initialWeekContext = serializeWeekContext(week1Draft, {
        weekNumber: 1,
        weekStartDate: startDate,
      });
      const scope = `content-cycle:create:${approved.strategyId}:${approved.strategyVersion}:${approved.strategyDecisionId}`;
      const payloadRaw = JSON.stringify({
        business_id: approved.businessId,
        strategy_id: approved.strategyId,
        strategy_version: approved.strategyVersion,
        strategy_decision_id: approved.strategyDecisionId,
        initial_week_context: initialWeekContext,
      });
      const fingerprint = await computeFingerprint(payloadRaw);
      const idempotencyKey = getOrCreateIdempotencyKey(scope, fingerprint);
      const response = await createContentCycle({
        business_id: approved.businessId,
        strategy_id: approved.strategyId,
        strategy_version: approved.strategyVersion,
        strategy_decision_id: approved.strategyDecisionId,
        idempotency_key: idempotencyKey,
        initial_week_context: initialWeekContext,
      });

      clearIdempotencyKey(scope);
      router.replace(`/content/${response.content_cycle.id}/weeks/1`);
    } catch (err: unknown) {
      setStartError(tErrors(contentErrorKey(err as { status?: number; code?: string; message?: string })));
    } finally {
      setIsStarting(false);
    }
  };

  if (state.phase === "loading" || state.phase === "redirecting") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  if (state.phase === "load_error") {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-center text-danger space-y-3">
        <p className="font-bold">{tErrors(state.errorKey)}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white"
        >
          {tActions("refresh")}
        </button>
      </div>
    );
  }

  if (state.phase === "blocked") {
    const blockerKey = state.reason;
    let title = t("loadError");
    let body = t("loadError");
    let actionLabel = t("noProfileStartAction");

    if (blockerKey === "no_profile") {
      title = t("noProfileTitle");
      body = t("noProfileBody");
    } else if (blockerKey === "no_strategy") {
      title = t("noStrategyTitle");
      body = t("noStrategyBody");
      actionLabel = t("noStrategyStartAction");
    } else if (blockerKey === "strategy_not_approved") {
      title = t("approvalRequiredTitle");
      body = t("approvalRequiredBody");
      actionLabel = t("approvalRequiredAction");
    } else if (blockerKey === "missing_approval_receipt") {
      title = t("approvalRequiredTitle");
      body = t("approvalRequiredBody");
      actionLabel = t("approvalRequiredAction");
    } else if (blockerKey === "stale_profile") {
      title = t("staleProfileTitle");
      body = t("staleProfileBody");
      actionLabel = t("staleProfileAction");
    } else if (blockerKey === "malformed_plan") {
      title = t("malformedPlanTitle");
      body = t("malformedPlanBody");
      actionLabel = t("noStrategyStartAction");
    } else if (blockerKey === "provenance_mismatch") {
      title = t("staleProfileTitle");
      body = t("staleProfileBody");
      actionLabel = t("staleProfileAction");
    }

    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-4">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-3">
          <h1 className="text-lg font-bold text-navy">{title}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>

          {state.destination && (
            <div className="pt-2">
              <Link
                href={state.destination as never}
                className="inline-flex items-center justify-center rounded-lg bg-action px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-action/90"
              >
                {actionLabel}
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  const approved = state.approved;
  const isFormValid = validateWeekContextDraft(week1Draft).isValid;

  return (
    <div className="space-y-6">
      <CycleThesisHeader selectedWeek={1} approved={approved} />

      {startError && (
        <div role="alert" aria-live="polite" className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger">
          {startError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <ApprovedStrategyHandoff selectedWeek={1} approved={approved} />

          <WeekContextForm
            initialContext={null}
            isSubmitting={isStarting}
            onDraftChange={setWeek1Draft}
            showSave={false}
            onSave={async (draft) => {
              setWeek1Draft(draft);
            }}
          />
        </div>

        <div>
          <ContentReadiness
            approved={approved}
            selectedWeek={1}
            contextCutoffIso={null}
            hasContext={isFormValid}
            primaryAction={isFormValid ? "start_cycle" : "none"}
            isMutating={isStarting}
            onStartCycle={handleStartCycle}
          />
        </div>
      </div>
    </div>
  );
}

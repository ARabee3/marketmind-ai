"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getCurrentJourney } from "@/lib/api/journey";
import {
  getStrategy,
  getStrategyVersion,
  getStrategyVersions,
} from "@/lib/api/strategy";
import { createContentCycle, getContentCycle } from "@/lib/api/content-cycle";
import { isStrategyPlanV2 } from "@/features/strategy/lib/strategy-v2";
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
  createEmptyWeekContextDraft,
  serializeWeekContext,
} from "../lib/content-cycle-form";
import { cairoDateFromStrategyStart } from "../lib/content-cycle-schedule";
import { contentErrorKey } from "../lib/content-cycle-errors";

export function ContentCycleEntry() {
  const t = useTranslations("ContentV2.entry");
  const tEntry = useTranslations("ContentCycle.entry");
  const tActions = useTranslations("ContentCycle.actions");
  const tErrors = useTranslations("ContentCycle.errors");
  const router = useRouter();

  const [state, setState] = useState<ContentEntryState>({ phase: "loading" });
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
            try {
              const cycleRow = await getContentCycle(cycle.id);
              if (
                (cycleRow as { contract_version?: string }).contract_version !==
                "content-v2"
              ) {
                if (!isSubscribed) return;
                setState({ phase: "load_error", errorKey: "contentV2Required" });
                return;
              }
            } catch {
              // Do not guess a legacy route when the cycle read fails.
              if (!isSubscribed) return;
              setState({ phase: "load_error", errorKey: "unknown" });
              return;
            }
            setState({
              phase: "redirecting",
              cycleId: cycle.id,
              week: currentWeek,
            });
            router.replace(`/content/${cycle.id}/studio`);
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
            : (versions.find(
                (v) =>
                  v.status === "approved" &&
                  v.version_id === stratApi.currentVersionId,
              ) ?? null);
        const lockedPlan =
          currentSummary === null
            ? null
            : await getStrategyVersion(strategyId, currentSummary.version);

        if (!isSubscribed) return;

        const resolution = resolveApprovedContentStrategy(
          journeyRes,
          stratApi,
          versions,
          {
            ...(currentSummary && lockedPlan
              ? {
                  strategyVersion: currentSummary.version,
                  strategyDecisionId: currentSummary.decision?.id,
                  plan: lockedPlan,
                }
              : {}),
            requireStrategyV2: true,
          },
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
        setState({
          phase: "load_error",
          errorKey: contentErrorKey(
            err as { status?: number; code?: string; message?: string },
          ),
        });
      }
    }

    void loadEntry();

    return () => {
      isSubscribed = false;
    };
  }, [router]);

  const handleStartCycle = async () => {
    if (state.phase !== "ready_to_start" || isStarting) return;

    setIsStarting(true);
    setStartError(null);

    let idempotencyScope: string | null = null;
    try {
      const approved = state.approved;
      const startDate = cairoDateFromStrategyStart(approved.brief.start_date);
      // Content v2 replaces the oversized week-1 context form: the owner can
      // refine the editorial profile, CTA library, and media in the studio
      // after planning the week. The cycle is created with a safe-default
      // context that the v2 generation claim freezes together with the week
      // plan snapshot (issue #187).
      const initialWeekContext = serializeWeekContext(
        createEmptyWeekContextDraft(),
        {
          weekNumber: 1,
          weekStartDate: startDate,
        },
      );
      const scope = `content-cycle:create:${approved.strategyId}:${approved.strategyVersion}:${approved.strategyDecisionId}`;
      idempotencyScope = scope;
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

      const createdCycle = response.content_cycle as {
        id: string;
        contract_version?: string;
      };
      if (createdCycle.contract_version !== "content-v2") {
        throw {
          status: 409,
          code: "CONTENT_V2_REQUIRED",
          message: "The Content cycle is not a content-v2 cycle.",
        };
      }
      clearIdempotencyKey(scope);
      router.replace(`/content/${createdCycle.id}/studio`);
    } catch (err: unknown) {
      const errorCode = (err as { code?: string } | null)?.code;
      if (errorCode === "CONTENT_V2_REQUIRED" && idempotencyScope) {
        clearIdempotencyKey(idempotencyScope);
      }
      setStartError(
        tErrors(
          contentErrorKey(
            err as { status?: number; code?: string; message?: string },
          ),
        ),
      );
    } finally {
      setIsStarting(false);
    }
  };

  if (state.phase === "loading" || state.phase === "redirecting") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        {tEntry("loading")}
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
    let title = tEntry("loadError");
    let body = tEntry("loadError");
    let actionLabel = tEntry("noProfileStartAction");

    if (blockerKey === "no_profile") {
      title = tEntry("noProfileTitle");
      body = tEntry("noProfileBody");
    } else if (blockerKey === "no_strategy") {
      title = tEntry("noStrategyTitle");
      body = tEntry("noStrategyBody");
      actionLabel = tEntry("noStrategyStartAction");
    } else if (blockerKey === "strategy_not_approved") {
      title = tEntry("approvalRequiredTitle");
      body = tEntry("approvalRequiredBody");
      actionLabel = tEntry("approvalRequiredAction");
    } else if (blockerKey === "missing_approval_receipt") {
      title = tEntry("approvalRequiredTitle");
      body = tEntry("approvalRequiredBody");
      actionLabel = tEntry("approvalRequiredAction");
    } else if (blockerKey === "stale_profile") {
      title = tEntry("staleProfileTitle");
      body = tEntry("staleProfileBody");
      actionLabel = tEntry("staleProfileAction");
    } else if (blockerKey === "malformed_plan") {
      title = tEntry("malformedPlanTitle");
      body = tEntry("malformedPlanBody");
      actionLabel = tEntry("noStrategyStartAction");
    } else if (blockerKey === "content_v2_required") {
      title = tEntry("contentV2RequiredTitle");
      body = tEntry("contentV2RequiredBody");
      actionLabel = tEntry("noStrategyStartAction");
    } else if (blockerKey === "provenance_mismatch") {
      title = tEntry("staleProfileTitle");
      body = tEntry("staleProfileBody");
      actionLabel = tEntry("staleProfileAction");
    }

    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-4">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-3">
          <h1 className="text-lg font-bold text-navy">{title}</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {body}
          </p>

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

  const plan = approved.plan;
  const isV2 = isStrategyPlanV2(plan);
  const weekOne = isV2
    ? plan.calendar_weeks.find((week) => week.week_number === 1)
    : null;
  const channels =
    isV2 && plan.content_handoff.available ? plan.content_handoff.channels : [];
  const weekOneFormats = weekOne?.formats ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wide text-primary">
          {t("eyebrow")}
        </p>
        <h1 className="text-xl font-bold text-navy">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {startError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger"
        >
          {startError}
        </div>
      )}

      <section
        aria-labelledby="entry-strategy"
        className="rounded-xl border border-border bg-surface p-4 shadow-sm space-y-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="entry-strategy" className="text-sm font-bold text-navy">
            {t("strategyLabel")}
          </h2>
          <Link
            href={`/strategy/${approved.strategyId}` as never}
            className="text-xs font-bold text-action hover:underline"
          >
            {t("viewStrategyCta")}
          </Link>
        </div>
        {weekOne && (
          <dl className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("weekOneFocusLabel")}
              </dt>
              <dd className="mt-0.5 text-navy">{weekOne.focus}</dd>
            </div>
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("channelsLabel")}
              </dt>
              <dd className="mt-0.5 text-navy">
                {channels.length > 0
                  ? channels.map((channel) => t(`channels.${channel}`)).join(" · ")
                  : t("notAvailable")}
              </dd>
            </div>
            {weekOneFormats.length > 0 && (
              <div>
                <dt className="font-semibold text-muted-foreground">
                  {t("formatsLabel")}
                </dt>
                <dd className="mt-0.5 text-navy">
                    {weekOneFormats
                      .map((format) => t(`formats.${format}` as never))
                      .join(" · ")}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section
        aria-labelledby="entry-next"
        className="rounded-xl border border-border bg-surface p-4 shadow-sm space-y-3"
      >
        <h2 id="entry-next" className="text-sm font-bold text-navy">
          {t("whatNextLabel")}
        </h2>
        <ol className="list-decimal ps-5 space-y-1.5 text-xs leading-relaxed text-navy">
          <li>{t("step1")}</li>
          <li>{t("step2")}</li>
          <li>{t("step3")}</li>
        </ol>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {t("noPublishNote")}
        </p>
      </section>

      <button
        type="button"
        onClick={handleStartCycle}
        disabled={isStarting}
        className="rounded-lg bg-action px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-action/90 disabled:opacity-60"
      >
        {isStarting ? t("startingCta") : t("startCta")}
      </button>
    </div>
  );
}

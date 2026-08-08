import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ContentCycleStatus } from "@marketmind/contracts";
import { isStrategyPlanV2 } from "@/features/strategy/lib/strategy-v2";
import type { ApprovedContentStrategy, ContentPrimaryAction } from "../lib/content-cycle-state";

type Props = {
  readonly approved: ApprovedContentStrategy | null;
  readonly selectedWeek: number;
  readonly contextCutoffIso?: string | null;
  readonly hasContext: boolean;
  readonly isCycleActive?: boolean;
  readonly cycleStatus?: ContentCycleStatus;
  readonly primaryAction: ContentPrimaryAction;
  readonly isMutating?: boolean;
  readonly onStartCycle?: () => Promise<void>;
  readonly onSaveContext?: () => void;
  readonly onGenerateWeek?: () => Promise<void>;
  readonly onRetry?: () => Promise<void>;
  readonly onRefresh?: () => void;
  readonly packIdForReview?: string | null;
  /** The pack-review route is supplied by companion issue #155. */
  readonly reviewRouteAvailable?: boolean;
};

export function ContentReadiness({
  approved,
  selectedWeek,
  contextCutoffIso = null,
  hasContext,
  isCycleActive = true,
  cycleStatus,
  primaryAction,
  isMutating = false,
  onStartCycle,
  onSaveContext,
  onGenerateWeek,
  onRetry,
  onRefresh,
  packIdForReview = null,
  reviewRouteAvailable = false,
}: Props) {
  const tReadiness = useTranslations("ContentCycle.readiness");
  const tActions = useTranslations("ContentCycle.actions");
  const tContext = useTranslations("ContentCycle.context");
  const format = useFormatter();
  const resolvedCycleStatus = cycleStatus ?? (isCycleActive ? "active" : "completed");

  const isStrategyOk = Boolean(approved);
  const isProfileOk = Boolean(approved);
  const isRoadmapOk = approved
    ? isStrategyPlanV2(approved.plan)
      ? approved.plan.content_handoff.available === true
        && approved.plan.content_handoff.weeks.length === 12
      : approved.plan.content_strategy?.weeks?.length === 12
    : false;

  let cutoffText = tContext("relativeCutoff", { week: selectedWeek + 1 });
  if (contextCutoffIso) {
    cutoffText = tContext("cutoff", {
      time: format.dateTime(new Date(contextCutoffIso), {
        timeZone: "Africa/Cairo",
        dateStyle: "medium",
        timeStyle: "short",
      }),
    });
  }

  return (
    <aside
      aria-label={tReadiness("label")}
      className="lg:sticky lg:top-20 rounded-xl border border-border bg-surface p-5 space-y-5 shadow-sm"
    >
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {tReadiness("label")}
        </h2>
        <p
          id="content-readiness-status"
          tabIndex={-1}
          className="mt-1 text-sm font-bold text-navy outline-none"
        >
          {primaryAction !== "none"
            ? tReadiness("readyTitle")
            : tReadiness("blockedTitle")}
        </p>
      </div>

      {/* Checklist */}
      <ul className="space-y-2 text-xs">
        <li className="flex items-center gap-2">
          <span className={isStrategyOk ? "text-primary font-bold" : "text-muted-foreground"}>
            {isStrategyOk ? "✓" : "○"}
          </span>
          <span className="text-navy">{tReadiness("strategyApproved")}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className={isProfileOk ? "text-primary font-bold" : "text-muted-foreground"}>
            {isProfileOk ? "✓" : "○"}
          </span>
          <span className="text-navy">{tReadiness("profileMatches")}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className={isRoadmapOk ? "text-primary font-bold" : "text-muted-foreground"}>
            {isRoadmapOk ? "✓" : "○"}
          </span>
          <span className="text-navy">{tReadiness("weeklyPlanReady")}</span>
        </li>
        <li className="flex items-center gap-2">
          <span className={hasContext ? "text-primary font-bold" : "text-warning font-bold"}>
            {hasContext ? "✓" : "⚠"}
          </span>
          <span className="text-navy">
            {hasContext ? tReadiness("contextConfirmed") : tReadiness("contextNeeded")}
          </span>
        </li>
      </ul>

      {/* Cutoff info */}
      <div className="rounded-lg border border-border/80 bg-background p-3 text-xs space-y-1">
        <p className="font-semibold text-navy">{cutoffText}</p>
      </div>

      {/* Consequence Notice */}
      <div className="space-y-1 text-xs">
        <p className="font-semibold text-navy">{tReadiness("consequenceTitle")}</p>
        <p className="text-muted-foreground leading-relaxed">
          {tReadiness("consequenceBody")}
        </p>
      </div>

      {/* Exactly ONE Primary Action Button */}
      <div className="pt-2">
        {primaryAction === "start_cycle" && onStartCycle && (
          <button
            type="button"
            onClick={onStartCycle}
            disabled={isMutating}
            className="w-full rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-action/90 focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
          >
            {isMutating ? tActions("startingCycle") : tActions("startCycle")}
          </button>
        )}

        {primaryAction === "save_context" && (
          <button
            type="button"
            onClick={onSaveContext}
            disabled={isMutating}
            className="w-full rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-action/90 focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
          >
            {tActions("editContext")}
          </button>
        )}

        {primaryAction === "generate_week" && onGenerateWeek && (
          <button
            type="button"
            onClick={onGenerateWeek}
            disabled={isMutating}
            className="w-full rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-action/90 focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
          >
            {isMutating
              ? tActions("generatingWeek")
              : tActions("generateWeek", { week: selectedWeek })}
          </button>
        )}

        {primaryAction === "retry_generation" && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isMutating}
            className="w-full rounded-lg bg-danger px-4 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-danger/90 focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
          >
            {isMutating
              ? tActions("retryingGeneration")
              : tActions("retryGeneration")}
          </button>
        )}

        {primaryAction === "review_pack" && packIdForReview && (
          reviewRouteAvailable ? (
            <Link
              href={`/content/packs/${packIdForReview}`}
              className="inline-flex w-full items-center justify-center rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-action/90 focus-visible:ring-2 focus-visible:ring-action"
            >
              {tActions("reviewPack")}
            </Link>
          ) : (
            <div
              role="status"
              className="w-full rounded-lg border border-border bg-background p-3 text-center text-xs font-medium text-muted-foreground"
            >
              {tReadiness("packReviewUnavailable")}
            </div>
          )
        )}

        {primaryAction === "refresh_status" && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-xs font-bold text-navy shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-action"
          >
            {tActions("refresh")}
          </button>
        )}

        {primaryAction === "go_to_discovery" && (
          <Link
            href="/discovery/new"
            className="inline-flex w-full items-center justify-center rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm"
          >
            {tActions("goToDiscovery")}
          </Link>
        )}

        {primaryAction === "go_to_strategy" && (
          <Link
            href="/strategy/new"
            className="inline-flex w-full items-center justify-center rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm"
          >
            {tActions("goToStrategy")}
          </Link>
        )}

        {primaryAction === "review_strategy" && approved && (
          <Link
            href={`/strategy/${approved.strategyId}/review`}
            className="inline-flex w-full items-center justify-center rounded-lg bg-action px-4 py-3 text-xs font-bold text-white shadow-sm"
          >
            {tActions("reviewStrategy")}
          </Link>
        )}

        {primaryAction === "none" && resolvedCycleStatus !== "active" && (
          <div className="rounded-lg border border-border bg-background p-3 text-center text-xs font-semibold text-muted-foreground">
            {resolvedCycleStatus === "paused"
              ? tReadiness("cyclePaused")
              : tReadiness("cycleCompleted")}
          </div>
        )}
      </div>
    </aside>
  );
}

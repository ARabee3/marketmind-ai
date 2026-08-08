"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  ContentCycleWorkspaceV2,
  ContentWeekSummaryV2,
} from "@marketmind/contracts";
import { getCycleWorkspaceV2, planWeekV2 } from "@/lib/api/content-v2";
import { generateContentWeek } from "@/lib/api/content-cycle";
import { createIdempotencyKey } from "@/lib/api/publishing";
import { ContentV2PostCard } from "./content-v2-post-card";
import { ContentV2Setup } from "./content-v2-setup";

type StudioProps = {
  readonly cycleId: string;
};

export function ContentV2Studio({ cycleId }: StudioProps) {
  const t = useTranslations("ContentV2.studio");
  const tErrors = useTranslations("ContentV2.errors");
  const tActions = useTranslations("ContentV2.studio");
  const format = useFormatter();

  const [workspace, setWorkspace] = useState<ContentCycleWorkspaceV2 | null>(
    null,
  );
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorKey, setErrorKey] = useState<"loadFailed" | "legacyCycle">(
    "loadFailed",
  );
  const [mode, setMode] = useState<"studio" | "setup">("studio");
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<
    "planFailed" | "generateFailed" | null
  >(null);

  const load = useCallback(async () => {
    try {
      const data = await getCycleWorkspaceV2(cycleId);
      setWorkspace(data);
      setPhase("ready");
    } catch (err: unknown) {
      const candidate = err as { code?: string };
      setErrorKey(
        candidate.code === "CONTENT_V2_REQUIRED" ? "legacyCycle" : "loadFailed",
      );
      setPhase("error");
    }
  }, [cycleId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handlePlan = async () => {
    if (!workspace || isMutating) return;
    setIsMutating(true);
    setMutationError(null);
    try {
      await planWeekV2(cycleId, workspace.current_week.week_number);
      await load();
    } catch {
      setMutationError("planFailed");
    } finally {
      setIsMutating(false);
    }
  };

  const handleGenerate = async () => {
    if (!workspace || isMutating) return;
    setIsMutating(true);
    setMutationError(null);
    try {
      await generateContentWeek(cycleId, workspace.current_week.week_number, {
        content_cycle_id: cycleId,
        week_number: workspace.current_week.week_number,
        idempotency_key: createIdempotencyKey(),
      });
      await load();
    } catch {
      setMutationError("generateFailed");
    } finally {
      setIsMutating(false);
    }
  };

  if (phase === "loading") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        {tActions("planningCta")}
      </div>
    );
  }

  if (phase === "error" || !workspace) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-4">
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-danger space-y-3">
          <p className="text-sm font-bold">{tErrors(errorKey)}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white"
          >
            {tErrors("refresh")}
          </button>
        </div>
      </div>
    );
  }

  const {
    current_week,
    previous_weeks,
    next_week,
    cta_library,
    media_library,
  } = workspace;
  const ctaById = new Map(cta_library.map((entry) => [entry.id, entry.label]));
  const mediaById = new Set(media_library.map((entry) => entry.id));

  const primaryActionLabel = () => {
    switch (current_week.primary_action) {
      case "configure_editorial_profile":
        return t("configureProfileCta");
      case "plan_week":
        return t("planCta");
      case "refine_plan":
        return t("refineCta");
      case "generate":
        return t("generateCta");
      case "review_pack":
        return t("reviewCta");
      case "retry":
        return t("retryCta");
      default:
        return null;
    }
  };

  const handlePrimaryAction = () => {
    switch (current_week.primary_action) {
      case "configure_editorial_profile":
        setMode("setup");
        return;
      case "plan_week":
        void handlePlan();
        return;
      case "generate":
        void handleGenerate();
        return;
      case "retry":
        void handleGenerate();
        return;
      default:
        return;
    }
  };

  const reviewHref =
    current_week.primary_action === "review_pack" && current_week.pack
      ? `/content/packs/${current_week.pack.id}`
      : null;

  if (mode === "setup") {
    return (
      <ContentV2Setup
        cycleId={cycleId}
        editorialProfile={workspace.editorial_profile}
        ctaEntries={workspace.cta_library}
        mediaEntries={workspace.media_library}
        onBack={() => setMode("studio")}
        onSaved={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wide text-primary">
          {t("eyebrow")}
        </p>
        <h1 className="text-xl font-bold text-navy">{t("currentWeekLabel")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("weekBadge", { week: current_week.week_number })} ·{" "}
          {format.dateTime(new Date(), {
            timeZone: "Africa/Cairo",
            day: "numeric",
            month: "long",
          })}
        </p>
      </header>

      {mutationError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger"
        >
          {tErrors(mutationError)}
        </div>
      )}

      {current_week.goal && (
        <section
          aria-labelledby="week-goal"
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <h2
            id="week-goal"
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
          >
            {t("goalLabel")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-navy">
            {current_week.goal}
          </p>
        </section>
      )}

      {/* Rhythm: previous / current / next */}
      <nav aria-label={t("currentWeekLabel")} className="space-y-4">
        <section aria-labelledby="previous-weeks" className="space-y-2">
          <h2
            id="previous-weeks"
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
          >
            {t("previousWeeksLabel")}
          </h2>
          {previous_weeks.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("historyEmpty")}</p>
          ) : (
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {previous_weeks.map((week) => (
                <li key={week.week_number}>
                  <WeekSummary week={week} />
                </li>
              ))}
            </ol>
          )}
        </section>

        {next_week && (
          <section aria-labelledby="next-week" className="space-y-2">
            <h2
              id="next-week"
              className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              {t("nextWeekLabel")}
            </h2>
            <p className="rounded-xl border border-dashed border-border bg-surface/60 p-3 text-xs text-muted-foreground">
              {t("nextPreview")}
            </p>
          </section>
        )}
      </nav>

      {/* Why this week? */}
      <details className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-bold text-navy">
          {t("whyThisWeek")}
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("whyThisWeekHelp")}
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
          <div>
            <dt className="font-semibold text-muted-foreground">
              {t("focusLabel")}
            </dt>
            <dd className="mt-0.5 text-navy">
              {workspace.why_this_week.focus}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-muted-foreground">
              {t("outcomeLabel")}
            </dt>
            <dd className="mt-0.5 text-navy">
              {workspace.why_this_week.expected_outcome}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-muted-foreground">
              {t("measurementLabel")}
            </dt>
            <dd className="mt-0.5 text-navy">
              {workspace.why_this_week.measurement_check}
            </dd>
          </div>
          {workspace.why_this_week.owner_advice.length > 0 && (
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("adviceLabel")}
              </dt>
              <dd className="mt-0.5 space-y-1 text-navy">
                {workspace.why_this_week.owner_advice.map((advice, index) => (
                  <p key={index}>{advice}</p>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </details>

      {/* Generation state + primary action */}
      <section aria-labelledby="generation-state" className="space-y-3">
        <p id="generation-state" className="text-sm font-semibold text-navy">
          {t(`generationState.${current_week.generation_state}`)}
        </p>
        {!workspace.editorial_profile &&
          current_week.primary_action !== "none" && (
            <p className="text-xs text-warning">{t("noProfile")}</p>
          )}
        <div className="flex flex-wrap items-center gap-3">
          {primaryActionLabel() && (
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={isMutating}
              className="rounded-lg bg-action px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-action/90 disabled:opacity-60"
            >
              {isMutating ? t("planningCta") : primaryActionLabel()}
            </button>
          )}
          {reviewHref && (
            <Link
              href={reviewHref as never}
              className="rounded-lg border border-primary px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/5"
            >
              {t("reviewCta")}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setMode("setup")}
            className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-navy hover:bg-muted"
          >
            {t("configureProfileCta")}
          </button>
          <Link
            href={workspace.view_full_strategy_route as never}
            className="text-xs font-bold text-action hover:underline"
          >
            {t("viewFullStrategy")}
          </Link>
        </div>
      </section>

      {/* Post cards */}
      {current_week.week_plan &&
        current_week.week_plan.post_plans.length > 0 && (
          <section aria-labelledby="post-cards" className="space-y-3">
            <h2
              id="post-cards"
              className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
            >
              {t("currentWeekLabel")}
            </h2>
            <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {current_week.week_plan.post_plans.map((plan) => (
                <li key={plan.id}>
                  <ContentV2PostCard
                    plan={plan}
                    ctaLabel={
                      plan.cta_library_entry_id
                        ? (ctaById.get(plan.cta_library_entry_id) ?? null)
                        : null
                    }
                    mediaCount={
                      plan.selected_media_ids.filter((id) => mediaById.has(id))
                        .length
                    }
                  />
                </li>
              ))}
            </ol>
          </section>
        )}
    </div>
  );
}

function WeekSummary({ week }: { week: ContentWeekSummaryV2 }) {
  const t = useTranslations("ContentV2.studio.historyStatus");
  const tStudio = useTranslations("ContentV2.studio");

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-xs font-bold text-navy">
        {tStudio("weekBadge", { week: week.week_number })}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {t(week.status)}
      </span>
    </div>
  );
}

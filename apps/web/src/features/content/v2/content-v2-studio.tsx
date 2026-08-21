"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  ContentCycleWorkspaceV2,
  ContentMediaLibraryEntryV2,
  ContentPostPlanV2,
  ContentWeekSummaryV2,
} from "@marketmind/contracts";
import {
  createOrReplaceWeekPlanV2,
  getCycleWorkspaceV2,
  planWeekV2,
  regenerateContentPackV2,
  uploadMediaV2,
} from "@/lib/api/content-v2";
import { generateContentWeek, retryContentPack } from "@/lib/api/content-cycle";
import { createIdempotencyKey } from "@/lib/api/publishing";
import { useWallet } from "@/features/billing/wallet-context";
import { ContentV2PostCard } from "./content-v2-post-card";
import { ContentV2Setup } from "./content-v2-setup";
import { ContentGenerateConfirmDialog } from "./content-generate-confirm-dialog";
import { contentFormatPointCost } from "./content-v2-pricing";

type StudioProps = {
  readonly cycleId: string;
};

type MutationErrorKey =
  | "planFailed"
  | "generateFailed"
  | "saveFailed"
  | "planInvalid"
  | "cyclePaused"
  | "cycleCompleted"
  | "weekAlreadyClaimed"
  | "rateLimited"
  | "insufficientPoints";

export function ContentV2Studio({ cycleId }: StudioProps) {
  const t = useTranslations("ContentV2.studio");
  const tErrors = useTranslations("ContentV2.errors");
  const format = useFormatter();
  const { wallet, refresh: refreshWallet } = useWallet();

  const [workspace, setWorkspace] = useState<ContentCycleWorkspaceV2 | null>(
    null,
  );
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorKey, setErrorKey] = useState<"loadFailed" | "legacyCycle">(
    "loadFailed",
  );
  const [mode, setMode] = useState<"studio" | "setup">("studio");
  const [isMutating, setIsMutating] = useState(false);
  const [mutatingAction, setMutatingAction] = useState<
    "plan" | "generate" | "retry" | "regenerate" | "savePlan" | null
  >(null);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<MutationErrorKey | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<
    "generate" | "retry" | "regenerate" | null
  >(null);
  const previousGenerationState = useRef<string | null>(null);

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

  useEffect(() => {
    if (
      !workspace ||
      !["queued", "generating"].includes(
        workspace.current_week.generation_state,
      )
    ) {
      return;
    }
    const interval = window.setInterval(() => {
      void load();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [load, workspace]);

  useEffect(() => {
    const state = workspace?.current_week.generation_state ?? null;
    const previous = previousGenerationState.current;
    previousGenerationState.current = state;
    if (
      previous &&
      ["queued", "generating"].includes(previous) &&
      ["ready", "completed"].includes(state ?? "")
    ) {
      void refreshWallet();
    }
  }, [refreshWallet, workspace?.current_week.generation_state]);

  const handlePlan = async (isReplan = false) => {
    if (!workspace || isMutating) return;
    if (
      isReplan &&
      workspace.current_week.week_plan?.post_plans.some(
        (plan) => plan.source === "owner",
      ) &&
      !window.confirm(t("replanConfirm"))
    ) {
      return;
    }
    setIsMutating(true);
    setMutatingAction("plan");
    setMutationError(null);
    try {
      await planWeekV2(cycleId, workspace.current_week.week_number);
      await load();
    } catch (error: unknown) {
      setMutationError(mutationErrorKey(error, "planFailed"));
    } finally {
      setIsMutating(false);
      setMutatingAction(null);
    }
  };

  const handleGenerate = async (
    action: "generate" | "retry" | "regenerate" = "generate",
  ) => {
    if (!workspace || isMutating) return;
    setIsMutating(true);
    setMutatingAction(action);
    setMutationError(null);
    try {
      if (action === "regenerate" && workspace.current_week.pack) {
        await regenerateContentPackV2(workspace.current_week.pack.id);
      } else if (action === "retry" && workspace.current_week.pack) {
        await retryContentPack(workspace.current_week.pack.id);
      } else {
        await generateContentWeek(cycleId, workspace.current_week.week_number, {
          content_cycle_id: cycleId,
          week_number: workspace.current_week.week_number,
          idempotency_key: createIdempotencyKey(),
        });
      }
      await load();
    } catch (error: unknown) {
      setMutationError(mutationErrorKey(error, "generateFailed"));
    } finally {
      setIsMutating(false);
      setMutatingAction(null);
    }
  };

  const requestGenerate = (action: "generate" | "retry" | "regenerate") => {
    if (!workspace || isMutating) return;
    setConfirmAction(action);
  };

  const handleSavePlan = async (
    planId: string,
    changes: Pick<
      ContentPostPlanV2,
      | "purpose"
      | "intended_audience"
      | "channel"
      | "format"
      | "cta_library_entry_id"
      | "owner_instructions"
      | "visual_direction"
      | "selected_media_ids"
    >,
    closeEditor = true,
  ) => {
    if (!workspace?.current_week.week_plan || isMutating) return;
    setIsMutating(true);
    setMutatingAction("savePlan");
    setMutationError(null);
    try {
      const postPlans = workspace.current_week.week_plan.post_plans.map(
        (plan) => ({
          position: plan.position,
          purpose: plan.id === planId ? changes.purpose : plan.purpose,
          intended_audience:
            plan.id === planId
              ? changes.intended_audience
              : plan.intended_audience,
          channel: plan.id === planId ? changes.channel : plan.channel,
          format: plan.id === planId ? changes.format : plan.format,
          cta_library_entry_id:
            plan.id === planId
              ? changes.cta_library_entry_id
              : plan.cta_library_entry_id,
          owner_instructions:
            plan.id === planId
              ? changes.owner_instructions
              : plan.owner_instructions,
          visual_direction:
            plan.id === planId
              ? changes.visual_direction
              : plan.visual_direction,
          selected_media_ids:
            plan.id === planId
              ? changes.selected_media_ids
              : plan.selected_media_ids,
        }),
      );
      await createOrReplaceWeekPlanV2(
        cycleId,
        workspace.current_week.week_number,
        { post_plans: postPlans },
      );
      if (closeEditor) setEditingPlanId(null);
      await load();
    } catch (error: unknown) {
      setMutationError(mutationErrorKey(error, "saveFailed"));
      throw error;
    } finally {
      setIsMutating(false);
      setMutatingAction(null);
    }
  };

  const handleUploadMedia = async (
    file: File,
  ): Promise<ContentMediaLibraryEntryV2> => {
    const { media } = await uploadMediaV2(cycleId, file);
    if (media.status !== "ready") {
      throw new Error(media.failure_code ?? "media_upload_failed");
    }
    setWorkspace((current) =>
      current
        ? {
            ...current,
            media_library: [
              ...current.media_library.filter((entry) => entry.id !== media.id),
              media,
            ],
          }
        : current,
    );
    return media;
  };

  if (phase === "loading") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        {t("loading")}
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
            className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
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
  const ctaById = new Map(cta_library.map((entry) => [entry.id, entry]));
  const readyMediaIds = new Set(
    media_library
      .filter((entry) => entry.status === "ready")
      .map((entry) => entry.id),
  );
  const isWeekCompleted =
    current_week.generation_state === "completed" ||
    current_week.pack?.status === "approved";

  const weekCost =
    current_week.week_plan?.post_plans.reduce(
      (total, plan) => total + contentFormatPointCost(plan.format),
      0,
    ) ?? 0;
  const generateBlocked =
    current_week.primary_action === "generate" &&
    wallet !== null &&
    weekCost > 0 &&
    wallet.balance < weekCost;

  const primaryActionLabel = () => {
    switch (current_week.primary_action) {
      case "plan_week":
        return t("planCta");
      case "generate":
        return t("generateCta");
      case "review_pack":
        return current_week.pack
          ? t(isWeekCompleted ? "viewApprovedCta" : "reviewCta")
          : null;
      case "retry":
        return t("retryCta");
      case "regenerate":
        return t("regenerateCta");
      default:
        return null;
    }
  };

  const handlePrimaryAction = (event: MouseEvent<HTMLButtonElement>) => {
    // Keep the action mutation-only if this control is ever composed inside a
    // form or link wrapper; generation must never fall back to browser GET
    // navigation.
    event.preventDefault();
    switch (current_week.primary_action) {
      case "plan_week":
        void handlePlan();
        return;
      case "generate":
        requestGenerate("generate");
        return;
      case "retry":
        requestGenerate("retry");
        return;
      case "regenerate":
        requestGenerate("regenerate");
        return;
      default:
        return;
    }
  };

  const primaryLabel = primaryActionLabel();

  return (
    <>
      <div hidden={mode !== "studio"} aria-hidden={mode !== "studio"}>
        <div className="space-y-6">
          <header className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">
              {t("eyebrow")}
            </p>
            <h1 className="text-xl font-bold text-navy">
              {t("currentWeekLabel")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("weekBadge", { week: current_week.week_number })} ·{" "}
              {format.dateTime(new Date(current_week.week_start_date), {
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
              {current_week.goal || t("notAvailable")}
            </p>
          </section>

          <section
            aria-labelledby="cta-guidance"
            className="rounded-xl border border-action/30 bg-action/5 p-4"
          >
            <h2 id="cta-guidance" className="text-sm font-bold text-navy">
              {t("ctaGuidanceTitle")}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("ctaGuidanceBody")}
            </p>
            <button
              type="button"
              onClick={() => setMode("setup")}
              className="mt-3 rounded-lg border border-action/40 px-3 py-2 text-xs font-bold text-action hover:bg-action/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("ctaGuidanceCta")}
            </button>
          </section>

          {/* Action panel: state + one primary action + contextual secondary */}
          <section aria-labelledby="generation-state" className="space-y-3">
            <p
              id="generation-state"
              className="text-sm font-semibold text-navy"
            >
              {t(`generationState.${current_week.generation_state}`)}
            </p>

            {!workspace.editorial_profile && (
              <p className="text-xs text-muted-foreground">
                {t("defaultVoiceHint")}
              </p>
            )}

            {isWeekCompleted && (
              <p
                role="status"
                className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs font-semibold text-primary"
              >
                {t("completedHint")}
              </p>
            )}

            {!current_week.week_plan &&
              !current_week.pack &&
              current_week.primary_action === "plan_week" && (
                <p className="rounded-xl border border-dashed border-border bg-surface/60 p-3 text-xs text-muted-foreground">
                  {t("notPlannedHint")}
                </p>
              )}

            {current_week.week_plan &&
              current_week.primary_action === "generate" && (
                <div className="space-y-3">
                  <p className="rounded-lg border border-dashed border-border bg-surface/60 p-3 text-xs text-muted-foreground">
                    {t("defaultVisualHint")}
                  </p>
                  <p className="text-xs font-semibold text-primary">
                    {t("weekCost", { points: weekCost })}
                  </p>
                </div>
              )}

            {generateBlocked && wallet && (
              <div
                role="alert"
                className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs font-semibold leading-relaxed text-warning"
              >
                <p>
                  {t("insufficientPoints", {
                    points: weekCost,
                    balance: wallet.balance,
                  })}
                </p>
                <Link
                  href="/billing"
                  className="mt-1 inline-block font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  {t("topUpCta")}
                </Link>
              </div>
            )}

            {current_week.primary_action === "regenerate" && (
              <div className="border-s-4 border-danger bg-danger/5 px-4 py-3">
                <h3 className="text-sm font-bold text-navy">
                  {t("recoveryTitle")}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("recoveryBody")}
                </p>
                <p className="mt-2 text-xs font-semibold text-primary">
                  {t("recoveryPlanSafe")}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {current_week.primary_action === "review_pack" &&
              current_week.pack ? (
                <Link
                  href={`/content/packs/${current_week.pack.id}` as never}
                  className={
                    isWeekCompleted
                      ? "rounded-lg border border-primary px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                      : "rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  }
                >
                  {primaryLabel}
                </Link>
              ) : primaryLabel ? (
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  disabled={isMutating}
                  className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
                >
                  {isMutating
                    ? mutatingAction === "generate"
                      ? t("generatingCta")
                      : mutatingAction === "retry"
                        ? t("retryingCta")
                        : mutatingAction === "regenerate"
                          ? t("regeneratingCta")
                        : mutatingAction === "savePlan"
                          ? t("savingPlanCta")
                          : t("planningCta")
                    : primaryActionLabel()}
                </button>
              ) : null}
              {current_week.week_plan?.status === "draft" && (
                <button
                  type="button"
                  onClick={() => void handlePlan(true)}
                  disabled={isMutating}
                  className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
                >
                  {t("replanCta")}
                </button>
              )}
              <button
                type="button"
                onClick={() => setMode("setup")}
                className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {t("configureProfileCta")}
              </button>
              <Link
                href={workspace.view_full_strategy_route as never}
                className="rounded-sm text-xs font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
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
                        cycleId={cycleId}
                        plan={plan}
                        ctaLabel={
                          plan.cta_library_entry_id
                            ? ctaById.get(plan.cta_library_entry_id)?.active
                              ? (ctaById.get(plan.cta_library_entry_id)
                                  ?.label ?? null)
                              : null
                            : null
                        }
                        ctaUnavailable={
                          Boolean(plan.cta_library_entry_id) &&
                          !ctaById.get(plan.cta_library_entry_id ?? "")?.active
                        }
                        mediaCount={
                          plan.selected_media_ids.filter((id) =>
                            readyMediaIds.has(id),
                          ).length
                        }
                        unavailableMediaCount={
                          plan.selected_media_ids.filter(
                            (id) => !readyMediaIds.has(id),
                          ).length
                        }
                        isEditing={editingPlanId === plan.id}
                        onEdit={
                          current_week.week_plan?.status === "draft" &&
                          !isMutating
                            ? () => setEditingPlanId(plan.id)
                            : undefined
                        }
                        onCancelEdit={() => setEditingPlanId(null)}
                        onSave={(changes) => handleSavePlan(plan.id, changes)}
                        ctaEntries={cta_library}
                        mediaEntries={media_library}
                        mediaDisabled={isMutating}
                        onUploadMedia={
                          isWeekCompleted ? undefined : handleUploadMedia
                        }
                        onMediaChange={
                          isWeekCompleted
                            ? undefined
                            : (selectedMediaIds) =>
                                handleSavePlan(
                                  plan.id,
                                  {
                                    purpose: plan.purpose,
                                    intended_audience: plan.intended_audience,
                                    channel: plan.channel,
                                    format: plan.format,
                                    cta_library_entry_id:
                                      plan.cta_library_entry_id,
                                    owner_instructions: plan.owner_instructions,
                                    visual_direction: plan.visual_direction,
                                    selected_media_ids: selectedMediaIds,
                                  },
                                  false,
                                )
                        }
                        availableChannels={
                          workspace.why_this_week.committed_channels
                        }
                        availableFormats={workspace.why_this_week.formats}
                      />
                    </li>
                  ))}
                </ol>
              </section>
            )}

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
                  {workspace.why_this_week.focus || t("notAvailable")}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">
                  {t("outcomeLabel")}
                </dt>
                <dd className="mt-0.5 text-navy">
                  {workspace.why_this_week.expected_outcome ||
                    t("notAvailable")}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">
                  {t("measurementLabel")}
                </dt>
                <dd className="mt-0.5 text-navy">
                  {workspace.why_this_week.measurement_check ||
                    t("notAvailable")}
                </dd>
              </div>
              {workspace.why_this_week.owner_advice.length > 0 && (
                <div>
                  <dt className="font-semibold text-muted-foreground">
                    {t("adviceLabel")}
                  </dt>
                  <dd className="mt-0.5 space-y-1 text-navy">
                    {workspace.why_this_week.owner_advice.map(
                      (advice, index) => (
                        <p key={index}>{advice}</p>
                      ),
                    )}
                  </dd>
                </div>
              )}
              <div>
                <dt className="font-semibold text-muted-foreground">
                  {t("channelsLabel")}
                </dt>
                <dd className="mt-0.5 text-navy">
                  {workspace.why_this_week.committed_channels.length > 0
                    ? workspace.why_this_week.committed_channels
                        .map((channel) => t(`channels.${channel}` as never))
                        .join(" · ")
                    : t("notAvailable")}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-muted-foreground">
                  {t("formatsLabel")}
                </dt>
                <dd className="mt-0.5 text-navy">
                  {workspace.why_this_week.formats.length > 0
                    ? workspace.why_this_week.formats
                        .map((contentFormat) =>
                          t(`formats.${contentFormat}` as never),
                        )
                        .join(" · ")
                    : t("notAvailable")}
                </dd>
              </div>
            </dl>
          </details>

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
                <p className="text-xs text-muted-foreground">
                  {t("historyEmpty")}
                </p>
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
                  {t("nextWeekStatus", {
                    week: next_week.week_number,
                    status: t(`historyStatus.${next_week.status}`),
                  })}
                </p>
              </section>
            )}
          </nav>
        </div>
      </div>
      <div hidden={mode !== "setup"} aria-hidden={mode !== "setup"}>
        <ContentV2Setup
          cycleId={cycleId}
          editorialProfile={workspace.editorial_profile}
          ctaEntries={workspace.cta_library}
          mediaEntries={workspace.media_library}
          onBack={() => setMode("studio")}
          onSaved={() => load()}
        />
      </div>
      <ContentGenerateConfirmDialog
        open={confirmAction !== null}
        cost={weekCost}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action) void handleGenerate(action);
        }}
      />
    </>
  );
}

function WeekSummary({ week }: { week: ContentWeekSummaryV2 }) {
  const t = useTranslations("ContentV2.studio.historyStatus");
  const tStudio = useTranslations("ContentV2.studio");
  const format = useFormatter();
  const summary = (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="text-xs font-bold text-navy">
        {tStudio("weekBadge", { week: week.week_number })}
        {week.week_start_date && (
          <span className="ms-2 font-normal text-muted-foreground">
            {format.dateTime(new Date(week.week_start_date), {
              timeZone: "Africa/Cairo",
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
        {t(week.status)}
      </span>
    </div>
  );

  const isReviewable = ["ready", "completed"].includes(week.status);
  return week.pack_id && isReviewable ? (
    <Link
      href={`/content/packs/${week.pack_id}` as never}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      {summary}
    </Link>
  ) : (
    summary
  );
}

function mutationErrorKey(
  error: unknown,
  fallback: MutationErrorKey,
): MutationErrorKey {
  const candidate = error as { code?: string; status?: number } | null;
  switch (candidate?.code) {
    case "CONTENT_SCHEMA_FAILURE":
    case "CONTENT_V2_REQUIRED":
      return "planInvalid";
    case "CONTENT_CYCLE_PAUSED":
      return "cyclePaused";
    case "CONTENT_CYCLE_COMPLETED":
      return "cycleCompleted";
    case "CONTENT_WEEK_ALREADY_CLAIMED":
      return "weekAlreadyClaimed";
    case "BILLING_INSUFFICIENT_POINTS":
    case "BILLING_ENTITLEMENT_EXHAUSTED":
      return "insufficientPoints";
    default:
      if (candidate?.status === 400) return "planInvalid";
      if (candidate?.status === 409) return "weekAlreadyClaimed";
      if (candidate?.status === 429) return "rateLimited";
      return fallback;
  }
}

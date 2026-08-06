"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  ContentPack,
  ContentWeekContext,
} from "@marketmind/contracts";
import { getCurrentJourney } from "@/lib/api/journey";
import { getStrategy, getStrategyVersions } from "@/lib/api/strategy";
import {
  getContentCycle,
  listContentWeeks,
  updateContentWeekContext,
  generateContentWeek,
  getContentPack,
  retryContentPack,
} from "@/lib/api/content-cycle";
import {
  type ContentWorkspaceState,
  resolveApprovedContentStrategy,
  buildWeekSlots,
  resolveContentPrimaryAction,
} from "../lib/content-cycle-state";
import {
  computeFingerprint,
  getOrCreateIdempotencyKey,
  clearIdempotencyKey,
} from "../lib/content-cycle-idempotency";
import {
  type WeekContextDraft,
  serializeWeekContext,
} from "../lib/content-cycle-form";
import { getWeekStartDate, cairoDateFromStrategyStart } from "../lib/content-cycle-schedule";
import { useContentPackProgress } from "../hooks/use-content-pack-progress";
import { CycleThesisHeader } from "./cycle-thesis-header";
import { ContentWeekLedger } from "./content-week-ledger";
import { ApprovedStrategyHandoff } from "./approved-strategy-handoff";
import { WeekContextForm } from "./week-context-form";
import { ContentGenerationProgress } from "./content-generation-progress";
import { ContentReadiness } from "./content-readiness";

type Props = {
  readonly cycleId: string;
  readonly weekNumber: number;
};

export function ContentCycleWorkspace({ cycleId, weekNumber }: Props) {
  const t = useTranslations("ContentCycle.entry");
  const tErrors = useTranslations("ContentCycle.errors");
  const tActions = useTranslations("ContentCycle.actions");

  const [workspaceState, setWorkspaceState] = useState<ContentWorkspaceState>({
    phase: "loading",
  });
  const [contexts, setContexts] = useState<readonly ContentWeekContext[]>([]);
  const [latestKnownPack, setLatestKnownPack] = useState<ContentPack | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [cycle, weeksRes, journeyRes] = await Promise.all([
        getContentCycle(cycleId),
        listContentWeeks(cycleId),
        getCurrentJourney(),
      ]);

      const journeyCycle = journeyRes.content?.cycle;
      if (journeyCycle && journeyCycle.id !== cycleId) {
        setWorkspaceState({
          phase: "stale_route",
          currentCycleId: journeyCycle.id,
        });
        return;
      }

      // Fetch strategy details
      const [stratApi, versions] = await Promise.all([
        getStrategy(cycle.strategy_id),
        getStrategyVersions(cycle.strategy_id),
      ]);

      const resolution = resolveApprovedContentStrategy(journeyRes, stratApi, versions);
      if ("blocker" in resolution) {
        setWorkspaceState({
          phase: "provenance_blocked",
          reason: resolution.blocker,
        });
        return;
      }

      setContexts(weeksRes.weeks ?? []);

      let pack: ContentPack | null = null;
      const journeyPack = journeyRes.content?.pack;
      if (journeyPack) {
        try {
          pack = await getContentPack(journeyPack.id);
        } catch {
          pack = null;
        }
      }

      setLatestKnownPack(pack);

      setWorkspaceState({
        phase: "ready",
        snapshot: {
          cycle,
          approved: resolution.approved,
          contexts: weeksRes.weeks ?? [],
          selectedWeek: weekNumber,
          latestPack: pack,
          latestPackProgress: [],
        },
      });
    } catch {
      setWorkspaceState({ phase: "load_error", errorKey: "unknown" });
    }
  }, [cycleId, weekNumber]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  // Attach progress polling hook for latest known pack
  const {
    pack: livePack,
    events: liveEvents,
    isPolling,
    errorKey: progressErrorKey,
    refresh: refreshProgress,
  } = useContentPackProgress({
    packId: latestKnownPack?.id ?? null,
    initialPack: latestKnownPack,
    onTerminal: () => {
      // Refresh workspace data when pack reaches terminal state
      void loadData();
    },
  });

  const effectivePack = livePack ?? latestKnownPack;

  const handleSaveContext = async (draft: WeekContextDraft) => {
    if (workspaceState.phase !== "ready" || isMutating) return;

    const snapshot = workspaceState.snapshot;
    const week1StartDate = cairoDateFromStrategyStart(snapshot.approved.brief.start_date);
    const startDateForWeek = getWeekStartDate(week1StartDate, weekNumber);

    const payload = serializeWeekContext(draft, {
      weekNumber,
      weekStartDate: startDateForWeek,
    });

    setIsMutating(true);
    setActionError(null);

    try {
      const updatedContext = await updateContentWeekContext(cycleId, weekNumber, payload);
      setContexts((prev) => {
        const filtered = prev.filter((c) => c.week_number !== weekNumber);
        return [...filtered, updatedContext];
      });
      setActionError(null);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "CONTENT_WEEK_ALREADY_CLAIMED") {
        setActionError(tErrors("weekAlreadyClaimed"));
        await loadData();
      } else {
        setActionError(tErrors("badRequest"));
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleGenerateWeek = async () => {
    if (workspaceState.phase !== "ready" || isMutating) return;

    setIsMutating(true);
    setActionError(null);

    const scope = `content-cycle:generate:${cycleId}:${weekNumber}`;
    const payloadRaw = JSON.stringify({
      content_cycle_id: cycleId,
      week_number: weekNumber,
    });

    const fingerprint = await computeFingerprint(payloadRaw);
    const idempotencyKey = getOrCreateIdempotencyKey(scope, fingerprint);

    try {
      const res = await generateContentWeek(cycleId, weekNumber, {
        content_cycle_id: cycleId,
        week_number: weekNumber,
        idempotency_key: idempotencyKey,
      });

      clearIdempotencyKey(scope);
      setLatestKnownPack(res.content_pack);
      setActionError(null);
    } catch {
      setActionError(tErrors("providerFailure"));
    } finally {
      setIsMutating(false);
    }
  };

  const handleRetryPack = async () => {
    if (!effectivePack || isMutating) return;

    setIsMutating(true);
    setActionError(null);

    try {
      const res = await retryContentPack(effectivePack.id);
      setLatestKnownPack(res.content_pack);
    } catch {
      setActionError(tErrors("retryConflict"));
    } finally {
      setIsMutating(false);
    }
  };

  if (workspaceState.phase === "loading") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  if (workspaceState.phase === "stale_route") {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-4">
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-6 space-y-3 text-warning">
          <h1 className="text-lg font-bold">{t("staleProfileTitle")}</h1>
          <p className="text-xs leading-relaxed">{t("staleProfileBody")}</p>
          <Link
            href="/content"
            className="inline-flex rounded-lg bg-action px-4 py-2 text-xs font-bold text-white shadow-sm"
          >
            {tActions("refresh")}
          </Link>
        </div>
      </div>
    );
  }

  if (workspaceState.phase === "load_error" || workspaceState.phase === "provenance_blocked") {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-center text-danger space-y-3">
        <p className="font-bold">{t("loadError")}</p>
        <button
          type="button"
          onClick={loadData}
          className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white"
        >
          {tActions("refresh")}
        </button>
      </div>
    );
  }

  const { cycle, approved } = workspaceState.snapshot;
  const currentWeekContext = contexts.find((c) => c.week_number === weekNumber) ?? null;
  const isFormValid = Boolean(currentWeekContext);

  const slots = buildWeekSlots(
    cycleId,
    cycle.current_week_number,
    weekNumber,
    contexts,
    effectivePack,
  );

  const primaryAction = resolveContentPrimaryAction({
    cycle,
    selectedWeek: weekNumber,
    hasUnsavedContext: !currentWeekContext,
    latestPack: effectivePack,
    isMutating,
  });

  return (
    <div className="space-y-6">
      <CycleThesisHeader selectedWeek={weekNumber} approved={approved} />

      <ContentWeekLedger slots={slots} />

      {actionError && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <ApprovedStrategyHandoff selectedWeek={weekNumber} approved={approved} />

          <WeekContextForm
            initialContext={currentWeekContext}
            isFrozen={currentWeekContext?.context_source === "system_defaulted"}
            isSubmitting={isMutating}
            onSave={handleSaveContext}
          />

          {effectivePack && effectivePack.week_number === weekNumber && (
            <ContentGenerationProgress
              pack={effectivePack}
              events={liveEvents}
              isPolling={isPolling}
              errorKey={progressErrorKey}
              isRetrying={isMutating}
              onRetry={handleRetryPack}
              onRefresh={refreshProgress}
            />
          )}
        </div>

        <div>
          <ContentReadiness
            approved={approved}
            selectedWeek={weekNumber}
            contextCutoffIso={currentWeekContext?.generation_cutoff_at}
            hasContext={isFormValid}
            isCycleActive={cycle.status === "active"}
            primaryAction={primaryAction}
            isMutating={isMutating}
            onSaveContext={() => {
              // Scroll or focus form
              const formEl = document.querySelector("form");
              formEl?.scrollIntoView({ behavior: "smooth" });
            }}
            onGenerateWeek={handleGenerateWeek}
            onRetry={handleRetryPack}
            onRefresh={loadData}
            packIdForReview={
              effectivePack && ["draft", "partially_approved", "approved"].includes(effectivePack.status)
                ? effectivePack.id
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type {
  CurrentJourneyContentReadiness,
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublishingMode,
  PublishingTargetPublicV1,
} from "@marketmind/contracts";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import {
  approvePublishingIntent,
  cancelPublishingIntent,
  createPublishingIntent,
  dispatchPublishingLocalAction,
  getPublishingExport,
  getPublishingIntent,
  getPublishingJourney,
  listPublishingCandidates,
  listPublishingIntents,
  listPublishingTargets,
  reschedulePublishingIntent,
  retryPublishingIntent,
  schedulePublishingIntent,
  type PublishingExportState,
  type PublishingIntentDetailView,
} from "@/lib/api/publishing";
import { activeIntentForCandidate } from "../lib/publishing-state";
import { ImmutableCandidatePreview } from "./immutable-candidate-preview";
import { PublicationAttemptHistory } from "./publication-attempt-history";
import { PublishingCandidateQueue } from "./publishing-candidate-queue";
import { PublishingDecisionBuilder } from "./publishing-decision-builder";
import { PublicationOutcomePanel } from "./publication-outcome-panel";
import { PublicationReadiness } from "./publication-readiness";
import { PublicationRunway } from "./publication-runway";
import { PublishingBadge } from "./publishing-badge";

type WorkspaceData = {
  readonly journey: Awaited<ReturnType<typeof getPublishingJourney>>;
  readonly candidates: readonly PublicationCandidateSummaryV1[];
  readonly intents: readonly PublicationIntentV1[];
  readonly targets: readonly PublishingTargetPublicV1[];
  readonly detail: PublishingIntentDetailView | null;
  readonly exportState: PublishingExportState | null;
};

type State =
  | { readonly phase: "loading" }
  | { readonly phase: "error" }
  | { readonly phase: "ready"; readonly data: WorkspaceData };

const EMPTY_READINESS: CurrentJourneyContentReadiness = {
  ready: false,
  reason: "no_cycle",
  cycle: null,
  pack: null,
};

export function PublishingWorkspace({
  intentId = null,
}: {
  readonly intentId?: string | null;
}) {
  const t = useTranslations("Publishing");
  const tc = useTranslations("Common");
  const format = useFormatter();
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [selectedWeek, setSelectedWeek] = useState(1);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const load = useCallback(async () => {
    const [journey, candidates, intents, targets] = await Promise.all([
      getPublishingJourney(),
      listPublishingCandidates(),
      listPublishingIntents(),
      listPublishingTargets(),
    ]);
    const detail = intentId ? await getPublishingIntent(intentId) : null;
    const exportState =
      detail?.publication_intent.mode === "manual_export"
        ? await getPublishingExport(detail.publication_intent.intent_id).catch(
            () => null,
          )
        : null;
    return { journey, candidates, intents, targets, detail, exportState };
  }, [intentId]);

  const refresh = useCallback(async () => {
    try {
      const data = await load();
      setState({ phase: "ready", data });
      setNotice(null);
    } catch {
      setState({ phase: "error" });
    }
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((data) => {
        if (cancelled) return;
        setState({ phase: "ready", data });
        const search = new URLSearchParams(window.location.search);
        const weekValue = Number(search.get("week"));
        const requestedWeek =
          Number.isInteger(weekValue) && weekValue >= 1 && weekValue <= 12
            ? weekValue
            : null;
        const requestedCandidateId = search.get("candidate");
        const journeyWeek =
          data.journey.content?.cycle?.current_week ??
          data.candidates[0]?.candidate.strategy_week_number ??
          1;
        const detailCandidate = data.detail?.publication_intent.candidate_id;
        const requestedCandidate = requestedCandidateId
          ? data.candidates.find(
              (candidate) =>
                candidate.candidate.candidate_id === requestedCandidateId,
            )
          : null;
        const initialWeek =
          data.candidates.find(
            (candidate) => candidate.candidate.candidate_id === detailCandidate,
          )?.candidate.strategy_week_number ??
          requestedCandidate?.candidate.strategy_week_number ??
          requestedWeek ??
          journeyWeek;
        const firstCandidate =
          data.candidates.find(
            (candidate) => candidate.candidate.candidate_id === detailCandidate,
          ) ??
          requestedCandidate ??
          data.candidates.find(
            (candidate) =>
              candidate.candidate.strategy_week_number === initialWeek,
          ) ??
          (requestedWeek ? undefined : data.candidates[0]);
        setSelectedWeek(initialWeek);
        setSelectedCandidateId(firstCandidate?.candidate.candidate_id ?? null);
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const data = state.phase === "ready" ? state.data : null;
  const selectedCandidate = useMemo(() => {
    if (!data) return null;
    return (
      data.candidates.find(
        (candidate) => candidate.candidate.candidate_id === selectedCandidateId,
      ) ??
      (data.detail
        ? data.candidates.find(
            (candidate) =>
              candidate.candidate.candidate_id ===
              data.detail?.publication_intent.candidate_id,
          )
        : null) ??
      null
    );
  }, [data, selectedCandidateId]);
  const intent =
    data?.detail?.publication_intent ??
    (selectedCandidate && data
      ? activeIntentForCandidate(selectedCandidate, data.intents)
      : null);

  useEffect(() => {
    if (!intentId || intent?.state !== "dispatching") return;

    let cancelled = false;

    const poll = () => {
      if (
        cancelled ||
        document.visibilityState === "hidden" ||
        refreshInFlight.current
      ) {
        return;
      }

      refreshInFlight.current = true;
      void refresh().finally(() => {
        refreshInFlight.current = false;
      });
    };

    const interval = window.setInterval(poll, 4_000);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [intentId, intent?.state, refresh]);

  const detail = data?.detail ?? null;
  const currentWeek =
    data?.journey.content?.cycle?.current_week ?? selectedWeek;
  const readiness = data?.journey.content ?? EMPTY_READINESS;

  function selectWeek(week: number) {
    setSelectedWeek(week);
    const candidate = data?.candidates.find(
      (item) => item.candidate.strategy_week_number === week,
    );
    setSelectedCandidateId(candidate?.candidate.candidate_id ?? null);
    if (typeof window !== "undefined") {
      replaceSelectionUrl(week, candidate?.candidate.candidate_id ?? null);
    }
  }

  function selectCandidate(candidate: PublicationCandidateSummaryV1) {
    setSelectedCandidateId(candidate.candidate.candidate_id);
    setSelectedWeek(candidate.candidate.strategy_week_number);
    const candidateIntent = activeIntentForCandidate(
      candidate,
      data?.intents ?? [],
    );
    if (candidateIntent) {
      router.push(`/publishing/${candidateIntent.intent_id}`);
      return;
    }
    if (typeof window !== "undefined") {
      replaceSelectionUrl(
        candidate.candidate.strategy_week_number,
        candidate.candidate.candidate_id,
      );
    }
  }

  async function createIntent(mode: PublishingMode) {
    if (!selectedCandidate) return null;
    const created = await createPublishingIntent(
      selectedCandidate.candidate.candidate_id,
      mode,
    );
    if (mode !== "real") {
      try {
        await dispatchPublishingLocalAction(created);
        router.push(`/publishing/${created.intent_id}`);
      } catch (error) {
        // Keep the owner on the selected candidate when the local action
        // fails. Refreshing here exposes the created intent so the user can
        // retry or choose another local action instead of being routed to a
        // blank/stale detail page by a finally block.
        await refresh().catch(() => undefined);
        throw error;
      }
      return created;
    }
    router.push(`/publishing/${created.intent_id}`);
    return created;
  }

  async function scheduleIntent(targetId: string, scheduledLocalAt: string) {
    if (!intent) return;
    if (intent.state === "scheduled") {
      await reschedulePublishingIntent(intent, targetId, scheduledLocalAt);
    } else {
      await schedulePublishingIntent(intent, targetId, scheduledLocalAt);
    }
    await refresh();
  }

  async function approveIntent() {
    if (!intent) return;
    await approvePublishingIntent(intent);
    await refresh();
  }

  async function cancelIntent() {
    if (!intent) return;
    await cancelPublishingIntent(intent);
    await refresh();
  }

  async function dispatchIntent() {
    if (!intent) return;
    await dispatchPublishingLocalAction(intent);
    await refresh();
  }

  async function retryIntent() {
    if (!intent || !detail) return;
    const lastAttempt = detail.attempts.at(-1);
    if (!lastAttempt) return;
    await retryPublishingIntent(intent, lastAttempt.attempt_number);
    await refresh();
  }

  function connectTarget() {
    // Issue #175: the guided Meta connection journey (explain → Meta OAuth →
    // choose accounts → ready) lives on its own page; the workspace never
    // handles an authorization code or token.
    router.push("/publishing/meta/connect");
  }

  if (state.phase === "loading") {
    return (
      <section className="flex min-h-56 items-center justify-center">
        <p className="text-sm text-muted-foreground">{tc("loading")}</p>
      </section>
    );
  }

  if (state.phase === "error" || !data) {
    return (
      <section
        className="grid min-h-56 place-items-center rounded-xl border border-danger/20 bg-danger/5 p-6 text-center"
        role="alert"
      >
        <div className="grid max-w-md gap-3">
          <p className="text-lg font-bold text-navy">{t("error.title")}</p>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("error.body")}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
          >
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
            {t("error.retry")}
          </Button>
        </div>
      </section>
    );
  }

  if (data.candidates.length === 0) {
    return (
      <section className="grid gap-5">
        <PublishingHeader
          week={selectedWeek}
          intentId={intentId}
          format={format}
          t={t}
        />
        <section className="grid gap-4 rounded-xl border border-dashed border-border bg-surface p-7 text-center shadow-elevated">
          <ShieldCheck
            className="mx-auto size-9 text-primary"
            aria-hidden="true"
          />
          <h2 className="text-2xl font-bold text-navy">{t("empty.title")}</h2>
          <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">
            {t("empty.body")}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link
              href="/strategy"
              className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {t("empty.goContent")}
              <ArrowUpRight
                className="ms-2 size-4 rtl:scale-x-[-1]"
                aria-hidden="true"
              />
            </Link>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refresh()}
            >
              <RefreshCw className="me-2 size-4" aria-hidden="true" />
              {t("empty.tryAgain")}
            </Button>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="grid gap-5">
      <PublishingHeader
        week={selectedWeek}
        intentId={intentId}
        format={format}
        t={t}
      />
      <PublicationRunway
        candidates={data.candidates}
        intents={data.intents}
        selectedWeek={selectedWeek}
        currentWeek={currentWeek}
        onSelectWeek={selectWeek}
      />
      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning"
        >
          {notice}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid min-w-0 gap-5">
          <PublishingCandidateQueue
            week={selectedWeek}
            candidates={data.candidates}
            intents={data.intents}
            selectedCandidateId={selectedCandidateId}
            onSelect={selectCandidate}
          />
          <ImmutableCandidatePreview candidate={selectedCandidate} />
          <PublishingDecisionBuilder
            key={`${selectedCandidate?.candidate.candidate_id ?? "none"}-${intent?.intent_id ?? "new"}-${intent?.version ?? 0}`}
            candidate={selectedCandidate}
            intent={intent}
            detail={detail}
            targets={data.targets}
            onCreate={createIntent}
            onSchedule={scheduleIntent}
            onApprove={approveIntent}
            onCancel={cancelIntent}
            onDispatch={dispatchIntent}
            onRetry={retryIntent}
            onRefresh={refresh}
            onConnect={() => connectTarget()}
          />
          {detail ? (
            <PublicationOutcomePanel
              detail={detail}
              exportState={data.exportState}
            />
          ) : null}
          {detail ? <PublicationAttemptHistory detail={detail} /> : null}
        </div>
        <aside className="grid gap-5 lg:sticky lg:top-24">
          <PublicationReadiness
            readiness={readiness}
            candidate={selectedCandidate}
            targets={data.targets}
            intent={intent}
            onConnect={() => connectTarget()}
          />
          <section className="grid gap-3 rounded-xl border border-border bg-surface p-5 shadow-elevated">
            <PublishingBadge tone="neutral">
              {t("header.badge")}
            </PublishingBadge>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("header.subtitle")}
            </p>
            {data.journey.generated_at ? (
              <p className="text-xs text-muted-foreground">
                {t("readiness.lastChecked", {
                  time: format.dateTime(new Date(data.journey.generated_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })}
              </p>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}

function replaceSelectionUrl(week: number, candidateId: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set("week", String(week));
  if (candidateId) url.searchParams.set("candidate", candidateId);
  else url.searchParams.delete("candidate");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function PublishingHeader({
  week,
  intentId,
  format,
  t,
}: {
  readonly week: number;
  readonly intentId: string | null;
  readonly format: ReturnType<typeof useFormatter>;
  readonly t: ReturnType<typeof useTranslations<"Publishing">>;
}) {
  return (
    <header className="relative overflow-hidden rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
      <div className="pointer-events-none absolute -top-24 end-8 size-64 rounded-full bg-primary/30 blur-3xl" />
      <div className="relative grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PublishingBadge tone="good">{t("header.badge")}</PublishingBadge>
          {intentId ? (
            <Link
              href="/publishing"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40"
            >
              {t("header.history")}
              <ArrowUpRight
                className="size-4 rtl:scale-x-[-1]"
                aria-hidden="true"
              />
            </Link>
          ) : null}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h1 className="max-w-3xl text-3xl leading-tight font-bold md:text-5xl">
              {t("header.title")}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
              {t("header.subtitle")}
            </p>
          </div>
          <div className="grid gap-1 text-start text-sm text-white/75 lg:text-end">
            <span className="font-bold text-white">
              {t("header.weekContext", { week })}
            </span>
            <span>{t("header.timezone")}</span>
            <span className="text-xs">
              {format.dateTime(new Date(), { dateStyle: "medium" })}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

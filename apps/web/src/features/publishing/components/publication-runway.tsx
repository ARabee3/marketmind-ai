"use client";

import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
} from "@marketmind/contracts";
import {
  CalendarClock,
  Check,
  CircleAlert,
  FileOutput,
  Minus,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PublishingBadge } from "./publishing-badge";

export type RunwayStatus =
  | "empty"
  | "needsDecision"
  | "scheduled"
  | "published"
  | "exported"
  | "simulation"
  | "failed"
  | "unknown"
  | "cancelled";

export function statusForWeek(
  candidates: readonly PublicationCandidateSummaryV1[],
  intents: readonly PublicationIntentV1[],
): RunwayStatus {
  if (candidates.length === 0) return "empty";
  const activeCandidates = candidates.filter(
    (candidate) => candidate.source_state === "active",
  );
  if (activeCandidates.length === 0) return "cancelled";

  const realIntents = activeCandidates.map((candidate) =>
    intents.find(
      (intent) =>
        intent.candidate_id === candidate.candidate.candidate_id &&
        intent.mode === "real" &&
        intent.state !== "cancelled",
    ),
  );
  if (realIntents.some((intent) => intent?.state === "action_required")) {
    return "unknown";
  }
  if (realIntents.some((intent) => intent?.state === "failed")) return "failed";
  if (realIntents.every((intent) => intent?.state === "succeeded")) {
    return "published";
  }
  if (realIntents.some((intent) => intent?.state === "scheduled")) {
    return "scheduled";
  }
  return "needsDecision";
}

function StatusIcon({ status }: { readonly status: RunwayStatus }) {
  if (status === "scheduled")
    return <CalendarClock className="size-4" aria-hidden="true" />;
  if (status === "published")
    return <Send className="size-4" aria-hidden="true" />;
  if (status === "exported")
    return <FileOutput className="size-4" aria-hidden="true" />;
  if (status === "simulation")
    return <Check className="size-4" aria-hidden="true" />;
  if (status === "failed" || status === "unknown") {
    return <CircleAlert className="size-4" aria-hidden="true" />;
  }
  if (status === "cancelled")
    return <ShieldAlert className="size-4" aria-hidden="true" />;
  if (status === "needsDecision")
    return <Minus className="size-4" aria-hidden="true" />;
  return <span className="size-2 rounded-full bg-border" aria-hidden="true" />;
}

export function PublicationRunway({
  candidates,
  intents,
  selectedWeek,
  currentWeek,
  onSelectWeek,
}: {
  readonly candidates: readonly PublicationCandidateSummaryV1[];
  readonly intents: readonly PublicationIntentV1[];
  readonly selectedWeek: number;
  readonly currentWeek: number;
  readonly onSelectWeek: (week: number) => void;
}) {
  const t = useTranslations("Publishing");
  const weeks = Array.from({ length: 12 }, (_, index) => index + 1);

  return (
    <section
      aria-labelledby="publishing-runway-title"
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t("runway.label")}
          </p>
          <h2
            id="publishing-runway-title"
            className="mt-1 text-lg font-bold text-navy"
          >
            {t("header.weekContext", { week: selectedWeek })}
          </h2>
        </div>
        <PublishingBadge tone="neutral">{t("header.timezone")}</PublishingBadge>
      </div>
      <div className="overflow-x-auto px-3 py-3 md:px-4">
        <ol
          className="flex snap-x snap-proximity gap-2"
          aria-label={t("runway.label")}
        >
          {weeks.map((week) => {
            const weekCandidates = candidates.filter(
              (item) => item.candidate.strategy_week_number === week,
            );
            const status = statusForWeek(weekCandidates, intents);
            const active = selectedWeek === week;
            const isCurrent = currentWeek === week;

            return (
              <li key={week} className="w-[8.25rem] shrink-0 snap-start">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectWeek(week)}
                  className={cn(
                    "flex min-h-28 w-full flex-col justify-between rounded-lg border p-3 text-start outline-none transition-[border-color,background-color,box-shadow] focus-visible:ring-3 focus-visible:ring-action/40",
                    active
                      ? "border-primary bg-soft-teal shadow-sm"
                      : "border-border bg-background hover:border-primary/40 hover:bg-soft-teal/40",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-navy">
                      {t("runway.week", { week })}
                    </span>
                    {isCurrent ? (
                      <span className="text-[10px] font-bold text-action uppercase">
                        {t("runway.current")}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-semibold",
                      status === "failed" || status === "unknown"
                        ? "text-danger"
                        : "text-muted-foreground",
                    )}
                  >
                    <StatusIcon status={status} />
                    {t(`runway.${status}` as never)}
                  </span>
                  {weekCandidates.length > 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      {t("runway.candidateCount", {
                        count: weekCandidates.length,
                      })}
                    </span>
                  ) : (
                    <span aria-hidden="true">&nbsp;</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

"use client";

import { Check, CircleAlert, Clock3, History, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { PublicationAttemptV1 } from "@marketmind/contracts";
import type { PublishingIntentDetailView } from "@/lib/api/publishing";
import { PublishingBadge } from "./publishing-badge";

export function PublicationAttemptHistory({
  detail,
}: {
  readonly detail: PublishingIntentDetailView;
}) {
  const t = useTranslations("Publishing");
  const format = useFormatter();
  const events = [
    {
      id: `created-${detail.publication_intent.intent_id}`,
      label: t("history.created"),
      date: detail.publication_intent.created_at,
      tone: "neutral" as const,
      icon: <Clock3 className="size-4" aria-hidden="true" />,
      version: detail.publication_intent.version,
    },
    ...(detail.approval
      ? [
          {
            id: detail.approval.decision_id,
            label: t("history.approval"),
            date: detail.approval.decided_at,
            tone: "good" as const,
            icon: <ShieldCheck className="size-4" aria-hidden="true" />,
            version: detail.approval.intent_version,
          },
        ]
      : []),
    ...(detail.publication_intent.scheduled_utc
      ? [
          {
            id: `scheduled-${detail.publication_intent.intent_id}`,
            label: t("history.scheduled"),
            date: detail.publication_intent.scheduled_utc,
            tone: "warning" as const,
            icon: <Check className="size-4" aria-hidden="true" />,
            version: detail.publication_intent.version,
          },
        ]
      : []),
    ...detail.attempts.map((attempt) =>
      attemptEvent(
        attempt,
        t("history.attempt", { number: attempt.attempt_number }),
        t("history.unknown"),
      ),
    ),
  ];

  return (
    <section
      aria-labelledby="publishing-history-title"
      className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t("history.title")}
          </p>
          <h2
            id="publishing-history-title"
            className="mt-1 text-xl font-bold text-navy"
          >
            {t("header.history")}
          </h2>
        </div>
        <History className="size-5 text-primary" aria-hidden="true" />
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
      ) : (
        <ol className="grid gap-3">
          {events
            .sort(
              (left, right) => Date.parse(right.date) - Date.parse(left.date),
            )
            .map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-background p-3"
              >
                <span className="mt-0.5 text-primary">{event.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-navy">
                      {event.label}
                    </span>
                    <PublishingBadge tone={event.tone}>
                      {t("history.version", { version: event.version })}
                    </PublishingBadge>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("history.at", {
                      date: format.dateTime(new Date(event.date), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </span>
                </span>
              </li>
            ))}
        </ol>
      )}

      {detail.results.some((result) => result.outcome === "unknown") ? (
        <p className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm leading-6 text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("history.unknown")}
        </p>
      ) : null}
    </section>
  );
}

function attemptEvent(
  attempt: PublicationAttemptV1,
  label: string,
  unknownLabel: string,
) {
  const tone =
    attempt.state === "succeeded"
      ? ("good" as const)
      : attempt.state === "failed" || attempt.state === "unknown"
        ? ("danger" as const)
        : ("warning" as const);
  return {
    id: attempt.attempt_id,
    label: attempt.state === "unknown" ? unknownLabel : label,
    date: attempt.finished_at ?? attempt.started_at ?? attempt.created_at,
    tone,
    icon:
      attempt.state === "unknown" || attempt.state === "failed" ? (
        <CircleAlert className="size-4" aria-hidden="true" />
      ) : (
        <Clock3 className="size-4" aria-hidden="true" />
      ),
    version: attempt.intent_version,
  };
}

"use client";

import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
} from "@marketmind/contracts";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  LockKeyhole,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  activeIntentForCandidate,
  realIntentForCandidate,
} from "../lib/publishing-state";
import { PublishingBadge } from "./publishing-badge";

function candidateTone(candidate: PublicationCandidateSummaryV1) {
  if (candidate.source_state === "active") return "good" as const;
  return "danger" as const;
}

export function PublishingCandidateQueue({
  week,
  candidates,
  intents,
  selectedCandidateId,
  onSelect,
}: {
  readonly week: number;
  readonly candidates: readonly PublicationCandidateSummaryV1[];
  readonly intents: readonly PublicationIntentV1[];
  readonly selectedCandidateId: string | null;
  readonly onSelect: (candidate: PublicationCandidateSummaryV1) => void;
}) {
  const t = useTranslations("Publishing");
  const items = candidates.filter(
    (item) => item.candidate.strategy_week_number === week,
  );

  return (
    <section aria-labelledby="publishing-queue-title" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t("queue.label")}
          </p>
          <h2
            id="publishing-queue-title"
            className="mt-1 text-xl font-bold text-navy"
          >
            {t("queue.weekLabel", { week })}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{items.length}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-5">
          <p className="font-semibold text-navy">{t("queue.emptyTitle")}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("queue.emptyBody")}
          </p>
        </div>
      ) : (
        <ul className="grid min-w-0 gap-3">
          {items.map((item) => {
            const intent = activeIntentForCandidate(item, intents);
            const realIntent = realIntentForCandidate(item, intents);
            const selected =
              selectedCandidateId === item.candidate.candidate_id;
            const readOnly = item.source_state !== "active";
            const channelLabel = t(
              ({
                facebook: "queue.metadata.channel.facebook",
                instagram: "queue.metadata.channel.instagram",
                tiktok: "queue.metadata.channel.tiktok",
                google_business_profile:
                  "queue.metadata.channel.googleBusinessProfile",
              } as const)[item.candidate.target_channel],
            );
            const formatLabel = t(
              ({
                static_image_post: "queue.metadata.format.staticImagePost",
                short_video_script: "queue.metadata.format.shortVideoScript",
                carousel_brief: "queue.metadata.format.carouselBrief",
                text_post: "queue.metadata.format.textPost",
              } as const)[item.candidate.content_format],
            );
            const localeLabel = t(
              ({
                ar: "queue.metadata.locale.arabic",
                en: "queue.metadata.locale.english",
              } as const)[item.candidate.selected_locale],
            );
            return (
              <li key={item.candidate.candidate_id} className="min-w-0">
                <div className="grid min-w-0 gap-2">
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-pressed={selected}
                    className={cn(
                      "grid w-full min-w-0 max-w-full gap-3 overflow-hidden rounded-xl border bg-surface p-4 text-start outline-none transition-[border-color,background-color,box-shadow] focus-visible:ring-3 focus-visible:ring-action/40 md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
                      selected
                        ? "border-primary bg-soft-teal/45 shadow-sm"
                        : "border-border hover:border-primary/45 hover:bg-soft-teal/20",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <PublishingBadge tone={candidateTone(item)}>
                          {readOnly
                            ? t(`queue.${item.source_state}` as never)
                            : realIntent?.state === "succeeded"
                              ? t("queue.published")
                              : intent?.state === "scheduled"
                                ? t("queue.scheduled")
                                : intent
                                  ? t("queue.waiting")
                                  : t("queue.active")}
                        </PublishingBadge>
                        {selected ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                            <Check className="size-3.5" aria-hidden="true" />
                            {t("queue.selected")}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-2 line-clamp-2 break-words text-sm leading-6 font-bold text-navy md:line-clamp-1">
                        {item.candidate.caption}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{channelLabel}</span>
                        <span>{formatLabel}</span>
                        <span>{localeLabel}</span>
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-3 text-sm font-semibold text-primary md:justify-end">
                      {readOnly ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
                          <ShieldAlert className="size-4" aria-hidden="true" />
                          {t("preview.body")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {t("queue.choose")}
                          <ArrowUpRight
                            className="size-4 rtl:scale-x-[-1]"
                            aria-hidden="true"
                          />
                        </span>
                      )}
                      {readOnly ? (
                        <LockKeyhole
                          className="size-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </button>
                  {realIntent?.published_post_url ? (
                    <a
                      href={realIntent.published_post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ms-4 inline-flex min-h-8 w-fit items-center gap-1.5 justify-self-start rounded-md px-2 text-xs font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:ring-2 focus-visible:ring-action"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      {t("queue.viewPublishedPost")}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

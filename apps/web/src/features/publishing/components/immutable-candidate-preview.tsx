/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { Clipboard, ImageOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { PublicationCandidateSummaryV1 } from "@marketmind/contracts";
import { Button } from "@/components/ui/button";
import { fetchPublishingAsset } from "@/lib/api/publishing";
import { PublishingBadge } from "./publishing-badge";

export function ImmutableCandidatePreview({
  candidate,
}: {
  readonly candidate: PublicationCandidateSummaryV1 | null;
}) {
  const t = useTranslations("Publishing");
  const format = useFormatter();
  const [copied, setCopied] = useState(false);

  const payload = candidate?.candidate ?? null;
  const asset = payload?.assets[0] ?? null;

  async function copyChecksum() {
    if (!payload) return;
    await navigator.clipboard?.writeText(payload.candidate_checksum);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (!payload) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-surface p-5">
        <p className="text-sm font-semibold text-muted-foreground">
          {t("queue.emptyTitle")}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="immutable-candidate-title"
      className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-elevated md:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PublishingBadge tone="good">
            <LockKeyhole className="me-1 size-3" aria-hidden="true" />
            {t("preview.eyebrow")}
          </PublishingBadge>
          <h2
            id="immutable-candidate-title"
            className="mt-3 text-2xl font-bold text-navy"
          >
            {t("preview.title")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("preview.body")}
          </p>
        </div>
        <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="grid gap-4">
          <dl className="grid gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
            <Fact label={t("preview.channel")} value={payload.target_channel} />
            <Fact label={t("preview.format")} value={payload.content_format} />
            <Fact label={t("preview.locale")} value={payload.selected_locale} />
            <Fact
              label={t("preview.sourceWeek")}
              value={String(payload.strategy_week_number)}
            />
            <Fact
              label={t("preview.contentVersion")}
              value={`v${payload.content_item_version}`}
            />
            <Fact
              label={t("preview.window")}
              value={`${format.dateTime(new Date(payload.recommended_publish_window.starts_at), { dateStyle: "medium", timeStyle: "short" })} – ${format.dateTime(new Date(payload.recommended_publish_window.ends_at), { timeStyle: "short" })}`}
            />
          </dl>

          <div className="grid gap-3">
            <CopyBlock label={t("preview.caption")} value={payload.caption} />
            <CopyBlock
              label={t("preview.cta")}
              value={payload.cta ?? t("preview.noCta")}
            />
            <CopyBlock
              label={t("preview.hashtags")}
              value={payload.hashtags.join(" ")}
            />
            <CopyBlock label={t("preview.altText")} value={payload.alt_text} />
          </div>
        </div>

        <div className="grid content-start gap-3">
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <CandidateAsset
              key={asset?.asset_id ?? "empty"}
              asset={asset}
              alt={payload.alt_text}
              unavailableLabel={t("preview.assetUnavailable")}
              readyLabel={t("preview.asset")}
            />
          </div>
          <p className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
            {t("preview.asset")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground">
            {t("preview.checksum")}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-navy">
            {payload.candidate_checksum}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyChecksum()}
        >
          <Clipboard className="me-2 size-4" aria-hidden="true" />
          {copied ? t("preview.copied") : t("preview.copyChecksum")}
        </Button>
      </div>
    </section>
  );
}

function CandidateAsset({
  asset,
  alt,
  unavailableLabel,
  readyLabel,
}: {
  readonly asset:
    | PublicationCandidateSummaryV1["candidate"]["assets"][number]
    | null;
  readonly alt: string;
  readonly unavailableLabel: string;
  readonly readyLabel: string;
}) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [assetError, setAssetError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let nextUrl: string | null = null;
    if (!asset || !asset.mime_type.startsWith("image/")) return;

    void fetchPublishingAsset(asset.asset_id)
      .then((blob) => {
        if (disposed) return;
        nextUrl = URL.createObjectURL(blob);
        setAssetUrl(nextUrl);
      })
      .catch(() => {
        if (!disposed) setAssetError(true);
      });

    return () => {
      disposed = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [asset]);

  if (assetUrl) {
    // The URL is a short-lived object URL created after an authenticated Blob
    // request; candidate storage keys never reach the DOM.
    return (
      <img
        src={assetUrl}
        alt={alt}
        width={640}
        height={640}
        loading="lazy"
        className="aspect-square w-full object-cover"
      />
    );
  }

  return (
    <div className="grid aspect-square place-items-center p-5 text-center">
      <ImageOff className="size-7 text-muted-foreground" aria-hidden="true" />
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {assetError || !asset ? unavailableLabel : readyLabel}
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-bold text-navy">{value}</dd>
    </div>
  );
}

function CopyBlock({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-navy">
        {value}
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  FileArchive,
  RefreshCw,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  downloadPublishingExport,
  type PublishingExportState,
  type PublishingIntentDetailView,
} from "@/lib/api/publishing";
import { latestResult } from "../lib/publishing-state";
import { PublishingBadge } from "./publishing-badge";

export function PublicationOutcomePanel({
  detail,
  exportState,
  onRefresh,
}: {
  readonly detail: PublishingIntentDetailView;
  readonly exportState: PublishingExportState | null;
  readonly onRefresh: () => void;
}) {
  const t = useTranslations("Publishing");
  const format = useFormatter();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const result = latestResult(detail);
  const intent = detail.publication_intent;

  async function downloadArchive() {
    setDownloading(true);
    setDownloadError(false);
    try {
      const blob = await downloadPublishingExport(intent.intent_id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `marketmind-export-${intent.intent_id}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  if (!result) {
    return (
      <section className="grid gap-3 rounded-xl border border-dashed border-border bg-surface p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <CircleAlert className="size-4" aria-hidden="true" />
          {t("outcome.notAvailable")}
        </div>
        {intent.state === "dispatching" ? (
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
            {t("decision.refresh")}
          </Button>
        ) : null}
      </section>
    );
  }

  const outcome =
    result?.outcome ??
    (intent.mode === "manual_export"
      ? "exported"
      : intent.mode === "simulation"
        ? "simulated"
        : "failed");
  const isGood =
    outcome === "published" ||
    outcome === "exported" ||
    outcome === "simulated";
  const label =
    outcome === "published"
      ? t("outcome.published", {
          target: detail.target?.display_name ?? t("target.providerMeta"),
        })
      : outcome === "exported"
        ? t("outcome.exported")
        : outcome === "simulated"
          ? t("outcome.simulated")
          : outcome === "unknown"
            ? t("outcome.unknown")
            : outcome === "cancelled"
              ? t("outcome.cancelled")
              : t("outcome.failed");

  return (
    <section
      aria-labelledby="publishing-outcome-title"
      className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t("outcome.title")}
          </p>
          <h2
            id="publishing-outcome-title"
            className="mt-1 text-xl font-bold text-navy"
          >
            {label}
          </h2>
          {result ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {format.dateTime(new Date(result.occurred_at), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          ) : null}
        </div>
        <PublishingBadge
          tone={
            isGood
              ? "good"
              : outcome === "unknown" || outcome === "failed"
                ? "danger"
                : "neutral"
          }
        >
          {outcome === "simulated"
            ? t("mode.simulationLabel")
            : outcome === "published"
              ? t("mode.realLabel")
              : outcome === "exported"
                ? t("mode.exportLabel")
                : outcome === "unknown"
                  ? t("outcome.unknown")
                  : outcome === "cancelled"
                    ? t("outcome.cancelled")
                    : t("outcome.failed")}
        </PublishingBadge>
      </div>

      {outcome === "unknown" ? (
        <div className="rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm leading-6 text-danger">
          {t("decision.unknownConsequence")}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {result?.remote_url ? (
          <a
            href={result.remote_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <ExternalLink className="me-2 size-4" aria-hidden="true" />
            {t("outcome.remoteLink")}
          </a>
        ) : null}
        {outcome === "exported" && exportState?.status === "ready" ? (
          <Button
            type="button"
            onClick={() => void downloadArchive()}
            disabled={downloading}
          >
            <Download className="me-2 size-4" aria-hidden="true" />
            {t("outcome.download")}
          </Button>
        ) : null}
      </div>

      {intent.mode === "manual_export" &&
      (!exportState || exportState.status === "pending") ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm leading-6 text-warning">
          <FileArchive className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("outcome.pendingExport")}
        </div>
      ) : null}

      {downloadError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm leading-6 text-danger"
        >
          {t("outcome.downloadError")}
        </p>
      ) : null}

      {exportState?.status === "ready" && exportState.manifest ? (
        <details className="rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer text-sm font-semibold text-navy">
            {t("outcome.manifest")}
          </summary>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <Fact
              label={t("outcome.artifact")}
              value={exportState.artifactId}
            />
            <Fact
              label={t("outcome.checksum")}
              value={exportState.checksum ?? t("schedule.notConfirmed")}
            />
            <Fact
              label={t("outcome.manifest")}
              value={exportState.manifest.label}
            />
            <Fact
              label={t("outcome.generated")}
              value={exportState.manifest.generated_at}
            />
          </dl>
        </details>
      ) : null}

      {isGood ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
          {t("outcome.title")}
        </div>
      ) : null}
    </section>
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
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-navy">{value}</dd>
    </div>
  );
}

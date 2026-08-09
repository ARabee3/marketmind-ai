"use client";

import type {
  CurrentJourneyContentReadiness,
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublishingTargetPublicV1,
} from "@marketmind/contracts";
import { Check, CircleAlert, Link2, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PublishingBadge } from "./publishing-badge";

export function PublicationReadiness({
  readiness,
  candidate,
  targets,
  intent,
  onConnect,
  onVerify,
}: {
  readonly readiness: CurrentJourneyContentReadiness | null;
  readonly candidate: PublicationCandidateSummaryV1 | null;
  readonly targets: readonly PublishingTargetPublicV1[];
  readonly intent: PublicationIntentV1 | null;
  readonly onConnect: () => void;
  readonly onVerify: (target: PublishingTargetPublicV1) => void;
}) {
  const t = useTranslations("Publishing");
  const format = useFormatter();
  const connectedTarget = targets.find(
    (target) =>
      target.connection_state === "connected" &&
      target.capabilities.includes("static_image"),
  );
  const hasApproval = Boolean(intent?.approved_decision_id);
  const needsTarget = !intent || intent.mode === "real";
  const targetReady = !needsTarget || Boolean(connectedTarget);
  const approvalLabel = intent
    ? intent.mode === "real"
      ? hasApproval
        ? t("readiness.approval")
        : t("readiness.approvalMissing")
      : t("readiness.localAction")
    : t("readiness.noTarget");
  const rows = [
    {
      ok: Boolean(candidate && candidate.source_state === "active"),
      label: t(
        candidate ? "readiness.candidate" : "readiness.candidateMissing",
      ),
    },
    {
      ok: readiness?.ready === true,
      label: t(
        readiness?.ready ? "readiness.content" : "readiness.contentMissing",
      ),
    },
    {
      ok: targetReady,
      label: t(
        connectedTarget
          ? "readiness.target"
          : needsTarget
            ? "readiness.targetMissing"
            : "readiness.noTarget",
      ),
    },
    {
      ok: Boolean(intent?.mode !== "real" || hasApproval),
      label: approvalLabel,
    },
  ];
  const allReady = rows.every((row) => row.ok);

  return (
    <section
      aria-labelledby="publishing-readiness-title"
      className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-elevated"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t("readiness.title")}
          </p>
          <h2
            id="publishing-readiness-title"
            className="mt-1 text-xl font-bold text-navy"
          >
            {t(allReady ? "readiness.ready" : "readiness.needsAttention")}
          </h2>
        </div>
        <PublishingBadge tone={allReady ? "good" : "warning"}>
          {allReady ? t("readiness.readyLabel") : t("readiness.checkLabel")}
        </PublishingBadge>
      </div>

      <ul className="grid gap-3">
        {rows.map((row) => (
          <li key={row.label} className="flex items-start gap-2 text-sm">
            {row.ok ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : (
              <CircleAlert
                className="mt-0.5 size-4 shrink-0 text-warning"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(row.ok ? "text-navy" : "text-muted-foreground")}
            >
              {row.label}
            </span>
          </li>
        ))}
      </ul>

      <div className="grid gap-2 border-t border-border pt-4">
        {connectedTarget ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-soft-teal/50 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-navy">
                {connectedTarget.display_name}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {connectedTarget.last_verified_at
                  ? t("target.lastVerified", {
                      date: format.dateTime(
                        new Date(connectedTarget.last_verified_at),
                        { dateStyle: "medium" },
                      ),
                    })
                  : t("target.connected")}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onVerify(connectedTarget)}
            >
              <RefreshCw className="me-1.5 size-3.5" aria-hidden="true" />
              {t("target.verify")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              {t("target.noConnected")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConnect}
            >
              <Link2 className="me-2 size-4" aria-hidden="true" />
              {t("target.connect")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

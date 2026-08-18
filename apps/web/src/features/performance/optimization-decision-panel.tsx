"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { OptimizationProposalWorkspaceV1 } from "@marketmind/contracts";
import { Check, Info, LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type OptimizationDecisionAction = "approve" | "dismiss";

export function OptimizationDecisionPanel({
  workspaces,
  loading,
  error,
  decidingProposalId,
  onDecide,
}: {
  readonly workspaces: readonly OptimizationProposalWorkspaceV1[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly decidingProposalId: string | null;
  readonly onDecide: (
    workspace: OptimizationProposalWorkspaceV1,
    action: OptimizationDecisionAction,
  ) => void;
}) {
  const t = useTranslations("Performance");

  if (loading) {
    return (
      <section
        className="grid gap-3 rounded-xl border border-border bg-surface p-5 shadow-elevated"
        aria-busy="true"
        aria-label={t("optimization.loading")}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-navy">
          <LoaderCircle
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          {t("optimization.loading")}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="grid gap-2 rounded-xl border border-warning/30 bg-warning/10 p-5 text-sm"
        role="status"
      >
        <p className="font-semibold text-warning">
          {t("optimization.loadFailed")}
        </p>
        <p className="leading-6 text-muted-foreground">
          {t("optimization.loadFailedBody")}
        </p>
      </section>
    );
  }

  if (workspaces.length === 0) return null;

  return (
    <section className="grid gap-5" aria-labelledby="optimization-heading">
      <div className="grid gap-2">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("optimization.eyebrow")}
        </p>
        <h2 id="optimization-heading" className="text-2xl font-bold text-navy">
          {t("optimization.title")}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {t("optimization.subtitle")}
        </p>
      </div>

      <div className="grid gap-4">
        {workspaces.map((workspace) => (
          <OptimizationProposalCard
            key={workspace.proposal.proposal_id}
            workspace={workspace}
            deciding={decidingProposalId === workspace.proposal.proposal_id}
            onDecide={onDecide}
          />
        ))}
      </div>
    </section>
  );
}

function OptimizationProposalCard({
  workspace,
  deciding,
  onDecide,
}: {
  readonly workspace: OptimizationProposalWorkspaceV1;
  readonly deciding: boolean;
  readonly onDecide: (
    workspace: OptimizationProposalWorkspaceV1,
    action: OptimizationDecisionAction,
  ) => void;
}) {
  const t = useTranslations("Performance");
  const formatter = useFormatter();
  const { proposal } = workspace;
  const terminal = workspace.state !== "PENDING_OWNER_DECISION";

  return (
    <article className="grid gap-5 rounded-xl border border-border bg-surface p-5 shadow-elevated md:p-6">
      <header className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-navy">{proposal.summary}</h3>
            <Badge variant={terminal ? "default" : "owner"}>
              {t(`optimization.states.${workspace.state}`)}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            {proposal.rationale}
          </p>
        </div>
        <div className="grid gap-1 text-xs text-muted-foreground md:justify-items-end">
          <span>{t("optimization.format")}</span>
          <span className="font-semibold text-navy">
            {t(`optimization.formats.${proposal.format_cohort}`)}
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <section
          className="grid gap-3"
          aria-labelledby={`optimization-evidence-${proposal.proposal_id}`}
        >
          <div className="flex items-start gap-2">
            <Info
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="grid gap-1">
              <h4
                id={`optimization-evidence-${proposal.proposal_id}`}
                className="font-semibold text-navy"
              >
                {t("optimization.evidenceTitle")}
              </h4>
              <p className="break-all font-mono text-xs leading-5 text-muted-foreground">
                {t("optimization.evidenceChecksum", {
                  checksum: proposal.evidence_checksum,
                })}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">
                {t("optimization.evidenceTable")}
              </caption>
              <thead className="bg-muted/40">
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="px-3 py-2 text-start text-xs font-semibold text-muted-foreground"
                  >
                    {t("optimization.metric")}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-end text-xs font-semibold text-muted-foreground"
                  >
                    {t("optimization.baseline")}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-end text-xs font-semibold text-muted-foreground"
                  >
                    {t("optimization.best")}
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-end text-xs font-semibold text-muted-foreground"
                  >
                    {t("optimization.delta")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {proposal.deterministic_comparison.map((comparison) => (
                  <tr
                    key={comparison.metric}
                    className="border-b border-border last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="px-3 py-2 text-start font-semibold text-navy"
                    >
                      {t(`optimization.metrics.${comparison.metric}`)}
                    </th>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatter.number(comparison.baseline_median, {
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {formatter.number(comparison.best_value, {
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums">
                      {comparison.delta_percent === null
                        ? t("optimization.notAvailable")
                        : `${formatter.number(comparison.delta_percent, { maximumFractionDigits: 1 })}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="rounded-lg border border-border bg-background p-3">
            <summary className="cursor-pointer text-sm font-semibold text-navy">
              {t("optimization.snapshotsTitle", {
                count: proposal.basis_snapshot_ids.length,
              })}
            </summary>
            <ul className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground">
              {proposal.basis_snapshot_ids.map((snapshotId) => (
                <li key={snapshotId} className="break-all font-mono">
                  {snapshotId}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <div className="grid content-start gap-3">
          <div className="grid gap-1 rounded-lg border border-warning/30 bg-warning/10 p-3">
            <h4 className="text-sm font-semibold text-warning">
              {t("optimization.uncertaintyTitle")}
            </h4>
            <p className="text-sm leading-6 text-muted-foreground">
              {proposal.uncertainty}
            </p>
          </div>
          <div className="grid gap-1 rounded-lg border border-border bg-background p-3">
            <h4 className="text-sm font-semibold text-navy">
              {t("optimization.instructionTitle")}
            </h4>
            <p className="text-sm leading-6 text-muted-foreground">
              {proposal.instruction}
            </p>
          </div>
          <div className="grid gap-1 rounded-lg border border-border bg-background p-3">
            <h4 className="text-sm font-semibold text-navy">
              {t("optimization.eligibleWeekTitle")}
            </h4>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("optimization.eligibleWeekBody", {
                format: t(`optimization.formats.${proposal.format_cohort}`),
              })}
            </p>
          </div>
        </div>
      </div>

      <details className="rounded-lg border border-border bg-background p-3">
        <summary className="cursor-pointer text-sm font-semibold text-navy">
          {t("optimization.unchangedTitle")}
        </summary>
        <ul className="mt-3 grid gap-2 ps-5 text-sm leading-6 text-muted-foreground">
          {(
            [
              "strategy",
              "topic",
              "purpose",
              "audience",
              "channel",
              "format",
              "locale",
              "media",
              "post_count",
              "schedule",
              "publishing",
            ] as const
          ).map((key) => (
            <li key={key} className="list-disc">
              {t(`optimization.unchanged.${key}`)}
            </li>
          ))}
        </ul>
      </details>

      {terminal ? (
        <p className="text-sm font-semibold text-muted-foreground">
          {workspace.state === "CONSUMED"
            ? t("optimization.consumedBody")
            : t("optimization.terminalBody")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(workspace, "approve")}
          >
            <Check className="size-4" aria-hidden="true" />
            {t("optimization.approve")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={deciding}
            onClick={() => onDecide(workspace, "dismiss")}
          >
            <X className="size-4" aria-hidden="true" />
            {t("optimization.dismiss")}
          </Button>
          {deciding ? (
            <span className="text-sm text-muted-foreground" role="status">
              {t("optimization.saving")}
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

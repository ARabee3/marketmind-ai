"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  CalendarClock,
  Check,
  CircleAlert,
  FileOutput,
  Link2,
  Play,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type {
  PublicationCandidateSummaryV1,
  PublicationIntentV1,
  PublishingMode,
  PublishingTargetPublicV1,
} from "@marketmind/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublishingIntentDetailView } from "@/lib/api/publishing";
import {
  canRetryIntent,
  latestAttempt,
  latestResult,
  localCairoToUtc,
  toDateTimeLocal,
} from "../lib/publishing-state";
import { PublishingBadge } from "./publishing-badge";

type Action =
  | "create"
  | "schedule"
  | "approve"
  | "cancel"
  | "dispatch"
  | "retry"
  | "refresh"
  | null;

export function PublishingDecisionBuilder({
  candidate,
  intent,
  detail,
  targets,
  onCreate,
  onSchedule,
  onApprove,
  onCancel,
  onDispatch,
  onRetry,
  onRefresh,
  onConnect,
}: {
  readonly candidate: PublicationCandidateSummaryV1 | null;
  readonly intent: PublicationIntentV1 | null;
  readonly detail: PublishingIntentDetailView | null;
  readonly targets: readonly PublishingTargetPublicV1[];
  readonly onCreate: (
    mode: PublishingMode,
  ) => Promise<PublicationIntentV1 | null>;
  readonly onSchedule: (
    targetId: string,
    scheduledLocalAt: string,
  ) => Promise<void>;
  readonly onApprove: () => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onDispatch: () => Promise<void>;
  readonly onRetry: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onConnect: () => void;
}) {
  const t = useTranslations("Publishing");
  const format = useFormatter();
  const [mode, setMode] = useState<PublishingMode | null>(intent?.mode ?? null);
  const [targetId, setTargetId] = useState(intent?.target_id ?? "");
  const [scheduleValue, setScheduleValue] = useState(
    toDateTimeLocal(intent?.scheduled_local ?? null),
  );
  const [action, setAction] = useState<Action>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const connectedTargets = targets.filter(
    (target) =>
      target.connection_state === "connected" &&
      target.capabilities.includes("static_image"),
  );
  const selectedTarget =
    targets.find((target) => target.target_id === targetId) ?? null;
  const lastResult = latestResult(detail);
  const lastAttempt = latestAttempt(detail);
  const readOnly = candidate?.source_state !== "active";
  const realDisabled = connectedTargets.length === 0;
  const scheduleChanged = Boolean(
    intent &&
    (targetId !== (intent.target_id ?? "") ||
      scheduleValue !== toDateTimeLocal(intent.scheduled_local)),
  );
  const approvalReady = Boolean(
    intent &&
    intent.mode === "real" &&
    intent.target_id &&
    intent.scheduled_local &&
    intent.scheduled_utc &&
    connectedTargets.some((target) => target.target_id === intent.target_id) &&
    !scheduleChanged,
  );

  async function run(
    nextAction: Exclude<Action, null>,
    callback: () => Promise<void>,
  ) {
    setAction(nextAction);
    setLocalError(null);
    try {
      await callback();
    } catch {
      setLocalError(t("error.unknown"));
    } finally {
      setAction(null);
    }
  }

  async function create(modeToCreate: PublishingMode) {
    await run("create", async () => {
      await onCreate(modeToCreate);
    });
  }

  async function saveSchedule() {
    const utc = localCairoToUtc(scheduleValue);
    if (!targetId || !utc || new Date(utc).getTime() <= Date.now()) {
      setLocalError(t("schedule.invalid"));
      return;
    }
    await run("schedule", () => onSchedule(targetId, `${scheduleValue}:00`));
  }

  async function approve() {
    setDialogOpen(false);
    await run("approve", onApprove);
  }

  function openApprovalDialog() {
    if (
      !intent?.scheduled_utc ||
      new Date(intent.scheduled_utc).getTime() <= Date.now()
    ) {
      setLocalError(t("schedule.invalid"));
      return;
    }
    setDialogOpen(true);
  }

  if (!candidate) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-surface p-5">
        <p className="text-sm font-semibold text-muted-foreground">
          {t("decision.noAction")}
        </p>
      </section>
    );
  }

  if (readOnly) {
    return (
      <section className="grid gap-3 rounded-xl border border-danger/20 bg-danger/5 p-5">
        <div className="flex items-center gap-2 text-sm font-bold text-danger">
          <CircleAlert className="size-4" aria-hidden="true" />
          {t("queue.revoked")}
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("preview.body")}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="publishing-decision-title"
      className="grid gap-5 rounded-xl border border-border bg-surface p-5 shadow-elevated md:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t("decision.label")}
          </p>
          <h2
            id="publishing-decision-title"
            className="mt-1 text-xl font-bold text-navy"
          >
            {t("decision.next")}
          </h2>
        </div>
        {intent ? (
          <PublishingBadge
            tone={
              intent.state === "failed" || intent.state === "action_required"
                ? "danger"
                : "neutral"
            }
          >
            {intentStateLabel(intent.state, t)}
          </PublishingBadge>
        ) : null}
      </header>

      {!intent ? (
        <div className="grid gap-4">
          <fieldset className="grid gap-3">
            <legend className="text-sm font-bold text-navy">
              {t("mode.label")}
            </legend>
            <div className="grid gap-2 md:grid-cols-3">
              <ModeChoice
                mode="real"
                value={mode}
                disabled={realDisabled}
                onChange={setMode}
                title={t("mode.real")}
                description={
                  realDisabled
                    ? t("mode.realUnavailable")
                    : t("mode.realDescription")
                }
                icon={<Send className="size-4" aria-hidden="true" />}
              />
              <ModeChoice
                mode="manual_export"
                value={mode}
                onChange={setMode}
                title={t("mode.export")}
                description={t("mode.exportDescription")}
                icon={<FileOutput className="size-4" aria-hidden="true" />}
              />
              <ModeChoice
                mode="simulation"
                value={mode}
                onChange={setMode}
                title={t("mode.simulation")}
                description={t("mode.simulationDescription")}
                icon={<Play className="size-4" aria-hidden="true" />}
              />
            </div>
          </fieldset>

          {localError ? <ErrorLine>{localError}</ErrorLine> : null}

          {mode ? (
            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                aria-busy={action === "create"}
                disabled={action !== null || (mode === "real" && realDisabled)}
                onClick={() => void create(mode)}
              >
                {action === "create" ? (
                  <RefreshCw
                    className="me-2 size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : mode === "real" ? (
                  <Send className="me-2 size-4" aria-hidden="true" />
                ) : mode === "manual_export" ? (
                  <FileOutput className="me-2 size-4" aria-hidden="true" />
                ) : (
                  <Play className="me-2 size-4" aria-hidden="true" />
                )}
                <span aria-live="polite">
                  {action === "create"
                    ? t("decision.working")
                    : mode === "real"
                      ? t("decision.createReal")
                      : mode === "manual_export"
                        ? t("decision.createExport")
                        : t("decision.runSimulation")}
                </span>
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ExistingIntentActions
          intent={intent}
          selectedTarget={selectedTarget}
          targets={connectedTargets}
          targetId={targetId}
          scheduleValue={scheduleValue}
          scheduleChanged={scheduleChanged}
          approvalReady={approvalReady}
          action={action}
          localError={localError}
          onTargetChange={setTargetId}
          onScheduleChange={setScheduleValue}
          onSaveSchedule={() => void saveSchedule()}
          onApprove={openApprovalDialog}
          onCancel={() => {
            setLocalError(null);
            setCancelDialogOpen(true);
          }}
          onDispatch={() => void run("dispatch", onDispatch)}
          onRetry={() => void run("retry", onRetry)}
          onRefresh={() => void run("refresh", onRefresh)}
          onConnect={onConnect}
          t={t}
          format={format}
          canRetry={canRetryIntent(intent, detail)}
          lastResult={lastResult}
          lastAttempt={lastAttempt}
        />
      )}

      <ApprovalDialog
        open={dialogOpen}
        pending={action === "approve"}
        intent={intent}
        candidate={candidate}
        target={selectedTarget}
        scheduleValue={scheduleValue}
        onOpenChange={setDialogOpen}
        onConfirm={() => void approve()}
        t={t}
      />
      <CancellationDialog
        open={cancelDialogOpen}
        pending={action === "cancel"}
        error={localError}
        intent={intent}
        candidate={candidate}
        onOpenChange={setCancelDialogOpen}
        onConfirm={() =>
          void run("cancel", async () => {
            await onCancel();
            setCancelDialogOpen(false);
          })
        }
        t={t}
      />
    </section>
  );
}

function ModeChoice({
  mode,
  value,
  disabled,
  onChange,
  title,
  description,
  icon,
}: {
  readonly mode: PublishingMode;
  readonly value: PublishingMode | null;
  readonly disabled?: boolean;
  readonly onChange: (mode: PublishingMode) => void;
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
}) {
  return (
    <label
      className={`grid gap-2 rounded-lg border p-3 text-start transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40 ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"} ${value === mode ? "border-primary bg-soft-teal/50" : "border-border bg-background hover:border-primary/40"}`}
    >
      <input
        type="radio"
        name="publishing-mode"
        value={mode}
        checked={value === mode}
        disabled={disabled}
        onChange={() => onChange(mode)}
        className="sr-only"
      />
      <span className="flex items-center gap-2 text-sm font-bold text-navy">
        {icon}
        {title}
      </span>
      <span className="text-xs leading-5 text-muted-foreground">
        {description}
      </span>
    </label>
  );
}

function ExistingIntentActions({
  intent,
  selectedTarget,
  targets,
  targetId,
  scheduleValue,
  scheduleChanged,
  approvalReady,
  action,
  localError,
  onTargetChange,
  onScheduleChange,
  onSaveSchedule,
  onApprove,
  onCancel,
  onDispatch,
  onRetry,
  onRefresh,
  onConnect,
  t,
  format,
  canRetry,
  lastResult,
  lastAttempt,
}: {
  readonly intent: PublicationIntentV1;
  readonly selectedTarget: PublishingTargetPublicV1 | null;
  readonly targets: readonly PublishingTargetPublicV1[];
  readonly targetId: string;
  readonly scheduleValue: string;
  readonly scheduleChanged: boolean;
  readonly approvalReady: boolean;
  readonly action: Action;
  readonly localError: string | null;
  readonly onTargetChange: (value: string) => void;
  readonly onScheduleChange: (value: string) => void;
  readonly onSaveSchedule: () => void;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly onDispatch: () => void;
  readonly onRetry: () => void;
  readonly onRefresh: () => void;
  readonly onConnect: () => void;
  readonly t: ReturnType<typeof useTranslations<"Publishing">>;
  readonly format: ReturnType<typeof useFormatter>;
  readonly canRetry: boolean;
  readonly lastResult: ReturnType<typeof latestResult>;
  readonly lastAttempt: ReturnType<typeof latestAttempt>;
}) {
  const isReal = intent.mode === "real";
  const isBusy = action !== null;
  const canSchedule =
    isReal &&
    ["draft", "awaiting_approval", "scheduled"].includes(intent.state);
  const showApproval = isReal && intent.state === "awaiting_approval";
  const showDispatch = !isReal && intent.state === "draft";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3">
        <PublishingBadge tone="neutral">
          {modeLabel(intent.mode, t)}
        </PublishingBadge>
        <p className="text-sm text-muted-foreground">{t("mode.changeMode")}</p>
      </div>

      {canSchedule ? (
        <div className="grid gap-4 rounded-lg border border-border bg-background p-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="publishing-existing-target">
              {t("target.label")}
            </Label>
            {targets.length ? (
              <select
                id="publishing-existing-target"
                name="publishing-existing-target"
                autoComplete="off"
                value={targetId}
                onChange={(event) => onTargetChange(event.target.value)}
                className="h-9 rounded-lg border border-input bg-surface px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <option value="">{t("target.choose")}</option>
                {targets.map((target) => (
                  <option key={target.target_id} value={target.target_id}>
                    {target.display_name} · {target.channel}
                  </option>
                ))}
              </select>
            ) : (
              <Button type="button" variant="outline" onClick={onConnect}>
                <Link2 className="me-2 size-4" aria-hidden="true" />
                {t("target.connect")}
              </Button>
            )}
            {selectedTarget ? (
              <p className="text-xs text-muted-foreground">
                {t("target.capability")}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="publishing-existing-schedule">
              {t("schedule.dateLabel")}
            </Label>
            <Input
              id="publishing-existing-schedule"
              name="publishing-existing-schedule"
              autoComplete="off"
              type="datetime-local"
              value={scheduleValue}
              onChange={(event) => onScheduleChange(event.target.value)}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {t("schedule.helper")}
            </p>
          </div>
          {intent.scheduled_utc ? (
            <p className="text-xs text-muted-foreground md:col-span-2">
              {t("schedule.utc")}:{" "}
              {format.dateTime(new Date(intent.scheduled_utc), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              })}
            </p>
          ) : null}
          {scheduleChanged && intent.state !== "draft" ? (
            <p className="rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-warning md:col-span-2">
              {t("schedule.scheduleChanged")}
            </p>
          ) : null}
          {intent.state === "draft" ||
          intent.state === "awaiting_approval" ||
          intent.state === "scheduled" ? (
            <Button
              type="button"
              variant="outline"
              disabled={
                isBusy || !targetId || !scheduleValue || !scheduleChanged
              }
              onClick={onSaveSchedule}
            >
              <CalendarClock className="me-2 size-4" aria-hidden="true" />
              {intent.state === "draft"
                ? t("schedule.schedule")
                : t("schedule.reschedule")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {intent.state === "scheduled" ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-soft-teal/40 p-4 text-sm leading-6 text-navy">
          <Check
            className="mt-1 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p>{t("decision.scheduledConsequence")}</p>
        </div>
      ) : null}

      {showApproval ? (
        <div className="grid gap-3 rounded-lg border border-warning/25 bg-warning/10 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-warning">
            <CalendarClock className="size-4" aria-hidden="true" />
            {t("decision.reviewApproval")}
          </div>
          <p className="text-sm leading-6 text-warning">
            {t("decision.realConsequence")}
          </p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <dt>{t("schedule.local")}</dt>
            <dd className="font-semibold">
              {intent.scheduled_local ?? t("schedule.notConfirmed")}
            </dd>
            <dt>{t("schedule.utc")}</dt>
            <dd className="font-semibold">
              {intent.scheduled_utc
                ? format.dateTime(new Date(intent.scheduled_utc), {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  })
                : t("schedule.notConfirmed")}
            </dd>
          </dl>
          <Button
            type="button"
            disabled={isBusy || !approvalReady}
            onClick={onApprove}
          >
            <Check className="me-2 size-4" aria-hidden="true" />
            {t("decision.approve")}
          </Button>
        </div>
      ) : null}

      {showDispatch ? (
        <div className="grid gap-3 rounded-lg border border-primary/20 bg-soft-teal/40 p-4">
          <p className="text-sm leading-6 text-navy">
            {intent.mode === "manual_export"
              ? t("decision.exportConsequence")
              : t("decision.simulationConsequence")}
          </p>
          <Button type="button" disabled={isBusy} onClick={onDispatch}>
            <Play className="me-2 size-4" aria-hidden="true" />
            {intent.mode === "manual_export"
              ? t("decision.createExport")
              : t("decision.runSimulation")}
          </Button>
        </div>
      ) : null}

      {intent.state === "dispatching" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning/10 p-4">
          <p className="text-sm leading-6 text-warning">
            {t("decision.dispatching")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={onRefresh}
          >
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
            {t("decision.refresh")}
          </Button>
        </div>
      ) : null}

      {intent.state === "failed" ? (
        <div className="grid gap-3 rounded-lg border border-danger/25 bg-danger/10 p-4">
          <p className="text-sm leading-6 text-danger">
            {lastResult?.error_code ?? t("outcome.failed")}
          </p>
          {canRetry ? (
            <Button
              type="button"
              variant="destructive"
              disabled={isBusy}
              onClick={onRetry}
            >
              <RefreshCw className="me-2 size-4" aria-hidden="true" />
              {t("decision.retry")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={isBusy}
              onClick={onRefresh}
            >
              <RefreshCw className="me-2 size-4" aria-hidden="true" />
              {t("decision.refresh")}
            </Button>
          )}
        </div>
      ) : null}

      {intent.state === "action_required" ||
      lastAttempt?.state === "unknown" ? (
        <div className="grid gap-3 rounded-lg border border-danger/25 bg-danger/10 p-4">
          <p className="text-sm leading-6 text-danger">
            {t("decision.unknownConsequence")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={onRefresh}
          >
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
            {t("decision.refresh")}
          </Button>
        </div>
      ) : null}

      {intent.state === "draft" ||
      intent.state === "awaiting_approval" ||
      intent.state === "scheduled" ? (
        <Button
          type="button"
          variant="destructive"
          disabled={isBusy}
          onClick={onCancel}
        >
          <X className="me-2 size-4" aria-hidden="true" />
          {t("decision.cancel")}
        </Button>
      ) : null}

      {intent.state === "cancelled" || intent.state === "succeeded" ? (
        <p className="text-sm text-muted-foreground">
          {t("decision.cancelled")}
        </p>
      ) : null}
      {localError ? <ErrorLine>{localError}</ErrorLine> : null}
    </div>
  );
}

function ErrorLine({ children }: { readonly children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger/25 bg-danger/10 p-3 text-sm leading-6 text-danger"
    >
      {children}
    </p>
  );
}

function ApprovalDialog({
  open,
  pending,
  intent,
  candidate,
  target,
  scheduleValue,
  onOpenChange,
  onConfirm,
  t,
}: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly intent: PublicationIntentV1 | null;
  readonly candidate: PublicationCandidateSummaryV1;
  readonly target: PublishingTargetPublicV1 | null;
  readonly scheduleValue: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly t: ReturnType<typeof useTranslations<"Publishing">>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-navy/45" />
        <Dialog.Popup className="fixed top-1/2 start-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-5 shadow-elevated focus-visible:ring-3 focus-visible:ring-ring/40 md:p-6">
          <Dialog.Title className="text-xl font-bold text-navy">
            {t("dialog.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("dialog.body")}
          </Dialog.Description>
          <div className="mt-4 grid gap-2 rounded-lg border border-border bg-background p-3 text-sm">
            <Fact
              label={t("dialog.candidate")}
              value={candidate.candidate.candidate_id}
            />
            <Fact
              label={t("dialog.target")}
              value={target?.display_name ?? t("target.noConnected")}
            />
            <Fact
              label={t("dialog.mode")}
              value={intent ? modeLabel(intent.mode, t) : t("dialog.real")}
            />
            <Fact
              label={t("dialog.local")}
              value={scheduleValue || t("schedule.notConfirmed")}
            />
            <Fact
              label={t("dialog.utc")}
              value={intent?.scheduled_utc ?? t("schedule.notConfirmed")}
            />
          </div>
          <p className="mt-4 rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-warning">
            {t("dialog.warning")}
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close
              render={
                <Button type="button" variant="ghost" disabled={pending} />
              }
            >
              {t("dialog.cancel")}
            </Dialog.Close>
            <Button
              type="button"
              disabled={pending || !target}
              onClick={onConfirm}
            >
              {pending ? t("schedule.schedulePending") : t("dialog.confirm")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CancellationDialog({
  open,
  pending,
  error,
  intent,
  candidate,
  onOpenChange,
  onConfirm,
  t,
}: {
  readonly open: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly intent: PublicationIntentV1 | null;
  readonly candidate: PublicationCandidateSummaryV1;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
  readonly t: ReturnType<typeof useTranslations<"Publishing">>;
}) {
  return (
    <Dialog.Root
      open={open && Boolean(intent)}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-navy/45" />
        <Dialog.Popup className="fixed top-1/2 start-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-5 shadow-elevated focus-visible:ring-3 focus-visible:ring-ring/40 md:p-6">
          <Dialog.Title className="text-xl font-bold text-navy">
            {t("cancelDialog.title")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("cancelDialog.body")}
          </Dialog.Description>
          <dl className="mt-4 grid gap-2 rounded-lg border border-border bg-background p-3 text-sm">
            <Fact
              label={t("dialog.candidate")}
              value={candidate.candidate.candidate_id}
            />
            <Fact
              label={t("dialog.mode")}
              value={intent ? modeLabel(intent.mode, t) : "—"}
            />
            <Fact
              label={t("dialog.local")}
              value={intent?.scheduled_local ?? t("schedule.notConfirmed")}
            />
          </dl>
          <p className="mt-4 rounded-lg border border-danger/25 bg-danger/10 p-3 text-xs leading-5 text-danger">
            {t("cancelDialog.warning")}
          </p>
          {error ? (
            <div className="mt-3">
              <ErrorLine>{error}</ErrorLine>
            </div>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close
              render={
                <Button type="button" variant="ghost" disabled={pending} />
              }
            >
              {t("cancelDialog.keep")}
            </Dialog.Close>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={onConfirm}
            >
              {t("cancelDialog.confirm")}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
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
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-semibold text-navy">{value}</dd>
    </div>
  );
}

function modeLabel(
  mode: PublishingMode,
  t: ReturnType<typeof useTranslations<"Publishing">>,
): string {
  if (mode === "real") return t("dialog.real");
  if (mode === "manual_export") return t("dialog.manualExport");
  return t("dialog.simulation");
}

function intentStateLabel(
  state: PublicationIntentV1["state"],
  t: ReturnType<typeof useTranslations<"Publishing">>,
): string {
  if (state === "scheduled") return t("runway.scheduled");
  if (state === "succeeded") return t("runway.published");
  if (state === "failed") return t("runway.failed");
  if (state === "action_required") return t("runway.unknown");
  if (state === "cancelled") return t("runway.cancelled");
  if (state === "dispatching") return t("decision.dispatching");
  return t("runway.needsDecision");
}

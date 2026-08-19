"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { RefreshCw, Send } from "lucide-react"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  listPublishingAdminResults,
  resolvePublishingAdminResult,
  resyncPublishingAdminIntent,
  triggerPublishingAdminSweep,
  type PublishingAdminResultRow,
} from "@/lib/api/publishing-admin"
import {
  publishingAttemptStatusLabel,
  publishingChannelLabel,
  publishingIntentStatusLabel,
  publishingModeLabel,
  publishingOutcomeLabel,
} from "@/lib/admin-labels"
import { cn } from "@/lib/utils"

type Phase = "loading" | "error" | "ready"

export default function AdminPublishingPage() {
  const t = useTranslations("Admin")
  const [phase, setPhase] = useState<Phase>("loading")
  const [items, setItems] = useState<PublishingAdminResultRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [outcome, setOutcome] = useState<string>("UNKNOWN")
  const [dataVersion, setDataVersion] = useState(0)
  const [sweepState, setSweepState] = useState<
    "idle" | "running" | "done" | "failed"
  >("idle")
  const pageSize = 20

  const retry = useCallback(() => {
    setDataVersion((version) => version + 1)
  }, [])

  const goToPage = useCallback((next: number) => {
    setPage(next)
  }, [])

  const selectOutcome = (value: string) => {
    setPage(1)
    setOutcome(value)
    setDataVersion((version) => version + 1)
  }

  const runSweep = async () => {
    setSweepState("running")
    try {
      await triggerPublishingAdminSweep()
      setSweepState("done")
      setDataVersion((version) => version + 1)
    } catch {
      setSweepState("failed")
    }
  }

  useEffect(() => {
    let cancelled = false
    async function fetchResults() {
      setPhase("loading")
      try {
        const result = await listPublishingAdminResults({
          outcome,
          page,
          pageSize,
        })
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetchResults()
    return () => {
      cancelled = true
    }
  }, [dataVersion, page, outcome, pageSize])

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <AdminPageHeader
        eyebrow={t("publishingEyebrow")}
        title={t("publishing")}
        description={t("publishingDescription")}
        action={
          <Button
            type="button"
            onClick={runSweep}
            disabled={sweepState === "running"}
            className="bg-journey-mint text-navy hover:bg-journey-mint/80"
          >
            <RefreshCw
              className={cn(
                "size-4",
                sweepState === "running" && "animate-spin",
              )}
              aria-hidden="true"
            />
            {sweepState === "running"
              ? t("sweepRunning")
              : t("runSweep")}
          </Button>
        }
      />

      {sweepState === "done" && (
        <p
          aria-live="polite"
          className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary"
        >
          {t("sweepComplete")}
        </p>
      )}
      {sweepState === "failed" && (
        <p
          role="alert"
          className="rounded-lg border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger"
        >
          {t("sweepFailed")}
        </p>
      )}

      <OutcomeFilters
        current={outcome}
        onSelect={selectOutcome}
      />

      {phase === "loading" && <PublishingTableSkeleton />}

      {phase === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-5 py-8 shadow-elevated">
          <p className="text-muted-foreground">{t("loadFailedPublishing")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <PublishingTable
          items={items}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
          onChanged={retry}
        />
      )}
    </section>
  )
}

function OutcomeFilters({
  current,
  onSelect,
}: {
  current: string
  onSelect: (value: string) => void
}) {
  const t = useTranslations("Admin")

  const options: { value: string; label: string }[] = [
    { value: "UNKNOWN", label: t("outcomeUnknown") },
    { value: "FAILED", label: t("outcomeFailed") },
    { value: "PUBLISHED", label: t("outcomePublished") },
    { value: "ALL", label: t("outcomeAll") },
  ]

  return (
    <div
      role="group"
      aria-label={t("publishingDescription")}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const active =
          option.value === "ALL"
            ? current === "ALL"
            : current === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-navy",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function PublishingTable({
  items,
  total,
  page,
  pageSize,
  onPageChange,
  onChanged,
}: {
  items: PublishingAdminResultRow[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onChanged: () => void
}) {
  const t = useTranslations("Admin")
  const format = useFormatter()

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          <Send className="size-4" aria-hidden="true" />
          {t("publishing")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("noPublishingResults")}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("business")}</TableHead>
                    <TableHead>{t("channel")}</TableHead>
                    <TableHead>{t("occurredAt")}</TableHead>
                    <TableHead>{t("outcomeUnknown")}</TableHead>
                    <TableHead>{t("attemptStatus")}</TableHead>
                    <TableHead>{t("intentStatus")}</TableHead>
                    <TableHead>{t("scheduledAt")}</TableHead>
                    <TableHead className="text-end">{t("publishingActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-[180px]">
                        <p className="truncate font-semibold text-navy">
                          {item.intent.business?.displayName ??
                            t("notApplicable")}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.intent.target?.displayName ??
                            t("notApplicable")}
                        </p>
                      </TableCell>
                      <TableCell>
                        {item.intent.candidate?.channel
                          ? publishingChannelLabel(
                              item.intent.candidate.channel,
                              t,
                            )
                          : t("notApplicable")}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {format.dateTime(new Date(item.occurredAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.outcome === "UNKNOWN"
                              ? "past_due"
                              : item.outcome === "FAILED"
                                ? "expired"
                                : "active"
                          }
                        >
                          {publishingOutcomeLabel(item.outcome, t)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">
                          {publishingAttemptStatusLabel(
                            item.attempt.status,
                            t,
                          )}
                        </Badge>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("attemptNumber", {
                            number: item.attempt.attemptSequence,
                          })}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="admin">
                          {publishingIntentStatusLabel(item.intent.status, t)}
                        </Badge>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {publishingModeLabel(item.intent.mode, t)}
                        </p>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {item.intent.scheduledUtcAt
                          ? format.dateTime(new Date(item.intent.scheduledUtcAt), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : t("notApplicable")}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex flex-wrap justify-end gap-2">
                          {item.outcome === "UNKNOWN" && (
                            <ResolveDialog result={item} onResolved={onChanged} />
                          )}
                          {item.intent.status === "SCHEDULED" && (
                            <ResyncButton
                              intentId={item.intent.id}
                              onResynced={onChanged}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <AdminPagination
              page={page}
              total={total}
              pageSize={pageSize}
              onPageChange={onPageChange}
            />
          </>
        )}
      </div>
    </article>
  )
}

function ResolveDialog({
  result,
  onResolved,
}: {
  result: PublishingAdminResultRow
  onResolved: () => void
}) {
  const t = useTranslations("Admin")
  const [resolution, setResolution] = useState<"PUBLISHED" | "FAILED">(
    "FAILED",
  )
  const [reason, setReason] = useState("")
  const [remotePublicationId, setRemotePublicationId] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)

  const reset = () => {
    setResolution("FAILED")
    setReason("")
    setRemotePublicationId("")
    setError(false)
    setSuccess(false)
  }

  const openDialog = () => {
    reset()
    setOpen(true)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (next) reset()
    setOpen(next)
  }

  const canSubmit =
    reason.trim().length > 0 &&
    (resolution === "FAILED" || remotePublicationId.trim().length > 0)

  const submit = async () => {
    setBusy(true)
    setError(false)
    try {
      await resolvePublishingAdminResult(result.id, {
        resolution,
        reason: reason.trim(),
        remotePublicationId:
          resolution === "PUBLISHED"
            ? remotePublicationId.trim()
            : undefined,
      })
      setBusy(false)
      setSuccess(true)
      window.setTimeout(() => {
        setOpen(false)
        onResolved()
      }, 600)
    } catch {
      setBusy(false)
      setError(true)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" onClick={openDialog}>
            {t("resolve")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("resolveResultTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("resolveResultDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-4 pt-2">
          <div
            role="group"
            aria-label={t("resolveResultTitle")}
            className="grid grid-cols-2 gap-2"
          >
            <button
              type="button"
              aria-pressed={resolution === "FAILED"}
              onClick={() => setResolution("FAILED")}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                resolution === "FAILED"
                  ? "border-danger bg-danger/10 text-danger"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {t("resolutionFailed")}
            </button>
            <button
              type="button"
              aria-pressed={resolution === "PUBLISHED"}
              onClick={() => setResolution("PUBLISHED")}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
                resolution === "PUBLISHED"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {t("resolutionPublished")}
            </button>
          </div>

          <div className="grid gap-1">
            <label
              htmlFor="publishing-resolve-reason"
              className="text-sm font-medium text-navy"
            >
              {t("reasonLabel")}
            </label>
            <Input
              id="publishing-resolve-reason"
              type="text"
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              className="h-10"
            />
          </div>

          {resolution === "PUBLISHED" && (
            <div className="grid gap-1">
              <label
                htmlFor="publishing-resolve-remote-id"
                className="text-sm font-medium text-navy"
              >
                {t("remotePublicationIdLabel")}
              </label>
              <Input
                id="publishing-resolve-remote-id"
                type="text"
                autoComplete="off"
                value={remotePublicationId}
                onChange={(e) => setRemotePublicationId(e.target.value)}
                placeholder={t("remotePublicationIdPlaceholder")}
                className="h-10"
              />
              <p className="text-xs text-warning">
                {t("remotePublicationIdRequired")}
              </p>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {t("resolveFailed")}
            </p>
          )}
          {success && (
            <p
              aria-live="polite"
              className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
            >
              {t("resolved")}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant={resolution === "FAILED" ? "destructive" : "default"}
            onClick={submit}
            disabled={!canSubmit || busy}
          >
            {busy ? t("resolving") : t("resolve")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ResyncButton({
  intentId,
  onResynced,
}: {
  intentId: string
  onResynced: () => void
}) {
  const t = useTranslations("Admin")
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<"idle" | "done" | "failed">("idle")

  const run = async () => {
    setBusy(true)
    setState("idle")
    try {
      await resyncPublishingAdminIntent(intentId)
      setBusy(false)
      setState("done")
      onResynced()
    } catch {
      setBusy(false)
      setState("failed")
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={busy}
      >
        <RefreshCw
          className={cn("size-3.5", busy && "animate-spin")}
          aria-hidden="true"
        />
        {busy ? t("resyncing") : t("resync")}
      </Button>
      {state === "done" && (
        <span className="text-xs text-primary">{t("resyncComplete")}</span>
      )}
      {state === "failed" && (
        <span className="text-xs text-danger">{t("resyncFailed")}</span>
      )}
    </div>
  )
}

function PublishingTableSkeleton() {
  const t = useTranslations("Admin")
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-2 p-4 md:p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <p className="sr-only">{t("publishing")}</p>
    </article>
  )
}
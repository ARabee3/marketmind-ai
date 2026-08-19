"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, CreditCard, ShieldAlert } from "lucide-react"
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
  listBillingAccounts,
  listBillingCostAlerts,
  listBillingReconciliationMismatches,
  pauseBillingAccount,
  resumeBillingAccount,
  type BillingAccountRow,
  type CostAlertSummary,
  type ReconciliationMismatch,
} from "@/lib/api/admin-billing"
import {
  billingAccountStatusLabel,
  billingCostAlertReasonLabel,
  billingMismatchTypeLabel,
} from "@/lib/admin-labels"
import { cn } from "@/lib/utils"

type Phase = "loading" | "error" | "ready"

export default function AdminBillingPage() {
  const t = useTranslations("Admin")
  const [phase, setPhase] = useState<Phase>("loading")
  const [dataVersion, setDataVersion] = useState(0)
  const [accounts, setAccounts] = useState<BillingAccountRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [costAlerts, setCostAlerts] = useState<CostAlertSummary | null>(null)
  const [mismatches, setMismatches] = useState<ReconciliationMismatch[]>([])
  const pageSize = 20

  const retry = useCallback(() => {
    setDataVersion((version) => version + 1)
  }, [])

  const goToPage = useCallback((next: number) => {
    setPage(next)
  }, [])

  const selectStatus = (value: string) => {
    setPage(1)
    setStatus(value)
    setDataVersion((version) => version + 1)
  }

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setPhase("loading")
      try {
        const [accountResult, alertResult, mismatchResult] = await Promise.all([
          listBillingAccounts({
            page,
            pageSize,
            search: search.trim() || undefined,
            status: status || undefined,
          }),
          listBillingCostAlerts(),
          listBillingReconciliationMismatches(),
        ])
        if (cancelled) return
        setAccounts(accountResult.items)
        setTotal(accountResult.total)
        setCostAlerts(alertResult)
        setMismatches(mismatchResult)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetchData()
    return () => {
      cancelled = true
    }
  }, [dataVersion, page, status, search, pageSize])

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <AdminPageHeader
        eyebrow={t("billingEyebrow")}
        title={t("billing")}
        description={t("billingDescription")}
      />

      {phase === "loading" && <BillingSkeleton />}

      {phase === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-5 py-8 shadow-elevated">
          <p className="text-muted-foreground">{t("loadFailedBilling")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <CostAlertsPanel summary={costAlerts} />

          <ReconciliationPanel mismatches={mismatches} />

          <AccountsPanel
            accounts={accounts}
            total={total}
            page={page}
            pageSize={pageSize}
            search={search}
            status={status}
            onSearchChange={(value) => {
              setPage(1)
              setSearch(value)
              setDataVersion((version) => version + 1)
            }}
            onStatusChange={selectStatus}
            onPageChange={goToPage}
            onChanged={retry}
          />
        </>
      )}
    </section>
  )
}

function CostAlertsPanel({ summary }: { summary: CostAlertSummary | null }) {
  const t = useTranslations("Admin")

  return (
    <section aria-labelledby="billing-cost-alerts" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p id="billing-cost-alerts" className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          <AlertTriangle className="size-4" aria-hidden="true" />
          {t("costAlertsTitle")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        {!summary || summary.alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("costAlertsAllClear")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("billingAccountOwner")}</TableHead>
                  <TableHead>{t("costAlertReason")}</TableHead>
                  <TableHead>{t("costAlertTotalEgp")}</TableHead>
                  <TableHead>{t("costAlertArtifacts")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.alerts.map((alert) => (
                  <TableRow key={`${alert.billingAccountId}-${alert.reason}`}>
                    <TableCell>
                      <p className="font-semibold text-navy">
                        {alert.ownerFullName ?? t("unknownOwner")}
                      </p>
                      <p className="text-xs text-muted-foreground">{alert.ownerEmail}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="past_due">
                        {billingCostAlertReasonLabel(alert.reason, t)}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {alert.totalEgpCost !== null
                        ? t("egpAmount", { amount: alert.totalEgpCost })
                        : t("notApplicable")}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {alert.artifactCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {summary && (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">{t("costAlertsAboveEgp50")}</p>
              <p className="text-lg font-bold text-navy tabular-nums">
                {summary.totalAccountsAboveEgp50}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">{t("costAlertsHighRetry")}</p>
              <p className="text-lg font-bold text-navy tabular-nums">
                {summary.totalHighRetryArtifacts}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <p className="text-xs text-muted-foreground">{t("costAlertsP95")}</p>
              <p className="text-lg font-bold text-navy tabular-nums">
                {summary.cohort95thPercentileEgp !== null
                  ? t("egpAmount", { amount: summary.cohort95thPercentileEgp })
                  : t("notApplicable")}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ReconciliationPanel({ mismatches }: { mismatches: ReconciliationMismatch[] }) {
  const t = useTranslations("Admin")

  return (
    <section aria-labelledby="billing-reconciliation" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p id="billing-reconciliation" className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          <ShieldAlert className="size-4" aria-hidden="true" />
          {t("reconciliationTitle")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        {mismatches.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("reconciliationAllClear")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("mismatchType")}</TableHead>
                  <TableHead>{t("billingAccountOwner")}</TableHead>
                  <TableHead>{t("mismatchProviderRef")}</TableHead>
                  <TableHead>{t("occurredAt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mismatches.map((mismatch, index) => (
                  <TableRow key={`${mismatch.mismatchType}-${mismatch.attemptId ?? mismatch.eventId ?? mismatch.transactionId ?? index}`}>
                    <TableCell>
                      <Badge variant="past_due">
                        {billingMismatchTypeLabel(mismatch.mismatchType, t)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm text-navy">{mismatch.ownerEmail ?? t("unknownOwner")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("billingAccountIdShort", { id: mismatch.billingAccountId })}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {mismatch.providerCheckoutRef ?? t("notApplicable")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {mismatch.occurredAt ? new Date(mismatch.occurredAt).toLocaleString() : t("notApplicable")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}

function AccountsPanel({
  accounts,
  total,
  page,
  pageSize,
  search,
  status,
  onSearchChange,
  onStatusChange,
  onPageChange,
  onChanged,
}: {
  accounts: BillingAccountRow[]
  total: number
  page: number
  pageSize: number
  search: string
  status: string
  onSearchChange: (value: string) => void
  onStatusChange: (value: string) => void
  onPageChange: (page: number) => void
  onChanged: () => void
}) {
  const t = useTranslations("Admin")

  return (
    <section aria-labelledby="billing-accounts" className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p id="billing-accounts" className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          <CreditCard className="size-4" aria-hidden="true" />
          {t("billingAccountsTitle")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <AccountStatusFilters current={status} onSelect={onStatusChange} />
          <div className="grid gap-1 md:w-72">
            <label htmlFor="billing-account-search" className="sr-only">
              {t("billingAccountSearchLabel")}
            </label>
            <Input
              id="billing-account-search"
              type="search"
              autoComplete="off"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("billingAccountSearchPlaceholder")}
              className="h-10"
            />
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("noBillingAccounts")}</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("billingAccountOwner")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("billingPauseReason")}</TableHead>
                    <TableHead>{t("billingAccountCreated")}</TableHead>
                    <TableHead className="text-end">{t("libraryActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="max-w-[260px]">
                        <p className="truncate font-semibold text-navy">
                          {account.ownerFullName ?? t("unknownOwner")}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{account.ownerEmail}</p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={account.status === "active" ? "active" : "past_due"}
                        >
                          {billingAccountStatusLabel(account.status, t)}
                        </Badge>
                        {account.pausedAt && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t("billingPausedAt", { time: new Date(account.pausedAt).toLocaleString() })}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {account.pausedReason ?? t("notApplicable")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(account.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-end">
                        {account.status === "active" ? (
                          <PauseAccountDialog account={account} onDone={onChanged} />
                        ) : (
                          <ResumeAccountDialog account={account} onDone={onChanged} />
                        )}
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
    </section>
  )
}

function AccountStatusFilters({
  current,
  onSelect,
}: {
  current: string
  onSelect: (value: string) => void
}) {
  const t = useTranslations("Admin")

  const options: { value: string; label: string }[] = [
    { value: "", label: t("billingStatusAll") },
    { value: "active", label: t("billingAccountActive") },
    { value: "paused", label: t("billingAccountPaused") },
  ]

  return (
    <div
      role="group"
      aria-label={t("billingAccountsTitle")}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const active = current === option.value
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

function PauseAccountDialog({
  account,
  onDone,
}: {
  account: BillingAccountRow
  onDone: () => void
}) {
  const t = useTranslations("Admin")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)
  const [reason, setReason] = useState("")

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (next) {
      setError(false)
      setSuccess(false)
      setReason("")
    }
    setOpen(next)
  }

  const submit = async () => {
    if (!reason.trim()) return
    setBusy(true)
    setError(false)
    try {
      await pauseBillingAccount(account.id, reason.trim())
      setBusy(false)
      setSuccess(true)
      window.setTimeout(() => {
        setOpen(false)
        onDone()
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
          <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
            {t("pauseAccount")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pauseAccountTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("pauseAccountDescription", {
              name: account.ownerFullName ?? account.ownerEmail ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <p className="font-semibold text-navy">
            {account.ownerFullName ?? t("unknownOwner")}
          </p>
          <p className="text-xs text-muted-foreground">{account.ownerEmail}</p>
        </div>

        <div className="grid gap-1">
          <label htmlFor="pause-reason" className="sr-only">
            {t("reasonLabel")}
          </label>
          <Input
            id="pause-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="h-10"
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {t("pauseAccountFailed")}
          </p>
        )}
        {success && (
          <p
            aria-live="polite"
            className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            {t("pauseAccountComplete")}
          </p>
        )}

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
            variant="destructive"
            onClick={submit}
            disabled={busy || !reason.trim()}
          >
            {busy ? t("pausingAccount") : t("pauseAccount")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ResumeAccountDialog({
  account,
  onDone,
}: {
  account: BillingAccountRow
  onDone: () => void
}) {
  const t = useTranslations("Admin")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (next) {
      setError(false)
      setSuccess(false)
    }
    setOpen(next)
  }

  const submit = async () => {
    setBusy(true)
    setError(false)
    try {
      await resumeBillingAccount(account.id)
      setBusy(false)
      setSuccess(true)
      window.setTimeout(() => {
        setOpen(false)
        onDone()
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
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            {t("resumeAccount")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("resumeAccountTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("resumeAccountDescription", {
              name: account.ownerFullName ?? account.ownerEmail ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <p className="font-semibold text-navy">
            {account.ownerFullName ?? t("unknownOwner")}
          </p>
          <p className="text-xs text-muted-foreground">{account.ownerEmail}</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {t("resumeAccountFailed")}
          </p>
        )}
        {success && (
          <p
            aria-live="polite"
            className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            {t("resumeAccountComplete")}
          </p>
        )}

        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={busy}
          >
            {t("cancel")}
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? t("resumingAccount") : t("resumeAccount")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function BillingSkeleton() {
  return (
    <div className="grid gap-5">
      <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
        <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="space-y-2 p-4 md:p-5">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </article>
      <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
        <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="space-y-2 p-4 md:p-5">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </article>
    </div>
  )
}
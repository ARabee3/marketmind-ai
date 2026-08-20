"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { StatTile } from "@/components/ui/stat-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import {
  getWalletOverview,
  listWalletBalances,
  getWalletLedger,
  listWalletTransactions,
  topUpWallet,
  type WalletOverview,
  type WalletBalanceRow,
  type WalletLedgerRow,
  type WalletTransactionRow,
} from "@/lib/api/admin-billing"
import {
  billingAccountStatusLabel,
  walletLedgerDirectionLabel,
  walletLedgerReasonLabel,
  walletPaymentModeLabel,
  walletTransactionKindLabel,
  walletTransactionStatusLabel,
} from "@/lib/admin-labels"
import { cn } from "@/lib/utils"

type Phase = "loading" | "error" | "ready"

export default function AdminRevenuePage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [overview, setOverview] = useState<WalletOverview | null>(null)
  const [wallets, setWallets] = useState<WalletBalanceRow[]>([])
  const [walletTotal, setWalletTotal] = useState(0)
  const [walletPage, setWalletPage] = useState(1)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [selectedWallet, setSelectedWallet] = useState<WalletBalanceRow | null>(null)
  const [ledger, setLedger] = useState<WalletLedgerRow[]>([])
  const [ledgerPhase, setLedgerPhase] = useState<"loading" | "error" | "ready">("ready")
  const [transactions, setTransactions] = useState<WalletTransactionRow[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [dataVersion, setDataVersion] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(false)
  const hasLoadedRef = useRef(false)
  const ledgerRequestRef = useRef(0)
  const pageSize = 20

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToWalletPage = useCallback((p: number) => {
    setWalletPage(p)
  }, [])

  const goToTxPage = useCallback((p: number) => {
    setTxPage(p)
  }, [])

  const selectWallet = useCallback(async (wallet: WalletBalanceRow) => {
    const requestId = ledgerRequestRef.current + 1
    ledgerRequestRef.current = requestId
    setSelectedWallet(wallet)
    setLedgerPhase("loading")
    try {
      const rows = await getWalletLedger(wallet.accountId)
      if (requestId !== ledgerRequestRef.current) return
      setLedger(rows)
      setLedgerPhase("ready")
    } catch {
      if (requestId !== ledgerRequestRef.current) return
      setLedger([])
      setLedgerPhase("error")
    }
  }, [])

  const retryLedger = useCallback(() => {
    if (selectedWallet) void selectWallet(selectedWallet)
  }, [selectedWallet, selectWallet])

  const refreshAfterTopUp = useCallback(() => {
    setDataVersion((v) => v + 1)
    if (selectedWallet) {
      void selectWallet(selectedWallet)
    }
  }, [selectedWallet, selectWallet])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      if (hasLoadedRef.current) {
        setIsRefreshing(true)
        setRefreshError(false)
      } else {
        setPhase("loading")
      }
      try {
        const [ov, walletData, txData] = await Promise.all([
          getWalletOverview(),
          listWalletBalances({
            page: walletPage,
            pageSize,
            search: debouncedSearch || undefined,
          }),
          listWalletTransactions({ page: txPage, pageSize }),
        ])
        if (cancelled) return
        setOverview(ov)
        setWallets(walletData.items)
        setSelectedWallet((current) => {
          if (!current) return null
          return walletData.items.find((wallet) => wallet.accountId === current.accountId) ?? null
        })
        setWalletTotal(walletData.total)
        setTransactions(txData.items)
        setTxTotal(txData.total)
        setPhase("ready")
        hasLoadedRef.current = true
        setIsRefreshing(false)
        setRefreshError(false)
      } catch {
        if (!cancelled) {
          if (hasLoadedRef.current) {
            setIsRefreshing(false)
            setRefreshError(true)
          } else {
            setPhase("error")
          }
        }
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [dataVersion, walletPage, txPage, debouncedSearch])

  if (phase === "loading") {
    return (
      <section className="flex flex-col gap-5 md:gap-7">
        <AdminPageHeader
          eyebrow={t("revenueEyebrow")}
          title={t("revenue")}
          description={t("revenueDescription")}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <WalletTableSkeleton t={t} />
      </section>
    )
  }

  if (phase === "error") {
    return (
      <section className="flex flex-col gap-5 md:gap-7">
        <AdminPageHeader
          eyebrow={t("revenueEyebrow")}
          title={t("revenue")}
          description={t("revenueDescription")}
        />
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-5 py-8 shadow-elevated">
          <p className="text-muted-foreground">{t("loadError")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <AdminPageHeader
        eyebrow={t("revenueEyebrow")}
        title={t("revenue")}
        description={t("revenueDescription")}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("activeBusinesses")}
          value={format.number(overview?.activeAccounts ?? 0)}
          subtext={
            overview && overview.pausedAccounts > 0
              ? `${t("billingAccountPaused")}: ${format.number(overview.pausedAccounts)}`
              : undefined
          }
        />
        <StatTile
          label={t("pointsOutstanding")}
          value={format.number(overview?.totalPointsOutstanding ?? 0)}
        />
        <StatTile
          label={t("pointsLifetimeSpent")}
          value={format.number(overview?.totalLifetimeSpent ?? 0)}
        />
        <StatTile
          label={t("topUpEgp")}
          value={
            overview
              ? format.number(overview.totalTopUpEgp, {
                  style: "currency",
                  currency: "EGP",
                  maximumFractionDigits: 0,
                })
              : "0"
          }
          subtext={
            overview
              ? t("topUpCount", { count: overview.totalTopUpCount })
              : undefined
          }
        />
      </div>

      <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
        <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            {t("walletsTitle")}
          </p>
        </div>
        <div className="grid gap-5 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-2xl font-bold text-navy">{t("walletsTitle")}</h2>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <label className="sr-only" htmlFor="wallet-search">
                {t("walletSearchLabel")}
              </label>
              <Input
                id="wallet-search"
                name="wallet-search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setWalletPage(1)
                  setSearch(e.target.value)
                }}
                placeholder={t("walletSearchPlaceholder")}
                className="md:w-64"
              />
              {isRefreshing && (
                <span role="status" className="text-xs text-muted-foreground">
                  {t("refreshing")}
                </span>
              )}
              {refreshError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 text-xs text-danger"
                >
                  <span>{t("refreshFailed")}</span>
                  <Button type="button" size="sm" variant="outline" onClick={retry}>
                    {t("retry")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {wallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noWallets")}</p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("walletOwner")}</TableHead>
                      <TableHead>{t("walletStatus")}</TableHead>
                      <TableHead className="text-end">{t("walletBalance")}</TableHead>
                      <TableHead className="text-end">{t("walletLifetimeGranted")}</TableHead>
                      <TableHead className="text-end">{t("walletLifetimeSpent")}</TableHead>
                      <TableHead>{t("walletCreated")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wallets.map((w) => (
                      <TableRow
                        key={w.accountId}
                        className={cn(
                          "cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2",
                          selectedWallet?.accountId === w.accountId && "bg-primary/5",
                        )}
                        role="button"
                        tabIndex={0}
                        aria-label={t("openWalletDetails", {
                          name: w.ownerFullName || w.ownerEmail || t("unknownOwner"),
                        })}
                        onClick={() => void selectWallet(w)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            void selectWallet(w)
                          }
                        }}
                      >
                        <TableCell>
                          <span className="font-medium text-navy">
                            {w.ownerFullName || w.ownerEmail || t("unknownOwner")}
                          </span>
                          {w.ownerFullName && w.ownerEmail && (
                            <span className="block text-xs text-muted-foreground">
                              {w.ownerEmail}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={w.status === "paused" ? "past_due" : "active"}>
                            {billingAccountStatusLabel(w.status, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end font-semibold tabular-nums text-navy">
                          {format.number(w.balance)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.number(w.lifetimeGranted)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.number(w.lifetimeSpent)}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {format.dateTime(new Date(w.createdAt), { dateStyle: "medium" })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <AdminPagination
                page={walletPage}
                total={walletTotal}
                pageSize={pageSize}
                onPageChange={goToWalletPage}
              />
            </>
          )}
        </div>
      </article>

      {selectedWallet && (
        <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
          <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
            <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
              {t("walletLedgerTitle")}
            </p>
          </div>
          <div className="grid gap-5 p-4 md:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <h2 className="text-2xl font-bold text-navy">
                {t("walletLedgerTitle")}:{" "}
                <span className="text-primary">
                  {selectedWallet.ownerFullName || selectedWallet.ownerEmail || t("unknownOwner")}
                </span>
              </h2>
              <TopUpDialog wallet={selectedWallet} onDone={refreshAfterTopUp} />
            </div>

            {ledgerPhase === "loading" ? (
              <Skeleton className="h-48" />
            ) : ledgerPhase === "error" ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-lg border border-danger/20 bg-danger/5 px-4 py-4 text-sm"
              >
                <p className="text-danger">{t("walletLedgerLoadError")}</p>
                <Button type="button" size="sm" variant="outline" onClick={retryLedger}>
                  {t("retry")}
                </Button>
              </div>
            ) : ledger.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("walletLedgerEmpty")}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("ledgerDate")}</TableHead>
                      <TableHead>{t("ledgerDirection")}</TableHead>
                      <TableHead>{t("ledgerReason")}</TableHead>
                      <TableHead className="text-end">{t("ledgerPoints")}</TableHead>
                      <TableHead className="text-end">{t("ledgerBalanceAfter")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledger.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {format.dateTime(new Date(row.createdAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={row.direction === "credit" ? "active" : "default"}
                          >
                            {walletLedgerDirectionLabel(row.direction, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {walletLedgerReasonLabel(row.reason, t)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {row.direction === "debit" ? "-" : "+"}
                          {format.number(row.points)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.number(row.balanceAfter)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </article>
      )}

      <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
        <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            {t("transactionsTitle")}
          </p>
        </div>
        <div className="grid gap-5 p-4 md:p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold text-navy">{t("transactionsTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("topUpCount", {
                count: overview?.totalTopUpCount ?? 0,
              })}
            </p>
          </div>

          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noTransactions")}</p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("transactionOwner")}</TableHead>
                      <TableHead>{t("transactionKind")}</TableHead>
                      <TableHead>{t("transactionStatus")}</TableHead>
                      <TableHead className="text-end">{t("transactionAmount")}</TableHead>
                      <TableHead>{t("transactionMode")}</TableHead>
                      <TableHead>{t("transactionDate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell>
                          <span className="font-medium text-navy">
                            {tx.ownerFullName || tx.ownerEmail || t("unknownOwner")}
                          </span>
                          {tx.ownerFullName && tx.ownerEmail && (
                            <span className="block text-xs text-muted-foreground">
                              {tx.ownerEmail}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {walletTransactionKindLabel(tx.kind, t)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              tx.status === "succeeded"
                                ? "active"
                                : tx.status === "failed"
                                  ? "past_due"
                                  : "default"
                            }
                          >
                            {walletTransactionStatusLabel(tx.status, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {format.number(tx.amountEgp, {
                            style: "currency",
                            currency: tx.currency || "EGP",
                            maximumFractionDigits: 0,
                          })}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {tx.paymentMode
                            ? walletPaymentModeLabel(tx.paymentMode, t)
                            : t("none")}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {format.dateTime(new Date(tx.occurredAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <AdminPagination
                page={txPage}
                total={txTotal}
                pageSize={pageSize}
                onPageChange={goToTxPage}
              />
            </>
          )}
        </div>
      </article>
    </section>
  )
}

function WalletTableSkeleton({
  t,
}: {
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("walletsTitle")}
        </p>
      </div>
      <div className="space-y-2 p-4 md:p-5">
        <Skeleton className="h-48" />
      </div>
    </article>
  )
}

function TopUpDialog({
  wallet,
  onDone,
}: {
  wallet: WalletBalanceRow
  onDone: () => void
}) {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)
  const [points, setPoints] = useState("")
  const [reason, setReason] = useState("")

  const parsedPoints = Number.parseInt(points, 10)
  const pointsValid = Number.isInteger(parsedPoints) && parsedPoints >= 1

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (next) {
      setError(false)
      setSuccess(false)
      setPoints("")
      setReason("")
    }
    setOpen(next)
  }

  const submit = async () => {
    if (!pointsValid || !reason.trim()) return
    setBusy(true)
    setError(false)
    try {
      await topUpWallet(wallet.accountId, parsedPoints, reason.trim())
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
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            {t("topUpWallet")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("topUpWalletTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("topUpWalletDescription", {
              name: wallet.ownerFullName ?? wallet.ownerEmail ?? t("unknownOwner"),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <p className="font-semibold text-navy">
            {wallet.ownerFullName ?? t("unknownOwner")}
          </p>
          <p className="text-xs text-muted-foreground">{wallet.ownerEmail}</p>
          <p className="text-xs text-muted-foreground">
            {t("walletBalance")}: {format.number(wallet.balance)}
          </p>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <label htmlFor="top-up-points" className="sr-only">
              {t("topUpPointsLabel")}
            </label>
            <Input
              id="top-up-points"
              type="number"
              min={1}
              name="top-up-points"
              autoComplete="off"
              inputMode="numeric"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder={t("topUpPointsPlaceholder")}
              className="h-10"
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor="top-up-reason" className="sr-only">
              {t("reasonLabel")}
            </label>
            <Input
              id="top-up-reason"
              name="top-up-reason"
              autoComplete="off"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              className="h-10"
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {t("topUpWalletFailed")}
          </p>
        )}
        {success && (
          <p
            aria-live="polite"
            className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            {t("topUpWalletComplete")}
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
            variant="default"
            onClick={submit}
            disabled={busy || !pointsValid || !reason.trim()}
          >
            {busy ? t("toppingUpWallet") : t("topUpWallet")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

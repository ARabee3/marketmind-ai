"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { StatTile } from "@/components/ui/stat-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import {
  getWalletOverview,
  listWalletBalances,
  getWalletLedger,
  listWalletTransactions,
  type WalletOverview,
  type WalletBalanceRow,
  type WalletLedgerRow,
  type WalletTransactionRow,
} from "@/lib/api/admin-billing"
import {
  billingAccountStatusLabel,
  walletLedgerDirectionLabel,
  walletLedgerReasonLabel,
  walletTransactionKindLabel,
  walletTransactionStatusLabel,
} from "@/lib/admin-labels"
import { cn } from "@/lib/utils"

type Phase = "loading" | "error" | "ready"

export default function AdminRevenuePage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("loading")
  const [overview, setOverview] = useState<WalletOverview | null>(null)
  const [wallets, setWallets] = useState<WalletBalanceRow[]>([])
  const [walletTotal, setWalletTotal] = useState(0)
  const [walletPage, setWalletPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [selectedWallet, setSelectedWallet] = useState<WalletBalanceRow | null>(null)
  const [ledger, setLedger] = useState<WalletLedgerRow[]>([])
  const [ledgerPhase, setLedgerPhase] = useState<"loading" | "ready">("ready")
  const [transactions, setTransactions] = useState<WalletTransactionRow[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [dataVersion, setDataVersion] = useState(0)
  const pageSize = 20
  const walletStateFilter = searchParams.get("walletState") ?? undefined
  const [lastWalletStateFilter, setLastWalletStateFilter] = useState(walletStateFilter)
  if (walletStateFilter !== lastWalletStateFilter) {
    setLastWalletStateFilter(walletStateFilter)
    setWalletPage(1)
  }

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToWalletPage = useCallback((p: number) => {
    setWalletPage(p)
  }, [])

  const goToTxPage = useCallback((p: number) => {
    setTxPage(p)
  }, [])

  const selectStatus = (value: string) => {
    setWalletPage(1)
    setStatus(value)
    setDataVersion((v) => v + 1)
  }

  const selectWallet = useCallback(async (wallet: WalletBalanceRow) => {
    setSelectedWallet(wallet)
    setLedgerPhase("loading")
    try {
      const rows = await getWalletLedger(wallet.accountId)
      setLedger(rows)
    } catch {
      setLedger([])
    } finally {
      setLedgerPhase("ready")
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const [ov, walletData, txData] = await Promise.all([
          getWalletOverview(),
          listWalletBalances({
            page: walletPage,
            pageSize,
            search: search.trim() || undefined,
            status: status || walletStateFilter,
          }),
          listWalletTransactions({ page: txPage, pageSize }),
        ])
        if (cancelled) return
        setOverview(ov)
        setWallets(walletData.items)
        setWalletTotal(walletData.total)
        setTransactions(txData.items)
        setTxTotal(txData.total)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [dataVersion, walletPage, status, walletStateFilter, txPage, search])

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
          value={String(overview?.activeAccounts ?? 0)}
          subtext={
            overview && overview.pausedAccounts > 0
              ? `${t("billingAccountPaused")}: ${overview.pausedAccounts}`
              : undefined
          }
        />
        <StatTile
          label={t("pointsOutstanding")}
          value={String(overview?.totalPointsOutstanding ?? 0)}
        />
        <StatTile
          label={t("pointsLifetimeSpent")}
          value={String(overview?.totalLifetimeSpent ?? 0)}
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
                value={search}
                onChange={(e) => {
                  setWalletPage(1)
                  setSearch(e.target.value)
                }}
                placeholder={t("walletSearchPlaceholder")}
                className="md:w-64"
              />
              <div
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                role="group"
                aria-label={t("walletStatus")}
              >
                {["", "active", "paused"].map((value) => (
                  <button
                    key={value || "all"}
                    type="button"
                    onClick={() => selectStatus(value)}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                      status === value
                        ? "bg-primary text-white"
                        : "text-muted-foreground hover:text-navy",
                    )}
                  >
                    {value === "" ? t("walletStatusAll") : billingAccountStatusLabel(value, t)}
                  </button>
                ))}
              </div>
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
                          "cursor-pointer",
                          selectedWallet?.accountId === w.accountId && "bg-primary/5",
                        )}
                        onClick={() => void selectWallet(w)}
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
            <h2 className="text-2xl font-bold text-navy">
              {t("walletLedgerTitle")}:{" "}
              <span className="text-primary">
                {selectedWallet.ownerFullName || selectedWallet.ownerEmail || t("unknownOwner")}
              </span>
            </h2>

            {ledgerPhase === "loading" ? (
              <Skeleton className="h-48" />
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
                          {tx.paymentMode || t("none")}
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
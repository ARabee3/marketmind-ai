"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { StatTile } from "@/components/ui/stat-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  getAdminRevenueSummary,
  getAdminSubscriptions,
  type AdminRevenueSummary,
  type AdminSubscriptionRow,
} from "@/lib/api/admin"

type Phase = "loading" | "error" | "ready"

export default function AdminRevenuePage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [revenue, setRevenue] = useState<AdminRevenueSummary | null>(null)
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([])
  const [subTotal, setSubTotal] = useState(0)
  const [subPage, setSubPage] = useState(1)
  const [dataVersion, setDataVersion] = useState(0)
  const subPageSize = 20

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToPage = useCallback((p: number) => {
    setSubPage(p)
    setDataVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const [rev, subData] = await Promise.all([
          getAdminRevenueSummary(),
          getAdminSubscriptions(subPage, subPageSize),
        ])
        if (cancelled) return
        setRevenue(rev)
        setSubs(subData.items)
        setSubTotal(subData.total)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [dataVersion, subPage])

  const totalSubPages = Math.max(1, Math.ceil(subTotal / subPageSize))

  if (phase === "loading") {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-bold text-navy">{t("revenue")}</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t("loadError")}</p>
        <button
          onClick={retry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          {t("retry")}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-navy">{t("revenue")}</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("activeBusinesses")}
          value={String(revenue?.activeBusinesses ?? 0)}
        />
        <StatTile
          label={t("activeSubscriptions")}
          value={String(revenue?.activeSubscriptions ?? 0)}
          subtext={
            revenue && revenue.trialingCount > 0
              ? `${t("trialing")}: ${revenue.trialingCount}`
              : undefined
          }
        />
        <StatTile
          label={t("mrr")}
          value={
            revenue
              ? format.number(revenue.mrrEgp, {
                  style: "currency",
                  currency: "EGP",
                  maximumFractionDigits: 0,
                })
              : "0"
          }
        />
      </div>

      <section>
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-[0.12em]">
          {t("subscriptions")}
        </h2>
        {subs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("noSubscriptions")}
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("owner")}</TableHead>
                  <TableHead>{t("plan")}</TableHead>
                  <TableHead>{t("amount")}</TableHead>
                  <TableHead>{t("subscriptionState")}</TableHead>
                  <TableHead>{t("paidThrough")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <span className="font-medium text-navy">
                        {s.ownerName || s.ownerEmail}
                      </span>
                      {s.ownerName && (
                        <span className="block text-xs text-muted-foreground">
                          {s.ownerEmail}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.priceDisplayNameEn} ({s.planCode})
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {format.number(s.amountEgp, {
                        style: "currency",
                        currency: "EGP",
                        maximumFractionDigits: 0,
                      })}
                      <span className="ms-1 text-xs text-muted-foreground">
                        /{s.interval}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          s.state === "active"
                            ? "active"
                            : s.state === "trialing"
                              ? "trialing"
                              : s.state === "past_due"
                                ? "past_due"
                                : s.state === "expired"
                                  ? "expired"
                                  : "default"
                        }
                      >
                        {s.state}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {s.paidThroughAt
                        ? format.dateTime(new Date(s.paidThroughAt), {
                            dateStyle: "medium",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between text-sm pt-4">
              <p className="text-muted-foreground">
                {t("pageNofM", { page: subPage, total: subTotal })}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => goToPage(Math.max(1, subPage - 1))}
                  disabled={subPage <= 1}
                  className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-40 hover:bg-muted"
                >
                  {t("previous")}
                </button>
                <button
                  onClick={() =>
                    goToPage(Math.min(totalSubPages, subPage + 1))
                  }
                  disabled={subPage >= totalSubPages}
                  className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-40 hover:bg-muted"
                >
                  {t("next")}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

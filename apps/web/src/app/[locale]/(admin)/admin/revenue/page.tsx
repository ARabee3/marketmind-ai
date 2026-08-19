"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useLocale, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { StatTile } from "@/components/ui/stat-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import { Link } from "@/i18n/navigation"
import {
  getAdminRevenueSummary,
  getAdminSubscriptions,
  type AdminRevenueSummary,
  type AdminSubscriptionRow,
} from "@/lib/api/admin"
import { adminIntervalLabel, adminStatusLabel } from "@/lib/admin-labels"

type Phase = "loading" | "error" | "ready"

export default function AdminRevenuePage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("loading")
  const [revenue, setRevenue] = useState<AdminRevenueSummary | null>(null)
  const [subs, setSubs] = useState<AdminSubscriptionRow[]>([])
  const [subTotal, setSubTotal] = useState(0)
  const [subPage, setSubPage] = useState(1)
  const [dataVersion, setDataVersion] = useState(0)
  const subPageSize = 20
  const stateFilter = searchParams.get("state") ?? undefined
  const [lastStateFilter, setLastStateFilter] = useState(stateFilter)
  if (stateFilter !== lastStateFilter) {
    setLastStateFilter(stateFilter)
    setSubPage(1)
  }

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToPage = useCallback((p: number) => {
    setSubPage(p)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const [rev, subData] = await Promise.all([
          getAdminRevenueSummary(),
          getAdminSubscriptions(subPage, subPageSize, stateFilter),
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
  }, [dataVersion, subPage, stateFilter])

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
        <RevenueTableSkeleton t={t} />
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

      <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
        <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            {t("subscriptions")}
          </p>
        </div>
        <div className="grid gap-5 p-4 md:p-5">
          <div className="grid gap-1">
            <h2 className="text-2xl font-bold text-navy">
              {t("subscriptions")}
            </h2>
          </div>

          {stateFilter && (
            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
              data-testid="subscription-state-filter"
            >
              <Badge
                variant={stateFilter === "past_due" ? "past_due" : "expired"}
              >
                {stateFilter === "past_due" ? t("pastDue") : t("expired")}
              </Badge>
              <span className="text-muted-foreground">
                {t("filteredByState")}
              </span>
              <Link
                href="/admin/revenue"
                className="ms-auto rounded font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
              >
                {t("clearFilter")}
              </Link>
            </div>
          )}

          {subs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noSubscriptions")}
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border">
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
                          {(locale === "ar"
                            ? s.priceDisplayNameAr
                            : s.priceDisplayNameEn) + ` (${s.planCode})`}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {format.number(s.amountEgp, {
                            style: "currency",
                            currency: "EGP",
                            maximumFractionDigits: 0,
                          })}
                          <span className="ms-1 text-xs text-muted-foreground">
                            /{adminIntervalLabel(s.interval, t)}
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
                            {adminStatusLabel(s.state, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {s.paidThroughAt
                            ? format.dateTime(new Date(s.paidThroughAt), {
                                dateStyle: "medium",
                              })
                            : t("none")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <AdminPagination
                page={subPage}
                total={subTotal}
                pageSize={subPageSize}
                onPageChange={goToPage}
              />
            </>
          )}
        </div>
      </article>
    </section>
  )
}

function RevenueTableSkeleton({
  t,
}: {
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("subscriptions")}
        </p>
      </div>
      <div className="space-y-2 p-4 md:p-5">
        <Skeleton className="h-48" />
      </div>
    </article>
  )
}

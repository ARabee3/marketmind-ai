"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { StatTile } from "@/components/ui/stat-tile"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { Link } from "@/i18n/navigation"
import {
  getAdminRevenueSummary,
  getAdminUsers,
  type AdminRevenueSummary,
  type AdminUserRow,
} from "@/lib/api/admin"
import { adminRoleLabel } from "@/lib/admin-labels"

type Phase = "loading" | "error" | "ready"

export default function AdminOverviewPage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [revenue, setRevenue] = useState<AdminRevenueSummary | null>(null)
  const [recentUsers, setRecentUsers] = useState<AdminUserRow[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
  const [dataVersion, setDataVersion] = useState(0)

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const [rev, users] = await Promise.all([
          getAdminRevenueSummary(),
          getAdminUsers({ page: 1, pageSize: 5 }),
        ])
        if (cancelled) return
        setRevenue(rev)
        setRecentUsers(users.items)
        setUserTotal(users.total)
        setLastRefreshedAt(new Date())
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [dataVersion])

  if (phase === "loading") {
    return (
      <div className="space-y-8">
        <AdminPageHeader
          eyebrow={t("overviewEyebrow")}
          title={t("overview")}
          description={t("overviewDescription")}
        />
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
      <div className="space-y-8">
        <AdminPageHeader
          eyebrow={t("overviewEyebrow")}
          title={t("overview")}
          description={t("overviewDescription")}
        />
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{t("loadError")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      </div>
    )
  }

  const pastDue = revenue?.pastDueSubscriptions ?? 0
  const expired = revenue?.expiredSubscriptions ?? 0
  const unverified = revenue?.unverifiedUsers ?? 0
  const needsAttentionTotal = pastDue + expired + unverified

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t("overviewEyebrow")}
        title={t("overview")}
        description={t("overviewDescription")}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("totalUsers")}
          value={String(userTotal)}
          href="/admin/users"
          ariaLabel={t("totalUsersAria")}
        />
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
          href="/admin/revenue"
          ariaLabel={t("activeSubscriptionsAria")}
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
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-[0.12em]">
          {t("needsAttention")}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("needsAttentionDescription")}
        </p>
        {needsAttentionTotal === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-5 py-6 shadow-sm">
            <Badge variant="active">{t("allClear")}</Badge>
          </div>
        ) : (
          <ul className="space-y-2">
            {pastDue > 0 && (
              <NeedsAttentionRow
                label={t("pastDueSubscriptions")}
                count={pastDue}
                variant="past_due"
                href="/admin/revenue"
                ariaLabel={`${t("pastDueSubscriptions")} — ${t("viewDetails")}`}
                viewLabel={t("viewDetails")}
              />
            )}
            {expired > 0 && (
              <NeedsAttentionRow
                label={t("expiredSubscriptions")}
                count={expired}
                variant="expired"
                href="/admin/revenue"
                ariaLabel={`${t("expiredSubscriptions")} — ${t("viewDetails")}`}
                viewLabel={t("viewDetails")}
              />
            )}
            {unverified > 0 && (
              <NeedsAttentionRow
                label={t("unverifiedUsers")}
                count={unverified}
                variant="draft"
                href="/admin/users"
                ariaLabel={`${t("unverifiedUsers")} — ${t("viewDetails")}`}
                viewLabel={t("viewDetails")}
              />
            )}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-[0.12em]">
          {t("recentUsers")}
        </h2>
        {recentUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noUsers")}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("fullName")}</TableHead>
                  <TableHead>{t("email")}</TableHead>
                  <TableHead>{t("roles")}</TableHead>
                  <TableHead>{t("joined")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link
                        href="/admin/users"
                        className="font-medium text-navy hover:text-primary"
                      >
                        {u.fullName || t("none")}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge
                            key={r}
                            variant={
                              r === "ADMIN"
                                ? "admin"
                                : r === "OWNER"
                                  ? "owner"
                                  : "demo"
                            }
                          >
                            {adminRoleLabel(r, t)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {format.dateTime(new Date(u.createdAt), {
                        dateStyle: "medium",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {lastRefreshedAt && (
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {t("lastRefreshed", {
              time: format.dateTime(lastRefreshedAt, { timeStyle: "short" }),
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
          >
            {t("refresh")}
          </Button>
        </div>
      )}
    </div>
  )
}

function NeedsAttentionRow({
  label,
  count,
  variant,
  href,
  ariaLabel,
  viewLabel,
}: {
  label: string
  count: number
  variant: "past_due" | "expired" | "draft"
  href: string
  ariaLabel: string
  viewLabel: string
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Badge variant={variant}>{count}</Badge>
        <span className="text-sm font-medium text-navy">{label}</span>
      </div>
      <Link
        href={href}
        aria-label={ariaLabel}
        className="text-sm font-medium text-primary hover:text-primary/80 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 rounded"
      >
        {viewLabel}
      </Link>
    </li>
  )
}

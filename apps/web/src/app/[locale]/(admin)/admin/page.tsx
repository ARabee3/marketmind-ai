"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { Link } from "@/i18n/navigation"
import { cn } from "@/lib/utils"
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
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  if (phase === "loading") {
    return <AdminOverviewSkeleton />
  }

  if (phase === "error") {
    return (
      <section className="flex flex-col gap-5 md:gap-7">
        <AdminPageHeader
          eyebrow={t("overviewEyebrow")}
          title={t("adminConsole")}
          description={t("overviewDescription")}
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
        eyebrow={t("overviewEyebrow")}
        title={t("adminConsole")}
        description={t("overviewDescription")}
        action={
          <Link
            href="/admin/users"
            className={buttonVariants({ variant: "default", size: "lg" })}
          >
            {t("viewAllUsers")}
          </Link>
        }
      />

      <NeedsAttentionPanel revenue={revenue} t={t} />

      <MetricsPanel
        revenue={revenue}
        userTotal={userTotal}
        t={t}
        format={format}
      />

      <RecentUsersPanel
        recentUsers={recentUsers}
        t={t}
        format={format}
      />

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
    </section>
  )
}

function NeedsAttentionPanel({
  revenue,
  t,
}: {
  revenue: AdminRevenueSummary | null
  t: ReturnType<typeof useTranslations>
}) {
  const pastDue = revenue?.pastDueSubscriptions ?? 0
  const expired = revenue?.expiredSubscriptions ?? 0
  const unverified = revenue?.unverifiedUsers ?? 0
  const total = pastDue + expired + unverified

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("needsAttentionLabel")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        <div className="grid gap-2">
          <h2 className="text-2xl font-bold text-navy">
            {t("needsAttentionTitle")}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("needsAttentionDescription")}
          </p>
        </div>

          {total === 0 ? (
          <div
            className="rounded-xl border border-border bg-bg px-5 py-6"
            data-testid="admin-needs-attention"
          >
            <Badge variant="active">{t("allClear")}</Badge>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("allHealthyDescription")}
            </p>
          </div>
        ) : (
          <ul className="grid gap-2" data-testid="admin-needs-attention">
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
      </div>
    </article>
  )
}

function MetricsPanel({
  revenue,
  userTotal,
  t,
  format,
}: {
  revenue: AdminRevenueSummary | null
  userTotal: number
  t: ReturnType<typeof useTranslations>
  format: ReturnType<typeof useFormatter>
}) {
  const mrrValue = revenue
    ? format.number(revenue.mrrEgp, {
        style: "currency",
        currency: "EGP",
        maximumFractionDigits: 0,
      })
    : "0"

  const metrics: {
    label: string
    value: string
    href?: string
    ariaLabel?: string
  }[] = [
    {
      label: t("totalUsers"),
      value: String(userTotal),
      href: "/admin/users",
      ariaLabel: t("totalUsersAria"),
    },
    {
      label: t("activeBusinesses"),
      value: String(revenue?.activeBusinesses ?? 0),
    },
    {
      label: t("activeSubscriptions"),
      value: String(revenue?.activeSubscriptions ?? 0),
      href: "/admin/revenue",
      ariaLabel: t("activeSubscriptionsAria"),
    },
    {
      label: t("mrr"),
      value: mrrValue,
    },
  ]

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("metricsLabel")}
        </p>
        <h2 className="text-xl font-bold text-navy">{t("metricsTitle")}</h2>
      </div>
      <ol
        className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="admin-metrics"
      >
        {metrics.map((metric, index) => (
          <li key={metric.label}>
            <MetricCard
              index={index + 1}
              label={metric.label}
              value={metric.value}
              href={metric.href}
              ariaLabel={metric.ariaLabel}
              isActive={index === 0}
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

function MetricCard({
  index,
  label,
  value,
  href,
  ariaLabel,
  isActive,
}: {
  index: number
  label: string
  value: string
  href?: string
  ariaLabel?: string
  isActive?: boolean
}) {
  const card = (
    <div
      className={cn(
        "grid h-full gap-3 rounded-lg border p-3 transition-transform hover:-translate-y-0.5",
        isActive
          ? "border-primary bg-soft-teal shadow-sm"
          : "border-border bg-background",
      )}
    >
      <span
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
          isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {index}
      </span>
      <div className="grid gap-1">
        <h3 className="font-semibold text-navy" data-testid="metric-value">
          {value}
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">{label}</p>
      </div>
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        aria-label={ariaLabel}
        className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
      >
        {card}
      </Link>
    )
  }

  return card
}

function RecentUsersPanel({
  recentUsers,
  t,
  format,
}: {
  recentUsers: AdminUserRow[]
  t: ReturnType<typeof useTranslations>
  format: ReturnType<typeof useFormatter>
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("recentUsersLabel")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        <div className="grid gap-1">
          <h2 className="text-2xl font-bold text-navy">{t("recentUsersTitle")}</h2>
        </div>

        {recentUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRecentUsers")}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
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
      </div>
    </section>
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
    <li className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-4 py-3">
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

function AdminOverviewSkeleton() {
  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <div className="overflow-hidden rounded-xl bg-navy px-5 py-6 md:px-7 md:py-8">
        <div className="grid gap-3">
          <Skeleton className="h-3 w-28 bg-primary-foreground/20" />
          <Skeleton className="h-8 w-3/4 max-w-md bg-primary-foreground/20" />
          <Skeleton className="h-4 w-full max-w-xl bg-primary-foreground/20" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-3 h-6 w-48" />
          <Skeleton className="mt-5 h-12 w-full" />
          <Skeleton className="mt-2 h-12 w-full" />
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-5 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-full" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
        <Skeleton className="h-4 w-32" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-5 h-48 w-full" />
      </div>
    </section>
  )
}

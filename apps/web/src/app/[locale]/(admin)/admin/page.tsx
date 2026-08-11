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

type Phase = "loading" | "error" | "ready"

export default function AdminOverviewPage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [revenue, setRevenue] = useState<AdminRevenueSummary | null>(null)
  const [recentUsers, setRecentUsers] = useState<AdminUserRow[]>([])
  const [userTotal, setUserTotal] = useState(0)
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
                            {r.toLowerCase()}
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
    </div>
  )
}

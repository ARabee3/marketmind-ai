"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { ScrollText } from "lucide-react"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import { getAdminAudit, type AdminAuditRow } from "@/lib/api/admin"

type Phase = "loading" | "error" | "ready"

function formatState(state: unknown): string {
  if (state === null || state === undefined) return ""
  try {
    const text = JSON.stringify(state)
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return String(state)
  }
}

export default function AdminAuditPage() {
  const t = useTranslations("Admin")
  const [phase, setPhase] = useState<Phase>("loading")
  const [items, setItems] = useState<AdminAuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState("")
  const [actorFilter, setActorFilter] = useState("")
  const [fromFilter, setFromFilter] = useState("")
  const [toFilter, setToFilter] = useState("")
  const [actionInput, setActionInput] = useState("")
  const [actorInput, setActorInput] = useState("")
  const [fromInput, setFromInput] = useState("")
  const [toInput, setToInput] = useState("")
  const [dataVersion, setDataVersion] = useState(0)
  const pageSize = 20

  const filtersActive = Boolean(
    actionFilter || actorFilter || fromFilter || toFilter,
  )

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToPage = useCallback((p: number) => {
    setPage(p)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetchAudit() {
      setPhase("loading")
      try {
        const from = fromFilter ? new Date(`${fromFilter}T00:00:00`).toISOString() : undefined
        const to = toFilter ? new Date(`${toFilter}T23:59:59`).toISOString() : undefined
        const result = await getAdminAudit({
          page,
          pageSize,
          action: actionFilter || undefined,
          actor: actorFilter || undefined,
          from,
          to,
        })
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetchAudit()
    return () => {
      cancelled = true
    }
  }, [dataVersion, page, actionFilter, actorFilter, fromFilter, toFilter])

  const applyFilters = () => {
    setPage(1)
    setActionFilter(actionInput)
    setActorFilter(actorInput)
    setFromFilter(fromInput)
    setToFilter(toInput)
    setDataVersion((v) => v + 1)
  }

  const clearFilters = () => {
    setActionInput("")
    setActorInput("")
    setFromInput("")
    setToInput("")
    setActionFilter("")
    setActorFilter("")
    setFromFilter("")
    setToFilter("")
    setPage(1)
    setDataVersion((v) => v + 1)
  }

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <AdminPageHeader
        eyebrow={t("auditEyebrow")}
        title={t("audit")}
        description={t("auditDescription")}
      />

      <AuditFilters
        actionInput={actionInput}
        actorInput={actorInput}
        fromInput={fromInput}
        toInput={toInput}
        onActionChange={setActionInput}
        onActorChange={setActorInput}
        onFromChange={setFromInput}
        onToChange={setToInput}
        onApply={applyFilters}
        onClear={clearFilters}
        filtersActive={filtersActive}
      />

      {phase === "loading" && <AuditTableSkeleton />}

      {phase === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-5 py-8 shadow-elevated">
          <p className="text-muted-foreground">{t("loadError")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <AuditTable
          items={items}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
        />
      )}
    </section>
  )
}

function AuditFilters({
  actionInput,
  actorInput,
  fromInput,
  toInput,
  onActionChange,
  onActorChange,
  onFromChange,
  onToChange,
  onApply,
  onClear,
  filtersActive,
}: {
  actionInput: string
  actorInput: string
  fromInput: string
  toInput: string
  onActionChange: (value: string) => void
  onActorChange: (value: string) => void
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onApply: () => void
  onClear: () => void
  filtersActive: boolean
}) {
  const t = useTranslations("Admin")

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("auditFiltersLabel")}
        </p>
      </div>
      <div className="p-4 md:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onApply()
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <label htmlFor="admin-audit-action" className="text-sm font-medium text-navy">
                {t("auditActionFilter")}
              </label>
              <Input
                id="admin-audit-action"
                type="text"
                autoComplete="off"
                value={actionInput}
                onChange={(e) => onActionChange(e.target.value)}
                placeholder={t("auditActionPlaceholder")}
                className="h-10"
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="admin-audit-actor" className="text-sm font-medium text-navy">
                {t("auditActor")}
              </label>
              <Input
                id="admin-audit-actor"
                type="text"
                autoComplete="off"
                value={actorInput}
                onChange={(e) => onActorChange(e.target.value)}
                placeholder={t("auditActorPlaceholder")}
                className="h-10"
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="admin-audit-from" className="text-sm font-medium text-navy">
                {t("auditFrom")}
              </label>
              <Input
                id="admin-audit-from"
                type="date"
                value={fromInput}
                onChange={(e) => onFromChange(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="admin-audit-to" className="text-sm font-medium text-navy">
                {t("auditTo")}
              </label>
              <Input
                id="admin-audit-to"
                type="date"
                value={toInput}
                onChange={(e) => onToChange(e.target.value)}
                className="h-10"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="lg" className="h-10">
              {t("auditApply")}
            </Button>
            {filtersActive && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-10"
                onClick={onClear}
              >
                {t("auditClearFilters")}
              </Button>
            )}
            {filtersActive && (
              <span className="text-sm text-muted-foreground">
                {t("auditFiltersActive")}
              </span>
            )}
          </div>
        </form>
      </div>
    </article>
  )
}

function AuditTable({
  items,
  total,
  page,
  pageSize,
  onPageChange,
}: {
  items: AdminAuditRow[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const t = useTranslations("Admin")
  const format = useFormatter()

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          <ScrollText className="size-4" aria-hidden="true" />
          {t("audit")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">{t("noAuditLogs")}</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("auditTime")}</TableHead>
                    <TableHead>{t("auditAction")}</TableHead>
                    <TableHead>{t("auditActor")}</TableHead>
                    <TableHead>{t("auditTargetType")}</TableHead>
                    <TableHead>{t("auditTargetId")}</TableHead>
                    <TableHead>{t("auditReason")}</TableHead>
                    <TableHead>{t("auditBefore")}</TableHead>
                    <TableHead>{t("auditAfter")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {format.dateTime(new Date(item.createdAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="admin">{item.action}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.actorEmail || item.actorUserId}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.targetType}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
                        {item.targetId || t("auditStateNone")}
                      </TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground">
                        <span className="line-clamp-2">{item.reason || t("auditStateNone")}</span>
                      </TableCell>
                      <TableCell className="max-w-[220px] font-mono text-xs text-muted-foreground">
                        {formatState(item.beforeState) || t("auditStateNone")}
                      </TableCell>
                      <TableCell className="max-w-[220px] font-mono text-xs text-muted-foreground">
                        {formatState(item.afterState) || t("auditStateNone")}
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

function AuditTableSkeleton() {
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
      <p className="sr-only">{t("audit")}</p>
    </article>
  )
}
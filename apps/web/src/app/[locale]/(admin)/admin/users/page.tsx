"use client"

import { useCallback, useEffect, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { X, Monitor, MapPin, Calendar } from "lucide-react"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getAdminUsers,
  getAdminUser,
  type AdminUserRow,
  type AdminUserDetail,
} from "@/lib/api/admin"

type Phase = "loading" | "error" | "ready"

export default function AdminUsersPage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const pageSize = 20

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToPage = useCallback((p: number) => {
    setPage(p)
    setDataVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const result = await getAdminUsers({ page, pageSize, search })
        if (cancelled) return
        setUsers(result.items)
        setTotal(result.total)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [dataVersion, page, search])

  const handleSearch = () => {
    setPage(1)
    setSearch(searchInput)
    setDataVersion((v) => v + 1)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-navy">{t("users")}</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSearch()
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchUsers")}
          className="h-10 w-full max-w-sm rounded-lg border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          {t("search")}
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("")
              setSearch("")
              setPage(1)
              setDataVersion((v) => v + 1)
            }}
            className="rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-muted"
          >
            {t("clear")}
          </button>
        )}
      </form>

      {phase === "loading" && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}

      {phase === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{t("loadError")}</p>
          <button
            onClick={retry}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {phase === "ready" && users.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noUsers")}</p>
      )}

      {phase === "ready" && users.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fullName")}</TableHead>
                <TableHead>{t("email")}</TableHead>
                <TableHead>{t("roles")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("joined")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedUserId(u.id)}
                >
                  <TableCell className="font-medium text-navy">
                    {u.fullName || t("none")}
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
                  <TableCell>
                    <Badge
                      variant={u.status === "active" ? "active" : "draft"}
                    >
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {format.dateTime(new Date(u.createdAt), {
                      dateStyle: "medium",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">
              {t("pageNofM", { page, total })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => goToPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-40 hover:bg-muted"
              >
                {t("previous")}
              </button>
              <button
                onClick={() => goToPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-40 hover:bg-muted"
              >
                {t("next")}
              </button>
            </div>
          </div>
        </>
      )}

      {selectedUserId && (
        <UserDetailPanel
          id={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  )
}

function UserDetailPanel({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [version, setVersion] = useState(0)

  const doRetry = useCallback(() => {
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const data = await getAdminUser(id)
        if (cancelled) return
        setDetail(data)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetch()
    return () => { cancelled = true }
  }, [id, version])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-navy/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-surface shadow-xl border-s border-border">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 className="text-lg font-bold text-navy">{t("userDetail")}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("close")}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-6">
          {phase === "loading" && (
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-12">
              <p className="text-muted-foreground">{t("loadError")}</p>
              <button
                onClick={doRetry}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
              >
                {t("retry")}
              </button>
            </div>
          )}

          {phase === "ready" && detail && (
            <div className="space-y-8">
              <div>
                <h3 className="text-base font-bold text-navy">
                  {detail.user.fullName || t("none")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {detail.user.email}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatPill
                  label={t("roles")}
                  value={detail.user.roles.join(", ")}
                />
                <StatPill
                  label={t("status")}
                  value={detail.user.status}
                />
                <StatPill
                  label={t("joined")}
                  value={format.dateTime(
                    new Date(detail.user.createdAt),
                    { dateStyle: "medium" },
                  )}
                />
                <StatPill
                  label={t("lastLogin")}
                  value={
                    detail.user.lastLoginAt
                      ? format.dateTime(
                          new Date(detail.user.lastLoginAt),
                          { dateStyle: "medium" },
                        )
                      : t("neverLoggedIn")
                  }
                />
              </div>

              {detail.businesses.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                    {t("businesses")} ({detail.businesses.length})
                  </h3>
                  <div className="space-y-2">
                    {detail.businesses.map((b) => (
                      <div
                        key={b.id}
                        className="rounded-lg border border-border p-3"
                      >
                        <p className="text-sm font-medium text-navy">
                          {b.displayName}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <Badge
                            variant={
                              b.status === "active" ? "active" : "draft"
                            }
                          >
                            {b.status}
                          </Badge>
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="size-3" />
                            {format.dateTime(new Date(b.createdAt), {
                              dateStyle: "medium",
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {detail.activeSessions.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                    {t("activeSessions")} ({detail.activeSessions.length})
                  </h3>
                  <div className="space-y-2">
                    {detail.activeSessions.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-lg border border-border p-3"
                      >
                        <div className="flex items-start gap-2">
                          <Monitor className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-muted-foreground">
                              {s.userAgent || t("none")}
                            </p>
                            {s.ipAddress && (
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                <MapPin className="size-3" />
                                {s.ipAddress}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {detail.federatedIdentities.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                    {t("federatedIdentities")} (
                    {detail.federatedIdentities.length})
                  </h3>
                  <div className="space-y-2">
                    {detail.federatedIdentities.map((fi) => (
                      <div
                        key={fi.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-navy">
                            {fi.provider}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {fi.email || fi.displayName || t("none")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatPill({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.1em]">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-navy">
        {value}
      </p>
    </div>
  )
}

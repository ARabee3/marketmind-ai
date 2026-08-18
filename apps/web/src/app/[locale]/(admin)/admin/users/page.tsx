"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { X, Monitor, MapPin, Calendar } from "lucide-react"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import { Link } from "@/i18n/navigation"
import {
  getAdminUsers,
  getAdminUser,
  type AdminUserRow,
  type AdminUserDetail,
} from "@/lib/api/admin"
import {
  adminLoginMethodLabel,
  adminRoleLabel,
  adminStatusLabel,
} from "@/lib/admin-labels"

type Phase = "loading" | "error" | "ready"

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function AdminUsersPage() {
  const t = useTranslations("Admin")
  const format = useFormatter()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("loading")
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const pageSize = 20
  const verifiedParam = searchParams.get("verified")
  const verifiedFilter =
    verifiedParam === "true"
      ? true
      : verifiedParam === "false"
        ? false
        : undefined
  const closeUserDetails = useCallback(() => {
    setSelectedUserId(null)
  }, [])

  const retry = useCallback(() => {
    setDataVersion((v) => v + 1)
  }, [])

  const goToPage = useCallback((p: number) => {
    setPage(p)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [verifiedParam])

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setPhase("loading")
      try {
        const result = await getAdminUsers({ page, pageSize, search, verified: verifiedFilter })
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
  }, [dataVersion, page, search, verifiedFilter])

  const handleSearch = () => {
    setPage(1)
    setSearch(searchInput)
    setDataVersion((v) => v + 1)
  }

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <AdminPageHeader
        eyebrow={t("usersEyebrow")}
        title={t("users")}
        description={t("usersDescription")}
      />

      <SearchCard
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onSearch={handleSearch}
        search={search}
        onClear={() => {
          setSearchInput("")
          setSearch("")
          setPage(1)
          setDataVersion((v) => v + 1)
        }}
        t={t}
      />

      {verifiedFilter === false && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
          data-testid="user-verification-filter"
        >
          <Badge variant="draft">{t("unverified")}</Badge>
          <span className="text-muted-foreground">
            {t("filteredByVerified")}
          </span>
          <Link
            href="/admin/users"
            className="ms-auto rounded font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
          >
            {t("clearFilter")}
          </Link>
        </div>
      )}

      {phase === "loading" && <UsersTableSkeleton />}

      {phase === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-5 py-8 shadow-elevated">
          <p className="text-muted-foreground">{t("loadError")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <UsersTableCard
          users={users}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
          onSelectUser={setSelectedUserId}
          t={t}
          format={format}
        />
      )}

      {selectedUserId && (
        <UserDetailPanel
          id={selectedUserId}
          onClose={closeUserDetails}
        />
      )}
    </section>
  )
}

function SearchCard({
  searchInput,
  onSearchInputChange,
  onSearch,
  search,
  onClear,
  t,
}: {
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearch: () => void
  search: string
  onClear: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("search")}
        </p>
      </div>
      <div className="p-4 md:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSearch()
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="admin-user-search" className="sr-only">
            {t("searchLabel")}
          </label>
          <Input
            id="admin-user-search"
            name="search"
            autoComplete="off"
            type="search"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            placeholder={t("searchUsers")}
            className="h-10 w-full sm:max-w-sm"
          />
          <Button type="submit" size="lg" className="h-10">
            {t("search")}
          </Button>
          {search && (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-10"
              onClick={onClear}
            >
              {t("clear")}
            </Button>
          )}
        </form>
      </div>
    </article>
  )
}

function UsersTableCard({
  users,
  total,
  page,
  pageSize,
  onPageChange,
  onSelectUser,
  t,
  format,
}: {
  users: AdminUserRow[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onSelectUser: (id: string) => void
  t: ReturnType<typeof useTranslations>
  format: ReturnType<typeof useFormatter>
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t("users")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        <div className="grid gap-1">
          <h2 className="text-2xl font-bold text-navy">
            {t("recentUsers")}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("usersDescription")}
          </p>
        </div>

        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noUsers")}</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("fullName")}</TableHead>
                    <TableHead>{t("email")}</TableHead>
                    <TableHead>{t("emailVerified")}</TableHead>
                    <TableHead>{t("roles")}</TableHead>
                    <TableHead>{t("loginMethod")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                    <TableHead>{t("businesses")}</TableHead>
                    <TableHead>{t("activeSessions")}</TableHead>
                    <TableHead>{t("joined")}</TableHead>
                    <TableHead>{t("lastLogin")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const displayName = u.fullName || t("none")
                    return (
                      <TableRow
                        key={u.id}
                        role="button"
                        tabIndex={0}
                        aria-label={t("openUserDetails", { name: displayName })}
                        className="cursor-pointer touch-manipulation focus-visible:bg-soft-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
                        onClick={() => onSelectUser(u.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            onSelectUser(u.id)
                          }
                        }}
                      >
                        <TableCell className="font-medium text-navy">
                          {displayName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {u.email}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={u.isEmailVerified ? "active" : "draft"}
                          >
                            {u.isEmailVerified ? t("verified") : t("unverified")}
                          </Badge>
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
                        <TableCell className="text-muted-foreground">
                          {adminLoginMethodLabel(u.loginMethod, t)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={u.status === "active" ? "active" : "draft"}
                          >
                            {adminStatusLabel(u.status, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {u.businessCount}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {u.activeSessionCount}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {format.dateTime(new Date(u.createdAt), {
                            dateStyle: "medium",
                          })}
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {u.lastLoginAt
                            ? format.dateTime(new Date(u.lastLoginAt), {
                                dateStyle: "medium",
                              })
                            : t("neverLoggedIn")}
                        </TableCell>
                      </TableRow>
                    )
                  })}
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

function UsersTableSkeleton() {
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-2 p-4 md:p-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    </article>
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
  const panelRef = useRef<HTMLElement>(null)

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
    const panel = panelRef.current
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    const getFocusableElements = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.hidden &&
              element.getAttribute("aria-hidden") !== "true",
          )
        : []

    const firstFocusable = getFocusableElements()[0]
    if (firstFocusable) {
      firstFocusable.focus()
    } else {
      panel?.focus()
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== "Tab" || !panel) return

      const focusable = getFocusableElements()
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const activeElement = document.activeElement

      if (event.shiftKey) {
        if (activeElement === first || !panel.contains(activeElement)) {
          event.preventDefault()
          last.focus()
        }
      } else if (activeElement === last || !panel.contains(activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handler)
    return () => {
      document.removeEventListener("keydown", handler)
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t("close")}
        tabIndex={-1}
        className="absolute inset-0 bg-navy/20 backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-user-detail-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto overscroll-contain border-s border-border bg-surface shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <h2 id="admin-user-detail-title" className="text-lg font-bold text-navy">
            {t("userDetail")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X className="size-5" />
          </Button>
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
              <Button type="button" onClick={doRetry}>
                {t("retry")}
              </Button>
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
                  value={detail.user.roles
                    .map((role) => adminRoleLabel(role, t))
                    .join(", ")}
                />
                <StatPill
                  label={t("emailVerified")}
                  value={
                    detail.user.isEmailVerified
                      ? t("verified")
                      : t("unverified")
                  }
                />
                <StatPill
                  label={t("loginMethod")}
                  value={adminLoginMethodLabel(detail.user.loginMethod, t)}
                />
                <StatPill
                  label={t("status")}
                  value={adminStatusLabel(detail.user.status, t)}
                />
                <StatPill
                  label={t("businesses")}
                  value={String(detail.user.businessCount)}
                />
                <StatPill
                  label={t("activeSessions")}
                  value={String(detail.user.activeSessionCount)}
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
                            {adminStatusLabel(b.status, t)}
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
                            {adminLoginMethodLabel(fi.provider, t)}
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
      </aside>
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

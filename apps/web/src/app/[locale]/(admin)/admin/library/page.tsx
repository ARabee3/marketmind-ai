"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { BookMarked, RefreshCw } from "lucide-react"
import { AdminPageHeader } from "@/components/layout/admin-page-header"
import { AdminPagination } from "@/components/layout/admin-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  approveKnowledgeLibraryEntry,
  listKnowledgeLibraryEntries,
  rejectKnowledgeLibraryEntry,
  triggerKnowledgeLibraryIngest,
  type KnowledgeLibraryEntryRow,
} from "@/lib/api/knowledge-library-admin"
import {
  knowledgeEvidenceTierLabel,
  knowledgeKindLabel,
  knowledgeLocaleLabel,
  knowledgeReviewStatusLabel,
} from "@/lib/admin-labels"
import { cn } from "@/lib/utils"

type Phase = "loading" | "error" | "ready"

export default function AdminLibraryPage() {
  const t = useTranslations("Admin")
  const [phase, setPhase] = useState<Phase>("loading")
  const [items, setItems] = useState<KnowledgeLibraryEntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>("")
  const [search, setSearch] = useState("")
  const [dataVersion, setDataVersion] = useState(0)
  const [ingestState, setIngestState] = useState<
    "idle" | "running" | "done" | "failed"
  >("idle")
  const pageSize = 20

  const retry = useCallback(() => {
    setDataVersion((version) => version + 1)
  }, [])

  const goToPage = useCallback((next: number) => {
    setPage(next)
  }, [])

  const selectStatus = (value: string) => {
    setPage(1)
    setStatus(value)
    setDataVersion((version) => version + 1)
  }

  const runIngest = async () => {
    setIngestState("running")
    try {
      await triggerKnowledgeLibraryIngest()
      setIngestState("done")
      setDataVersion((version) => version + 1)
    } catch {
      setIngestState("failed")
    }
  }

  useEffect(() => {
    let cancelled = false
    async function fetchEntries() {
      setPhase("loading")
      try {
        const result = await listKnowledgeLibraryEntries({
          status: status || undefined,
          search: search.trim() || undefined,
          page,
          pageSize,
        })
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setPhase("ready")
      } catch {
        if (!cancelled) setPhase("error")
      }
    }
    void fetchEntries()
    return () => {
      cancelled = true
    }
  }, [dataVersion, page, status, search, pageSize])

  return (
    <section className="flex flex-col gap-5 md:gap-7">
      <AdminPageHeader
        eyebrow={t("libraryEyebrow")}
        title={t("library")}
        description={t("libraryDescription")}
        action={
          <Button
            type="button"
            onClick={runIngest}
            disabled={ingestState === "running"}
            className="bg-journey-mint text-navy hover:bg-journey-mint/80"
          >
            <RefreshCw
              className={cn(
                "size-4",
                ingestState === "running" && "animate-spin",
              )}
              aria-hidden="true"
            />
            {ingestState === "running"
              ? t("ingestRunning")
              : t("triggerIngest")}
          </Button>
        }
      />

      {ingestState === "done" && (
        <p
          aria-live="polite"
          className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary"
        >
          {t("ingestComplete")}
        </p>
      )}
      {ingestState === "failed" && (
        <p
          role="alert"
          className="rounded-lg border border-danger/20 bg-danger/10 px-4 py-2 text-sm text-danger"
        >
          {t("ingestFailed")}
        </p>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <StatusFilters current={status} onSelect={selectStatus} />
        <div className="grid gap-1 md:w-72">
          <label
            htmlFor="library-search"
            className="sr-only"
          >
            {t("librarySearchLabel")}
          </label>
          <Input
            id="library-search"
            type="search"
            autoComplete="off"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
              setDataVersion((version) => version + 1)
            }}
            placeholder={t("librarySearchPlaceholder")}
            className="h-10"
          />
        </div>
      </div>

      {phase === "loading" && <LibraryTableSkeleton />}

      {phase === "error" && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-xl border border-border bg-surface px-5 py-8 shadow-elevated">
          <p className="text-muted-foreground">{t("loadFailedLibrary")}</p>
          <Button type="button" onClick={retry}>
            {t("retry")}
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <LibraryTable
          items={items}
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={goToPage}
          onChanged={retry}
        />
      )}
    </section>
  )
}

function StatusFilters({
  current,
  onSelect,
}: {
  current: string
  onSelect: (value: string) => void
}) {
  const t = useTranslations("Admin")

  const options: { value: string; label: string }[] = [
    { value: "", label: t("libraryStatusAll") },
    { value: "draft", label: t("draft") },
    { value: "approved", label: t("approved") },
    { value: "retired", label: t("retired") },
    { value: "expired", label: t("expired") },
  ]

  return (
    <div
      role="group"
      aria-label={t("libraryDescription")}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const active = current === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(option.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-3 focus-visible:ring-ring/40",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-surface text-muted-foreground hover:bg-muted hover:text-navy",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function LibraryTable({
  items,
  total,
  page,
  pageSize,
  onPageChange,
  onChanged,
}: {
  items: KnowledgeLibraryEntryRow[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onChanged: () => void
}) {
  const t = useTranslations("Admin")

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          <BookMarked className="size-4" aria-hidden="true" />
          {t("library")}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {t("noLibraryEntries")}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("libraryTitle")}</TableHead>
                    <TableHead>{t("libraryKind")}</TableHead>
                    <TableHead>{t("libraryLocale")}</TableHead>
                    <TableHead>{t("libraryReviewStatus")}</TableHead>
                    <TableHead>{t("libraryEvidenceTier")}</TableHead>
                    <TableHead>{t("libraryVersion")}</TableHead>
                    <TableHead className="text-end">{t("libraryActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.entry.id}>
                      <TableCell className="max-w-[260px]">
                        <p className="truncate font-semibold text-navy">
                          {item.latest?.title ?? item.entry.slug}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.entry.slug}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">
                          {item.latest
                            ? knowledgeKindLabel(item.latest.kind, t)
                            : t("notApplicable")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.latest
                          ? knowledgeLocaleLabel(item.latest.locale, t)
                          : t("notApplicable")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            item.latest?.reviewStatus === "approved"
                              ? "active"
                              : item.latest?.reviewStatus === "expired"
                                ? "expired"
                                : item.latest?.reviewStatus === "retired"
                                  ? "past_due"
                                  : "draft"
                          }
                        >
                          {item.latest
                            ? knowledgeReviewStatusLabel(
                                item.latest.reviewStatus,
                                t,
                              )
                            : t("notApplicable")}
                        </Badge>
                        {item.latest?.reviewer && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t("libraryReviewedBy", {
                              reviewer: item.latest.reviewer,
                            })}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="admin">
                          {item.latest
                            ? knowledgeEvidenceTierLabel(
                                item.latest.evidenceTier,
                                t,
                              )
                            : t("notApplicable")}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {item.latest?.version ?? t("notApplicable")}
                        <p className="text-xs">
                          {t("libraryVersionsCount", {
                            count: item.versionCount,
                          })}
                        </p>
                      </TableCell>
                      <TableCell className="text-end">
                        {item.latest?.reviewStatus === "draft" ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <ApproveDialog entry={item} onDone={onChanged} />
                            <RejectDialog entry={item} onDone={onChanged} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("libraryNoReviewAction")}
                          </span>
                        )}
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

function ApproveDialog({
  entry,
  onDone,
}: {
  entry: KnowledgeLibraryEntryRow
  onDone: () => void
}) {
  const t = useTranslations("Admin")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (next) {
      setError(false)
      setSuccess(false)
    }
    setOpen(next)
  }

  const submit = async () => {
    setBusy(true)
    setError(false)
    try {
      await approveKnowledgeLibraryEntry(entry.entry.slug)
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
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            {t("approveEntry")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("approveEntryTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("approveEntryDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <p className="font-semibold text-navy">
            {entry.latest?.title ?? entry.entry.slug}
          </p>
          <p className="text-xs text-muted-foreground">{entry.entry.slug}</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {t("approveEntryFailed")}
          </p>
        )}
        {success && (
          <p
            aria-live="polite"
            className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            {t("approveEntryComplete")}
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
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? t("approvingEntry") : t("approveEntry")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RejectDialog({
  entry,
  onDone,
}: {
  entry: KnowledgeLibraryEntryRow
  onDone: () => void
}) {
  const t = useTranslations("Admin")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    if (next) {
      setError(false)
      setSuccess(false)
    }
    setOpen(next)
  }

  const submit = async () => {
    setBusy(true)
    setError(false)
    try {
      await rejectKnowledgeLibraryEntry(entry.entry.slug)
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            {t("rejectEntry")}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rejectEntryTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("rejectEntryDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm">
          <p className="font-semibold text-navy">
            {entry.latest?.title ?? entry.entry.slug}
          </p>
          <p className="text-xs text-muted-foreground">{entry.entry.slug}</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {t("rejectEntryFailed")}
          </p>
        )}
        {success && (
          <p
            aria-live="polite"
            className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary"
          >
            {t("rejectEntryComplete")}
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
            variant="destructive"
            onClick={submit}
            disabled={busy}
          >
            {busy ? t("rejectingEntry") : t("rejectEntry")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function LibraryTableSkeleton() {
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
      <p className="sr-only">{t("library")}</p>
    </article>
  )
}
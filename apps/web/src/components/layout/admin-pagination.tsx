"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

export function getAdminTotalPages(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function AdminPagination({
  page,
  total,
  pageSize,
  onPageChange,
}: {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const t = useTranslations("Admin")
  const totalPages = getAdminTotalPages(total, pageSize)

  return (
    <nav
      aria-label={t("paginationLabel")}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4 text-sm"
    >
      <p aria-live="polite" className="text-muted-foreground">
        {t("pageOfPages", { page, totalPages })}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("previousPage")}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          {t("previous")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("nextPage")}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          {t("next")}
        </Button>
      </div>
    </nav>
  )
}

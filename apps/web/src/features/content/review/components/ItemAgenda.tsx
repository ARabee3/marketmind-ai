'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { CheckCircle2, AlertTriangle, Clock, XCircle, FileEdit } from 'lucide-react'
import type { ContentItem } from '@marketmind/contracts'
import type { ContentPackWorkspaceItem } from '../types/review.types'
import { checkItemEligibility } from '../utils/eligibility'

type ItemAgendaProps = {
  items: readonly ContentPackWorkspaceItem[]
  selectedItemId: string | null
  onSelectItem: (itemId: string) => void
}

export function ItemAgenda({
  items,
  selectedItemId,
  onSelectItem,
}: ItemAgendaProps) {
  const t = useTranslations('ContentReview.agenda')
  const format = useFormatter()

  const currentCount = items.filter(
    (i) => i.item.status === 'draft' || i.item.status === 'revising',
  ).length
  const blockedCount = items.filter((i) => !checkItemEligibility(i).eligible).length
  const approvedCount = items.filter((i) => i.item.status === 'approved').length

  const statusLabel = (status: ContentItem["status"]) => {
    if (t.has(`status.${status}`)) {
      return t.raw(`status.${status}`) as string
    }
    return status.replace(/_/g, ' ')
  }

  const getStatusBadge = (status: ContentItem["status"]) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary border border-primary/30">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            {statusLabel(status)}
          </span>
        )
      case 'revision_requested':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning border border-warning/30">
            <FileEdit className="h-3 w-3" aria-hidden="true" />
            {statusLabel(status)}
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger border border-danger/30">
            <XCircle className="h-3 w-3" aria-hidden="true" />
            {statusLabel(status)}
          </span>
        )
      case 'revising':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-action/15 px-2 py-0.5 text-xs font-semibold text-action border border-action/30">
            <Clock className="h-3 w-3 animate-spin" aria-hidden="true" />
            {statusLabel(status)}
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground border border-border">
            {statusLabel(status)}
          </span>
        )
    }
  }

  const dayLabel = (startsAt: string) =>
    format.dateTime(new Date(startsAt), { weekday: 'short' })

  return (
    <nav
      aria-label={t('title')}
      className="border-b border-border bg-surface py-3 px-4 sm:px-6 mb-6"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-navy">
              {t('title')}
            </h2>
            <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
          </div>
          <span className="text-xs font-medium text-navy bg-muted px-2.5 py-1 rounded border border-border">
            {t('itemCountLabel', {
              current: currentCount,
              blocked: blockedCount,
              approved: approvedCount,
            })}
          </span>
        </div>

        {/* Mobile Dropdown Selector */}
        <div className="sm:hidden">
          <label htmlFor="mobile-item-agenda-select" className="sr-only">
            {t('selectorLabel')}
          </label>
          <select
            id="mobile-item-agenda-select"
            value={selectedItemId ?? ''}
            onChange={(e) => onSelectItem(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-navy outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {items.map((item, index) => (
              <option key={item.item.id} value={item.item.id}>
                {index + 1}. {dayLabel(item.current_version.recommended_publish_window.starts_at)} ·{' '}
                {item.current_version.channel.toUpperCase()} ({statusLabel(item.item.status)})
              </option>
            ))}
          </select>
        </div>

        {/* Desktop Ordered Semantic List */}
        <ol className="hidden sm:flex flex-wrap gap-2">
          {items.map((item, index) => {
            const isSelected = item.item.id === selectedItemId
            const eligibility = checkItemEligibility(item)

            return (
              <li key={item.item.id}>
                <button
                  type="button"
                  onClick={() => onSelectItem(item.item.id)}
                  aria-pressed={isSelected}
                  className={`flex flex-col gap-1 text-start rounded-lg border p-3 text-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isSelected
                      ? 'border-primary bg-primary/10 shadow-sm font-medium text-navy ring-1 ring-primary'
                      : 'border-border bg-surface text-navy hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-navy">
                      {index + 1}. {dayLabel(item.current_version.recommended_publish_window.starts_at)}
                    </span>
                    <span className="uppercase text-xs font-semibold tracking-wider text-muted-foreground">
                      {item.current_version.channel}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-0.5">
                    {getStatusBadge(item.item.status)}
                    {!eligibility.eligible && (
                      <span
                        className="inline-flex items-center text-warning"
                        title={eligibility.reasons.join(', ')}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">{t('ineligible')}</span>
                      </span>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </nav>
  )
}

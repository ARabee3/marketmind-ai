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
          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            {statusLabel(status)}
          </span>
        )
      case 'revision_requested':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 border border-amber-300">
            <FileEdit className="h-3 w-3" />
            {statusLabel(status)}
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 border border-red-300">
            <XCircle className="h-3 w-3" />
            {statusLabel(status)}
          </span>
        )
      case 'revising':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800 border border-sky-300">
            <Clock className="h-3 w-3 animate-spin" />
            {statusLabel(status)}
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 border border-slate-300">
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
      className="border-b border-[var(--color-border)] bg-[var(--color-surface)] py-3 px-4 sm:px-6 mb-6"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-navy)]">
              {t('title')}
            </h2>
            <p className="text-xs text-slate-500">{t('subtitle')}</p>
          </div>
          <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
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
            className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-navy)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
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
                  className={`flex flex-col gap-1 text-start rounded-lg border p-3 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] ${
                    isSelected
                      ? 'border-[var(--color-primary)] bg-teal-50/50 shadow-sm font-medium text-[var(--color-navy)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)] bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-slate-900">
                      {index + 1}. {dayLabel(item.current_version.recommended_publish_window.starts_at)}
                    </span>
                    <span className="uppercase text-xs font-semibold tracking-wider text-slate-500">
                      {item.current_version.channel}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-0.5">
                    {getStatusBadge(item.item.status)}
                    {!eligibility.eligible && (
                      <span
                        className="inline-flex items-center text-amber-700"
                        title={eligibility.reasons.join(', ')}
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
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

'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { CheckSquare, Square, ShieldCheck, Loader2, AlertCircle } from 'lucide-react'
import type { ContentPackWorkspaceItem } from '../types/review.types'
import { useBulkDecision } from '../hooks/useBulkDecision'
import { isItemActionable } from '../utils/eligibility'

type BulkApprovalBarProps = {
  packId: string
  items: readonly ContentPackWorkspaceItem[]
  onBulkComplete?: () => void
}

export function BulkApprovalBar({
  packId,
  items,
  onBulkComplete,
}: BulkApprovalBarProps) {
  const t = useTranslations('ContentReview.bulk')
  const tErr = useTranslations('ContentReview.errors')
  const format = useFormatter()

  const {
    selectedItemIds,
    toggleSelectItem,
    selectAllEligible,
    deselectAll,
    submitBulk,
    resetBulkState,
    bulkState,
  } = useBulkDecision(packId, items, onBulkComplete)

  const isSubmitting = bulkState.status === 'submitting'
  const eligibleCount = items.filter((item) => isItemActionable(item)).length

  const localizeError = (code: string): string =>
    tErr(code as Parameters<typeof tErr>[0]) || code

  const dayLabel = (startsAt: string) =>
    format.dateTime(new Date(startsAt), { weekday: 'short' })

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs mb-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-navy)] uppercase tracking-wider">
            {t('title')}
          </h3>
          <p className="text-xs text-slate-500">{t('subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={selectAllEligible}
            className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          >
            {t('selectAllEligible')} ({eligibleCount})
          </button>
          {selectedItemIds.length > 0 && (
            <button
              type="button"
              onClick={deselectAll}
              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {t('deselectAll')}
            </button>
          )}
        </div>
      </div>

      {/* Item Checklist Selection */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {items.map((item, idx) => {
          const isSelected = selectedItemIds.includes(item.item.id)
          const isActionable = isItemActionable(item)
          const isImmutable = item.publication_candidate !== null

          return (
            <button
              key={item.item.id}
              type="button"
              onClick={() => toggleSelectItem(item.item.id)}
              disabled={!isActionable}
              aria-pressed={isSelected}
              className={`flex items-center justify-between p-2.5 rounded-lg border text-xs text-start transition-all ${
                isSelected
                  ? 'border-[var(--color-primary)] bg-teal-50/70 font-semibold text-[var(--color-navy)]'
                  : isActionable
                    ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    : 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-2">
                {isSelected ? (
                  <CheckSquare className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
                ) : (
                  <Square className="h-4 w-4 text-slate-400 shrink-0" />
                )}
                <span>
                  {idx + 1}. {dayLabel(item.current_version.recommended_publish_window.starts_at)} ·{' '}
                  {item.current_version.channel.toUpperCase()}
                </span>
              </div>

              {isImmutable ? (
                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                  {t('approvedLabel')}
                </span>
              ) : !isActionable ? (
                <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                  {t('blockedLabel')}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Partial / Result Feedback Banner */}
      {bulkState.status === 'success' && bulkState.result && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-teal-300 bg-teal-50 p-3 text-xs text-teal-950 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold">
              {t('partialResult', {
                successCount: bulkState.result.filter(
                  (r) => r.status === 'approved',
                ).length,
                totalCount: bulkState.result.length,
              })}
            </span>
            <button
              type="button"
              onClick={resetBulkState}
              className="text-xs text-teal-800 font-bold underline"
            >
              {t('dismiss')}
            </button>
          </div>

          {bulkState.result.some((r) => r.status !== 'approved') && (
            <ul className="space-y-1 border-t border-teal-200 pt-2 text-[11px]">
              {bulkState.result
                .filter((r) => r.status === 'ineligible')
                .map((r) => (
                  <li key={r.item_id} className="text-red-900 font-medium">
                    {t('ineligibleReason', {
                      itemId: r.item_id.slice(0, 8),
                      reason: r.error?.code
                        ? localizeError(r.error.code)
                        : t('unknownError'),
                    })}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {/* Error state */}
      {bulkState.status === 'error' && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-950 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
            <span>{t('errorBody')}</span>
          </div>
          <button
            type="button"
            onClick={resetBulkState}
            className="text-xs font-bold text-red-800 underline"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Submit Action */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-xs font-semibold text-slate-700">
          {t('selectedCount', { count: selectedItemIds.length })}
        </span>

        <button
          type="button"
          onClick={submitBulk}
          disabled={selectedItemIds.length === 0 || isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('submitting')}</span>
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              <span>{t('approveSelected', { count: selectedItemIds.length })}</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}

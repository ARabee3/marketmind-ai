'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2,
  XCircle,
  MessageSquarePlus,
  AlertOctagon,
  Loader2,
  ShieldCheck,
  RefreshCw,
  Info,
} from 'lucide-react'
import type { ContentPackWorkspaceItem } from '../types/review.types'
import { checkItemEligibility } from '../utils/eligibility'
import { useItemDecision } from '../hooks/useItemDecision'
import { RevisionRequestDialog } from './RevisionRequestDialog'
import { Tooltip } from '@/components/ui/tooltip'

type DecisionRailProps = {
  packId: string
  item: ContentPackWorkspaceItem
  onDecisionComplete?: () => void
}

export function DecisionRail({
  packId,
  item,
  onDecisionComplete,
}: DecisionRailProps) {
  const t = useTranslations('ContentReview.decision')
  const tErr = useTranslations('ContentReview.errors')
  const tTooltips = useTranslations('ContentReview.tooltips')
  const [isRevisionOpen, setIsRevisionOpen] = useState(false)

  const { decisionState, submitDecision, resetDecisionState } = useItemDecision(
    packId,
    onDecisionComplete,
  )

  const { current_version } = item
  const eligibility = checkItemEligibility(item)
  const isSubmitting = decisionState.status === 'submitting'
  const isConflict = decisionState.status === 'conflict'

  // Announce the stale-version change and return focus to the updated heading.
  useEffect(() => {
    if (!isConflict) return
    const heading = document.getElementById(`item-heading-${item.item.id}`)
    heading?.focus()
  }, [isConflict, item.item.id])

  const handleApprove = () => {
    submitDecision(
      item.item.id,
      current_version.id,
      current_version.version_checksum,
      'approve',
    )
  }

  const handleReject = () => {
    submitDecision(
      item.item.id,
      current_version.id,
      current_version.version_checksum,
      'reject',
    )
  }

  const handleRevisionSubmit = (notes: string) => {
    setIsRevisionOpen(false)
    submitDecision(
      item.item.id,
      current_version.id,
      current_version.version_checksum,
      'revise',
      notes,
    )
  }

  const channelOk = !eligibility.blockers.includes('CONTENT_CHANNEL_MISMATCH')
  const claimsOk = eligibility.warnings.length === 0
  const assetOk = !eligibility.blockers.includes('CONTENT_ASSET_REQUIRED')

  return (
    <>
      <aside
        aria-label={t('title')}
        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs space-y-5 sticky top-6"
      >
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
            {t('title')}
          </span>
          <h3 className="text-base font-bold text-[var(--color-navy)] mt-0.5 inline-flex items-center">
            {t('versionChecksum', {
              version: current_version.version,
              checksum: current_version.version_checksum.slice(0, 8),
            })}
            <Tooltip content={tTooltips('checksum')} />
          </h3>
        </div>

        {/* Explicit Consequence Notice */}
        <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3 text-xs text-teal-950 flex items-start gap-2">
          <Info className="h-4 w-4 text-teal-700 shrink-0 mt-0.5" />
          <p className="leading-relaxed">{t('consequence')}</p>
        </div>

        {/* Eligibility Checklist */}
        <div className="space-y-2 border-t border-slate-200 pt-4">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            {t('eligibility.title')}
          </h4>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2 text-slate-700">
              {channelOk ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600 shrink-0" />
              )}
              <span>{t('eligibility.channelApproved')}</span>
            </li>
            <li className="flex items-center gap-2 text-slate-700">
              {claimsOk ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertOctagon className="h-4 w-4 text-amber-600 shrink-0" />
              )}
              <span>{t('eligibility.claimsSupported')}</span>
            </li>
            <li className="flex items-center gap-2 text-slate-700">
              {assetOk ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600 shrink-0" />
              )}
              <span>{t('eligibility.assetReady')}</span>
            </li>
          </ul>

          {!eligibility.eligible && (
            <div className="rounded bg-red-50 p-2.5 text-xs text-red-900 border border-red-200 mt-2">
              <span className="font-bold block mb-1">
                {t('eligibility.blockersPresent', {
                  count: eligibility.blockers.length,
                })}
              </span>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {eligibility.reasons.map((reason, idx) => (
                  <li key={idx}>
                    {tErr(reason as Parameters<typeof tErr>[0]) || reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Conflict Error State Banner */}
        {decisionState.status === 'conflict' && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-2"
          >
            <div className="flex items-center gap-2 font-bold text-amber-900">
              <RefreshCw className="h-4 w-4 text-amber-700 animate-spin" />
              <span>{t('conflict.title')}</span>
            </div>
            <p>
              {t('conflict.body', {
                latestVersion: decisionState.latestVersionId,
              })}
            </p>
            <button
              type="button"
              onClick={resetDecisionState}
              className="text-xs font-bold text-amber-900 underline"
            >
              {t('conflict.dismiss')}
            </button>
          </div>
        )}

        {/* Standard Error Banner */}
        {decisionState.status === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-950 space-y-1"
          >
            <span className="font-bold block">
              {tErr(decisionState.code as Parameters<typeof tErr>[0]) ||
                decisionState.message}
            </span>
            <button
              type="button"
              onClick={resetDecisionState}
              className="text-[11px] font-bold text-red-800 underline mt-1"
            >
              {t('errorDismiss')}
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-2 border-t border-slate-200">
          <button
            type="button"
            onClick={handleApprove}
            disabled={!eligibility.eligible || isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting && decisionState.decision === 'approve' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            <span>
              {t('actions.approveVersion', { version: current_version.version })}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsRevisionOpen(true)}
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span>{t('actions.requestRevision')}</span>
          </button>

          <button
            type="button"
            onClick={handleReject}
            disabled={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
          >
            {isSubmitting && decisionState.decision === 'reject' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            <span>
              {t('actions.rejectVersion', { version: current_version.version })}
            </span>
          </button>
        </div>
      </aside>

      {/* Revision Dialog */}
      <RevisionRequestDialog
        isOpen={isRevisionOpen}
        versionNumber={current_version.version}
        isSubmitting={isSubmitting && decisionState.decision === 'revise'}
        onClose={() => setIsRevisionOpen(false)}
        onSubmit={handleRevisionSubmit}
      />
    </>
  )
}

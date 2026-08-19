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
  Lock,
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
  const isRefreshing = decisionState.status === 'refreshing'
  const isBusy = isSubmitting || isRefreshing
  const isConflict = decisionState.status === 'conflict'
  // An immutable publication candidate freezes this item: no further owner
  // decisions are permitted.
  const isImmutable = item.publication_candidate !== null

  // Announce the stale-version change and return focus to the updated heading.
  // The hook only enters the conflict state after the authoritative refetch
  // has landed, so the heading is guaranteed to show fresh data.
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
        className="rounded-xl border border-border bg-surface p-5 shadow-xs space-y-5 sticky top-6"
      >
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-primary">
            {t('title')}
          </span>
          <h3 className="text-base font-bold text-navy mt-0.5 inline-flex items-center">
            {t('versionChecksum', {
              version: current_version.version,
              checksum: current_version.version_checksum.slice(0, 8),
            })}
            <Tooltip content={tTooltips('checksum')} />
          </h3>
        </div>

        {/* Explicit Consequence Notice */}
        <div className="rounded-lg border border-primary/20 bg-soft-teal/70 p-3 text-xs text-navy flex items-start gap-2">
          <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">{t('consequence')}</p>
        </div>

        {/* Eligibility Checklist */}
        <div className="space-y-2 border-t border-border pt-4">
          <h4 className="text-xs font-bold text-navy uppercase tracking-wider">
            {t('eligibility.title')}
          </h4>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2 text-navy">
              {channelOk ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 text-danger shrink-0" aria-hidden="true" />
              )}
              <span>{t('eligibility.channelApproved')}</span>
            </li>
            <li className="flex items-center gap-2 text-navy">
              {claimsOk ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              ) : (
                <AlertOctagon className="h-4 w-4 text-warning shrink-0" aria-hidden="true" />
              )}
              <span>{t('eligibility.claimsSupported')}</span>
            </li>
            <li className="flex items-center gap-2 text-navy">
              {assetOk ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 text-danger shrink-0" aria-hidden="true" />
              )}
              <span>{t('eligibility.assetReady')}</span>
            </li>
          </ul>

          {!eligibility.eligible && (
            <div className="rounded bg-danger/10 p-2.5 text-xs text-danger border border-danger/20 mt-2">
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

        {/* Conflict / Refreshing Error State Banner */}
        {(isRefreshing || isConflict) && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning space-y-2"
          >
            <div className="flex items-center gap-2 font-bold text-warning">
              <RefreshCw className="h-4 w-4 text-warning animate-spin" aria-hidden="true" />
              <span>
                {isRefreshing ? t('conflict.fetching') : t('conflict.title')}
              </span>
            </div>
            {isConflict && (
              <>
                <p>
                  {decisionState.latestVersionId
                    ? t('conflict.body', {
                        latestVersion: decisionState.latestVersionId,
                      })
                    : t('conflict.bodyNoVersion')}
                </p>
                <button
                  type="button"
                  onClick={resetDecisionState}
                  className="text-xs font-bold text-warning underline outline-none focus-visible:ring-2 focus-visible:ring-warning"
                >
                  {t('conflict.dismiss')}
                </button>
              </>
            )}
          </div>
        )}

        {/* Standard Error Banner */}
        {decisionState.status === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger space-y-1"
          >
            <span className="font-bold block">
              {tErr(decisionState.code as Parameters<typeof tErr>[0]) ||
                decisionState.message}
            </span>
            <button
              type="button"
              onClick={resetDecisionState}
              className="text-[11px] font-bold text-danger underline mt-1 outline-none focus-visible:ring-2 focus-visible:ring-danger"
            >
              {t('errorDismiss')}
            </button>
          </div>
        )}

        {/* Action Buttons — replaced by an immutable notice once a
            publication candidate freezes this item */}
        {isImmutable ? (
          <div className="rounded-lg border border-primary/30 bg-soft-teal p-3 text-xs text-navy space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-primary">
              <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('immutable.title')}</span>
            </div>
            <p className="leading-relaxed">{t('immutable.body')}</p>
          </div>
        ) : (
          <div className="space-y-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={handleApprove}
              disabled={!eligibility.eligible || isBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-xs hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && decisionState.decision === 'approve' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {t('actions.approveVersion', { version: current_version.version })}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsRevisionOpen(true)}
              disabled={isBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning hover:bg-warning/20 outline-none focus-visible:ring-2 focus-visible:ring-warning disabled:opacity-50"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              <span>{t('actions.requestRevision')}</span>
            </button>

            <button
              type="button"
              onClick={handleReject}
              disabled={isBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-danger/30 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/10 outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              {isSubmitting && decisionState.decision === 'reject' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {t('actions.rejectVersion', { version: current_version.version })}
              </span>
            </button>
          </div>
        )}
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

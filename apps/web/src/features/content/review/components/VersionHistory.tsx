'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { History, GitCommit, MessageSquare } from 'lucide-react'
import type { ContentDecision, ContentItemVersion } from '@marketmind/contracts'
import { Tooltip } from '@/components/ui/tooltip'

type VersionHistoryProps = {
  versionHistory: readonly ContentItemVersion[]
  decisions: readonly ContentDecision[]
  currentVersionId: string
}

export function VersionHistory({
  versionHistory,
  decisions,
  currentVersionId,
}: VersionHistoryProps) {
  const t = useTranslations('ContentReview.history')
  const tTooltips = useTranslations('ContentReview.tooltips')
  const format = useFormatter()

  const decisionLabel = (decision: ContentDecision['decision']) => {
    if (t.has(`decisions.${decision}`)) {
      return t.raw(`decisions.${decision}`) as string
    }
    return decision.replace(/_/g, ' ')
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <History className="h-4 w-4 text-[var(--color-primary)]" />
        <h3 className="text-sm font-bold text-[var(--color-navy)] uppercase tracking-wider">
          {t('title')}
        </h3>
      </div>

      <ol className="relative border-s border-slate-200 ms-3 space-y-4">
        {versionHistory.map((ver) => {
          const isCurrent = ver.id === currentVersionId
          const versionDecisions = decisions.filter(
            (d) => d.content_item_version_id === ver.id,
          )

          return (
            <li key={ver.id} className="mb-4 ms-6">
              <span
                aria-hidden="true"
                className="absolute -start-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 ring-4 ring-white border border-slate-300"
              >
                <GitCommit className="h-3 w-3 text-slate-600" />
              </span>

              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-[var(--color-navy)]">
                  {t('version', { version: ver.version })}
                </span>
                {isCurrent && (
                  <span className="rounded bg-teal-100 px-2 py-0.5 text-xs font-bold text-teal-900 border border-teal-300">
                    {t('current')}
                  </span>
                )}
              </div>

              <div className="font-mono text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-0.5">
                {t('checksum', { checksum: ver.version_checksum.slice(0, 16) })}…
                <Tooltip content={tTooltips('checksum')} iconClassName="h-3 w-3 text-slate-400 hover:text-slate-600 transition-colors" />
              </div>

              {/* Associated decisions and revision notes */}
              {versionDecisions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {versionDecisions.map((dec) => (
                    <div
                      key={dec.id}
                      className="rounded border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold capitalize text-slate-900">
                          {decisionLabel(dec.decision)}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {format.dateTime(new Date(dec.decided_at), {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      {dec.revision_notes && (
                        <div className="flex items-start gap-1.5 text-amber-900 bg-amber-50 p-2 rounded border border-amber-200 mt-1">
                          <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-700" />
                          <div>
                            <span className="font-bold block text-[10px]">
                              {t('revisionNotesLabel')}
                            </span>
                            <p className="whitespace-pre-wrap font-sans text-xs">
                              {dec.revision_notes}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

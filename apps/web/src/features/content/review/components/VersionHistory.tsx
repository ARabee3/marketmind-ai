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
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <History className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-bold text-navy uppercase tracking-wider">
          {t('title')}
        </h3>
      </div>

      <ol className="relative border-s border-border ms-3 space-y-4">
        {versionHistory.map((ver) => {
          const isCurrent = ver.id === currentVersionId
          const versionDecisions = decisions.filter(
            (d) => d.content_item_version_id === ver.id,
          )

          return (
            <li key={ver.id} className="mb-4 ms-6">
              <span
                aria-hidden="true"
                className="absolute -start-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted ring-4 ring-surface border border-border"
              >
                <GitCommit className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              </span>

              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-sm text-navy">
                  {t('version', { version: ver.version })}
                </span>
                {isCurrent && (
                  <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary border border-primary/30">
                    {t('current')}
                  </span>
                )}
              </div>

              <div className="font-mono text-[11px] text-muted-foreground mt-0.5 inline-flex items-center gap-0.5">
                {t('checksum', { checksum: ver.version_checksum.slice(0, 16) })}…
                <Tooltip content={tTooltips('checksum')} iconClassName="h-3 w-3 text-muted-foreground hover:text-navy transition-colors" />
              </div>

              {/* Associated decisions and revision notes */}
              {versionDecisions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {versionDecisions.map((dec) => (
                    <div
                      key={dec.id}
                      className="rounded border border-border bg-muted/40 p-2.5 text-xs text-navy space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold capitalize text-navy">
                          {decisionLabel(dec.decision)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {format.dateTime(new Date(dec.decided_at), {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      {dec.revision_notes && (
                        <div className="flex items-start gap-1.5 text-warning bg-warning/15 p-2 rounded border border-warning/30 mt-1">
                          <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                          <div>
                            <span className="font-bold block text-[10px]">
                              {t('revisionNotesLabel')}
                            </span>
                            <p className="whitespace-pre-wrap font-sans text-xs text-navy">
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

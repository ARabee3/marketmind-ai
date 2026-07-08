'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDiscoveryProgress, canOpenInterview } from '@/features/discovery/hooks/use-discovery-progress'
import {
  getProgressEventMessageKey,
  getProgressStageKey,
} from '@/features/discovery/lib/progress-localization'
import type { TranslationKey } from '@/i18n/types'

export function ProgressTimeline({
  sessionId,
  authToken,
  onContinueToInterview,
}: {
  sessionId: string
  authToken?: string
  onContinueToInterview?: () => Promise<void> | void
}) {
  const t = useTranslations('DiscoveryProgress')
  const tErrors = useTranslations('Errors')
  const { events, sessionStatus, connectionState, restoredFromStatus, connectionError, researchWarning } = useDiscoveryProgress({
    sessionId,
    authToken,
  })

  const showInterviewAction = onContinueToInterview && canOpenInterview(sessionStatus)

  function renderKeyedMessage(key: TranslationKey): string {
    if (key.startsWith('Errors.')) {
      return tErrors(key.slice(7) as Parameters<typeof tErrors>[0])
    }
    if (key.startsWith('DiscoveryProgress.')) {
      return t(key.slice(18) as Parameters<typeof t>[0])
    }
    return key
  }

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-sm border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl text-navy">
            {connectionState === 'reconnecting' ? t('titleReconnecting') : t('title')}
          </CardTitle>
          {connectionState === 'connected' && (
            <span className="flex h-3 w-3 relative" role="status" aria-label={t('connectionConnected')}>
              <span aria-hidden="true" className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-75"></span>
              <span aria-hidden="true" className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
          )}
          {connectionState === 'reconnecting' && (
            <span className="flex h-3 w-3 relative" role="status" aria-label={t('connectionReconnecting')}>
              <span aria-hidden="true" className="relative inline-flex rounded-full h-3 w-3 bg-warning"></span>
            </span>
          )}
          {connectionState === 'failed' && (
            <span className="flex h-3 w-3 relative" role="status" aria-label={t('connectionFailed')}>
              <span aria-hidden="true" className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
            </span>
          )}
        </div>
        <CardDescription>
          {t('subtitle')}
          {restoredFromStatus && <span className="block mt-1 text-xs">{t('recoveryNotice')}</span>}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Persistent research warnings — survive Socket.IO disconnects */}
        {researchWarning && (
          <div
            className="p-4 rounded-md text-sm bg-warning/10 text-warning border border-warning/20"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium">{t(researchWarning.slice(18) as Parameters<typeof t>[0])}</p>
          </div>
        )}

        {/* Transient connection errors */}
        {connectionError && (
          <div
            className="p-4 rounded-md text-sm bg-destructive/10 text-destructive border border-destructive/20"
            role="alert"
            aria-live="assertive"
          >
            <p className="font-medium">{renderKeyedMessage(connectionError)}</p>
          </div>
        )}

        {/* Reconnecting notice */}
        {connectionState === 'reconnecting' && (
          <div
            className="p-4 rounded-md text-sm bg-warning/10 text-warning border border-warning/20"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium">{t('connectionReconnecting')}</p>
          </div>
        )}

        {/* Timeline */}
        <div
          className="space-y-4 ms-2 border-s-2 border-muted ps-4 py-2 relative"
          role="log"
          aria-live="polite"
          aria-busy={connectionState === 'reconnecting'}
          aria-label={t('timelineLabel')}
        >
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground italic">{t('waitingForUpdates')}</p>
          )}
          {events.map((evt, idx) => {
            const isLast = idx === events.length - 1;
            const isActive = isLast && evt.status !== 'complete' && evt.status !== 'failed';
            const isFailed = evt.status === 'failed';
            const isComplete = evt.status === 'complete';

            return (
              <div key={evt.seq} className="relative">
                {/* Timeline Dot */}
                <div aria-hidden="true" className={`absolute -start-[25px] top-1.5 h-3 w-3 rounded-full border-2 border-surface ${
                  isFailed ? 'bg-destructive' :
                  isActive ? 'bg-action motion-safe:animate-pulse' :
                  isComplete ? 'bg-primary' : 'bg-muted'
                }`} />

                <div>
                  <h4 className={`text-sm font-medium ${isFailed ? 'text-destructive' : 'text-navy'}`}>
                    {t(getProgressStageKey(evt.stage).slice(18) as Parameters<typeof t>[0])}
                  </h4>
                  <p
                    className="text-xs text-muted-foreground mt-0.5"
                    title={evt.message_text || undefined}
                  >
                    {t(getProgressEventMessageKey(evt).slice(18) as Parameters<typeof t>[0])}
                  </p>
                  {evt.retryable && (
                    <p className="text-xs text-warning mt-1">
                      {t('errorRetryable')}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Action once interview-capable */}
        {showInterviewAction ? (
          <div className="pt-4 border-t border-border mt-6">
            <Button
              className="w-full"
              size="lg"
              onClick={async () => {
                await onContinueToInterview?.()
              }}
            >
              {t('continueToInterview')}
            </Button>
          </div>
        ) : canOpenInterview(sessionStatus) ? (
          <div
            className="pt-4 border-t border-border mt-6 p-4 rounded-md bg-primary/5 text-primary border border-primary/10"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm font-medium">{t('readyForInterview')}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

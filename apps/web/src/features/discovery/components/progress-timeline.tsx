'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useDiscoveryProgress, canOpenInterview } from '@/features/discovery/hooks/use-discovery-progress'

export function ProgressTimeline({ sessionId, authToken }: { sessionId: string; authToken?: string }) {
  const t = useTranslations('DiscoveryProgress')
  const { events, sessionStatus, connectionState, restoredFromStatus, error } = useDiscoveryProgress({
    sessionId,
    authToken,
  })

  // Format stage keys to translations
  const stageToKey: Record<string, string> = {
    queued: t('stageQueued'),
    query_planning: t('stageQueryPlanning'),
    metadata: t('stageMetadata'),
    competitor_searching: t('stageCompetitorSearching'),
    search: t('stageSearch'),
    filtering: t('stageFiltering'),
    persisting: t('stagePersisting'),
    ai_start: t('stageAiStart'),
    ready: t('stageReady'),
    failed: t('stageFailed'),
  }

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-sm border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl text-navy">
            {connectionState === 'reconnecting' ? t('titleReconnecting') : t('title')}
          </CardTitle>
          {connectionState === 'connected' && (
            <span className="flex h-3 w-3 relative" aria-label="Connected">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/40 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
          )}
          {connectionState === 'reconnecting' && (
            <span className="flex h-3 w-3 relative" aria-label="Reconnecting">
              <span className="relative inline-flex rounded-full h-3 w-3 bg-warning"></span>
            </span>
          )}
          {connectionState === 'failed' && (
            <span className="flex h-3 w-3 relative" aria-label="Connection failed">
              <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
            </span>
          )}
        </div>
        <CardDescription>
          {t('subtitle')}
          {restoredFromStatus && <span className="block mt-1 text-xs">{t('recoveryNotice')}</span>}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Error Banners */}
        {error && (
          <div className={`p-4 rounded-md text-sm ${error === 'errorReconnecting' ? 'bg-warning/10 text-warning-foreground border border-warning/20' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
            <p className="font-medium">
              {/* Maps standard errors to translations */}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {t(error as any) || t('errorGeneric')}
            </p>
          </div>
        )}

        {/* Timeline */}
        <div className="space-y-4 ms-2 border-s-2 border-muted ps-4 py-2 relative">
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground italic">Waiting for updates...</p>
          )}
          {events.map((evt, idx) => {
            const isLast = idx === events.length - 1;
            const isActive = isLast && evt.status !== 'complete' && evt.status !== 'failed';
            const isFailed = evt.status === 'failed';
            const isComplete = evt.status === 'complete';
            
            return (
              <div key={evt.seq} className="relative">
                {/* Timeline Dot */}
                <div className={`absolute -start-[25px] top-1.5 h-3 w-3 rounded-full border-2 border-surface ${
                  isFailed ? 'bg-destructive' : 
                  isActive ? 'bg-action motion-safe:animate-pulse' : 
                  isComplete ? 'bg-primary' : 'bg-muted'
                }`} />
                
                <div>
                  <h4 className={`text-sm font-medium ${isFailed ? 'text-destructive' : 'text-navy'}`}>
                    {stageToKey[evt.stage] || evt.stage}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5" title={evt.message_text}>
                    {evt.message_key ? t(evt.message_key as any) : evt.message_text}
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

        {/* Action Button once ready */}
        {canOpenInterview(sessionStatus) && (
          <div className="pt-4 border-t border-border mt-6">
            <Button className="w-full" size="lg" onClick={() => window.location.reload()}>
              {t('continueToInterview')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

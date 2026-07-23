'use client'

import { Check, ChevronDown, Circle, Clock3, Radio, TriangleAlert } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useDiscoveryProgress, canOpenInterview } from '@/features/discovery/hooks/use-discovery-progress'
import { getProgressEventMessageKey, getProgressStageKey } from '@/features/discovery/lib/progress-localization'
import {
  getResearchProgress,
  getStageState,
  isResearchProgressWrapperEvent,
  RESEARCH_STAGES,
} from '@/features/discovery/lib/research-progress'
import type { TranslationKey } from '@/i18n/types'

const STAGE_STATE_LABELS = {
  complete: 'stageStateComplete',
  current: 'stageStateCurrent',
  failed: 'stageStateFailed',
  pending: 'stageStatePending',
} as const

export function ProgressTimeline({
  sessionId,
  onContinueToInterview,
}: {
  readonly sessionId: string
  readonly onContinueToInterview?: () => Promise<void> | void
}) {
  const t = useTranslations('DiscoveryProgress')
  const tErrors = useTranslations('Errors')
  const format = useFormatter()
  const progressState = useDiscoveryProgress({ sessionId })
  const { events, sessionStatus, connectionState, restoredFromStatus, connectionError, researchWarning } = progressState
  const research = getResearchProgress(events, sessionStatus)
  const showInterviewAction = Boolean(onContinueToInterview) && canOpenInterview(sessionStatus)
  const currentEvent = events.findLast((event) => (
    event.stage === research.currentStage && !isResearchProgressWrapperEvent(event)
  ))

  function renderKeyedMessage(key: TranslationKey): string {
    if (key.startsWith('Errors.')) return tErrors(key.slice(7) as Parameters<typeof tErrors>[0])
    if (key.startsWith('DiscoveryProgress.')) return t(key.slice(18) as Parameters<typeof t>[0])
    return key
  }

  const percentage = format.number(research.progressPercent / 100, { style: 'percent' })

  return (
    <section className="mx-auto w-full max-w-5xl py-3 md:py-6" aria-labelledby="research-progress-title">
      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-elevated">
        <header className="bg-navy px-5 py-6 text-primary-foreground sm:px-7 sm:py-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-journey-mint uppercase">
                <Radio className="size-4" aria-hidden="true" />
                {t('liveResearchLabel')}
              </div>
              <h1 id="research-progress-title" className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">
                {connectionState === 'reconnecting' ? t('titleReconnecting') : t('title')}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-7 text-white/70">{t('subtitle')}</p>
            </div>
            <ConnectionBadge state={connectionState} />
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-white/60">{t('currentStageLabel')}</p>
                  <p className="mt-1 font-semibold">{t(getProgressStageKey(research.currentStage).slice(18) as Parameters<typeof t>[0])}</p>
                </div>
                <span className="text-2xl font-bold tabular-nums text-journey-mint">{percentage}</span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={research.progressPercent} aria-label={t('timelineLabel')}>
                <div className="h-full origin-left rounded-full bg-journey-mint transition-transform duration-500 rtl:origin-right" style={{ transform: `scaleX(${research.progressPercent / 100})` }} />
              </div>
            </div>
            <div className="flex min-w-44 items-center gap-3 rounded-lg border border-white/15 bg-white/8 px-4 py-3">
              <Clock3 className="size-5 text-journey-mint" aria-hidden="true" />
              <div>
                <p className="text-[11px] text-white/55">{t('estimatedTimeLabel')}</p>
                <p className="text-sm font-bold">
                  {research.complete
                    ? t('estimateComplete')
                    : research.estimatedMinutes === 0
                      ? t('estimateLessThanMinute')
                      : t('estimateMinutes', { minutes: format.number(research.estimatedMinutes) })}
                </p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-white/50">{t('estimateDisclaimer')}</p>
        </header>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="p-5 sm:p-7">
            {restoredFromStatus ? (
              <p className="mb-4 rounded-lg border border-primary/15 bg-soft-teal px-3 py-2 text-xs font-medium text-primary">{t('recoveryNotice')}</p>
            ) : null}
            {researchWarning ? <StatusNotice tone="warning" message={t(researchWarning.slice(18) as Parameters<typeof t>[0])} /> : null}
            {connectionError ? <StatusNotice tone="danger" message={renderKeyedMessage(connectionError)} /> : null}
            {connectionState === 'reconnecting' ? <StatusNotice tone="warning" message={t('connectionReconnecting')} /> : null}

            <ol className="space-y-1" aria-label={t('timelineLabel')} aria-live="polite" aria-busy={connectionState === 'reconnecting'}>
              {RESEARCH_STAGES.map((stage, index) => {
                const state = getStageState(stage, events, research.currentStage)
                return (
                  <li key={stage} className="relative grid grid-cols-[2.5rem_1fr] gap-3 pb-4 last:pb-0">
                    {index < RESEARCH_STAGES.length - 1 ? <span className="absolute top-8 bottom-0 start-[1.2rem] w-px bg-border" aria-hidden="true" /> : null}
                    <StageIcon state={state} />
                    <div className={`rounded-lg border px-4 py-3 ${state === 'current' ? 'border-primary bg-soft-teal' : state === 'failed' ? 'border-destructive/25 bg-destructive/5' : 'border-transparent'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <h2 className={`text-sm font-bold ${state === 'pending' ? 'text-muted-foreground' : state === 'failed' ? 'text-destructive' : 'text-navy'}`}>
                          {t(getProgressStageKey(stage).slice(18) as Parameters<typeof t>[0])}
                        </h2>
                        <span className="text-[11px] font-semibold text-muted-foreground">{t(STAGE_STATE_LABELS[state])}</span>
                      </div>
                      {state === 'current' && currentEvent ? (
                        <p className="mt-1 text-xs leading-5 text-ink-soft">{t(getProgressEventMessageKey(currentEvent).slice(18) as Parameters<typeof t>[0])}</p>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          <aside className="border-t border-border bg-background p-5 lg:border-t-0 lg:border-s lg:p-6">
            <h2 className="text-sm font-bold text-navy">{t('whileYouWaitTitle')}</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{t('whileYouWaitDescription')}</p>
            <div className="mt-5 rounded-lg border border-border bg-surface p-4">
              <p className="text-xs font-bold text-primary">{t('ownerControlTitle')}</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">{t('ownerControlDescription')}</p>
            </div>
            {events.length > 0 ? (
              <details className="group mt-5 border-t border-border pt-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-navy outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                  {t('activityLogTitle')}
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <ol className="mt-3 space-y-2">
                  {events.slice(-5).reverse().map((event) => (
                    <li key={event.seq} className="text-xs leading-5 text-muted-foreground">
                      {t(getProgressEventMessageKey(event).slice(18) as Parameters<typeof t>[0])}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </aside>
        </div>

        {showInterviewAction ? (
          <div className="border-t border-border bg-soft-teal p-4 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:px-7">
            <p className="text-sm font-semibold text-primary">{t('readyForInterview')}</p>
            <Button className="mt-3 min-h-11 w-full px-6 sm:mt-0 sm:w-auto" onClick={() => onContinueToInterview?.()}>
              {t('continueToInterview')}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ConnectionBadge({ state }: { readonly state: 'idle' | 'connected' | 'reconnecting' | 'failed' }) {
  const t = useTranslations('DiscoveryProgress')
  const label = state === 'connected' ? t('connectionConnected') : state === 'reconnecting' ? t('connectionReconnecting') : state === 'failed' ? t('connectionFailed') : t('connectionConnecting')
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-2 text-xs font-semibold" role="status">
      <span className={`size-2 rounded-full ${state === 'connected' ? 'bg-journey-mint motion-safe:animate-pulse' : state === 'failed' ? 'bg-danger' : 'bg-warning'}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function StageIcon({ state }: { readonly state: 'complete' | 'current' | 'failed' | 'pending' }) {
  const className = `relative z-10 grid size-9 place-items-center rounded-full border ${state === 'complete' ? 'border-primary bg-primary text-primary-foreground' : state === 'current' ? 'border-primary bg-soft-teal text-primary' : state === 'failed' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border bg-background text-muted-foreground'}`
  if (state === 'complete') return <span className={className}><Check className="size-4" aria-hidden="true" /></span>
  if (state === 'current') return <span className={className}><Radio className="size-4 motion-safe:animate-pulse" aria-hidden="true" /></span>
  if (state === 'failed') return <span className={className}><TriangleAlert className="size-4" aria-hidden="true" /></span>
  return <span className={className}><Circle className="size-3" aria-hidden="true" /></span>
}

function StatusNotice({ tone, message }: { readonly tone: 'warning' | 'danger'; readonly message: string }) {
  return (
    <div className={`mb-4 rounded-lg border p-3 text-sm font-medium ${tone === 'warning' ? 'border-warning/20 bg-warning/10 text-warning' : 'border-destructive/20 bg-destructive/10 text-destructive'}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {message}
    </div>
  )
}

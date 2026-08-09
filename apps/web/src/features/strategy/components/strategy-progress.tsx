'use client'

import { Check, Circle, Radio, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import type {
  StrategyProgressEvent,
  StrategyStatus,
} from '@marketmind/contracts'
import { ownerProgressLabel } from '../lib/strategy-state'

export function StrategyProgress({
  status,
  progress,
  reviewHref,
  onRetry,
  retryPending = false,
  actionError = null,
}: {
  readonly status: StrategyStatus
  readonly progress: readonly StrategyProgressEvent[]
  readonly reviewHref?: string
  readonly onRetry?: () => void
  readonly retryPending?: boolean
  readonly actionError?: string | null
}) {
  const t = useTranslations('Strategy')
  const current = ownerProgressLabel(status)
  const approved = status === 'approved'
  const percent = strategyProgressPercent(status, progress)
  const lastFailure = [...progress]
    .reverse()
    .find((event) => event.status === 'failed')
  const failureCode = lastFailure?.payload.code
  const canRetry = status === 'failed' && lastFailure?.retryable === true

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <header className="bg-navy p-5 text-primary-foreground md:p-6">
        <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
          {t(approved ? 'progress.eyebrowApproved' : 'progress.eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">
          {t(approved ? 'progress.titleApproved' : 'progress.title')}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
          {t(`progress.labels.${current}`)}
        </p>
        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <span className="text-xs text-white/60">
              {t('progress.estimate')}
            </span>
            <span className="text-2xl font-bold text-journey-mint">
              {percent}%
            </span>
          </div>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('progress.barLabel')}
          >
            <div
              className="h-full origin-left rounded-full bg-journey-mint rtl:origin-right"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          <p className="mt-2 text-xs text-white/50">
            {t('progress.estimateHint')}
          </p>
        </div>
      </header>
      <ol className="grid gap-1 p-4 md:p-6">
        {progress.length === 0 ? (
          <li className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
            {t('progress.empty')}
          </li>
        ) : (
          progress.map((event) => (
            <li
              key={event.seq}
              className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
            >
              <ProgressIcon state={event.status} />
              <div>
                <h2 className="text-sm font-bold text-navy">
                  {t(`progress.stages.${event.stage}`)}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t(`progress.stageStates.${event.status}`)}
                </p>
              </div>
            </li>
          ))
        )}
      </ol>
      {status === 'failed' ? (
        <div className="border-t border-border bg-danger/5 p-4 md:px-6">
          <p className="text-sm font-bold text-danger">
            {t('progress.failureTitle')}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {failureCode === 'STRATEGY_KNOWLEDGE_UNAVAILABLE'
              ? t('progress.knowledgeUnavailable')
              : (lastFailure?.message_text ?? t('progress.failureBody'))}
          </p>
          <div className="mt-3" aria-live="polite">
            {canRetry && onRetry ? (
              <Button
                type="button"
                variant="outline"
                disabled={retryPending}
                onClick={onRetry}
              >
                {retryPending ? t('decision.pending') : t('decision.retry')}
              </Button>
            ) : (
              <p className="text-xs font-semibold text-danger">
                {t('progress.notRetryable')}
              </p>
            )}
            {actionError ? (
              <p className="mt-2 text-xs text-danger">{actionError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      {(status === 'draft' || status === 'approved') && reviewHref ? (
        <div className="flex justify-end border-t border-border bg-background/70 p-4 md:px-6">
          <Link
            href={reviewHref}
            className="inline-flex min-h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {t('progress.openReview')}
          </Link>
        </div>
      ) : null}
    </section>
  )
}

export function strategyProgressPercent(
  status: StrategyStatus,
  progress: readonly StrategyProgressEvent[],
): number {
  if (status === 'draft' || status === 'approved') return 100
  if (progress.length === 0) return 0

  const complete = progress.filter(
    (event) => event.status === 'complete',
  ).length
  const active = progress.some((event) => event.status === 'progress') ? 0.5 : 0
  const percent = Math.round(((complete + active) / progress.length) * 100)
  return status === 'failed' ? percent : Math.min(percent, 99)
}

function ProgressIcon({
  state,
}: {
  readonly state: 'started' | 'progress' | 'complete' | 'failed'
}) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full border',
        state === 'complete' &&
          'border-primary bg-primary text-primary-foreground',
        state === 'progress' && 'border-primary bg-soft-teal text-primary',
        state === 'failed' &&
          'border-destructive bg-destructive/10 text-destructive',
        state === 'started' &&
          'border-border bg-background text-muted-foreground',
      )}
    >
      {state === 'complete' ? (
        <Check className="size-4" aria-hidden="true" />
      ) : state === 'progress' ? (
        <Radio
          className="size-4 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      ) : state === 'failed' ? (
        <TriangleAlert className="size-4" aria-hidden="true" />
      ) : (
        <Circle className="size-3" aria-hidden="true" />
      )}
    </span>
  )
}

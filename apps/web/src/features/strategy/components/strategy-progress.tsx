'use client'

import { Check, Circle, Radio, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { StrategyProgressEvent, StrategyStatus } from '@marketmind/contracts'
import { ownerProgressLabel } from '../lib/strategy-state'

export function StrategyProgress({
  status,
  progress,
}: {
  readonly status: StrategyStatus
  readonly progress: readonly StrategyProgressEvent[]
}) {
  const t = useTranslations('Strategy')
  const current = ownerProgressLabel(status)
  const percent = status === 'draft' ? 100 : status === 'failed' ? 72 : 58

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <header className="bg-navy p-5 text-primary-foreground md:p-6">
        <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
          {t('progress.eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('progress.title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">
          {t(`progress.labels.${current}`)}
        </p>
        <div className="mt-6">
          <div className="flex items-end justify-between gap-3">
            <span className="text-xs text-white/60">{t('progress.estimate')}</span>
            <span className="text-2xl font-bold text-journey-mint">{percent}%</span>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('progress.barLabel')}>
            <div className="h-full origin-left rounded-full bg-journey-mint rtl:origin-right" style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
          <p className="mt-2 text-xs text-white/50">{t('progress.estimateHint')}</p>
        </div>
      </header>
      <ol className="grid gap-1 p-4 md:p-6">
        {progress.map((event) => (
          <li key={event.seq} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            <ProgressIcon state={event.status} />
            <div>
              <h2 className="text-sm font-bold text-navy">{t(`progress.stages.${event.stage}`)}</h2>
              <p className="text-xs text-muted-foreground">{t(`progress.stageStates.${event.status}`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
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
        state === 'complete' && 'border-primary bg-primary text-primary-foreground',
        state === 'progress' && 'border-primary bg-soft-teal text-primary',
        state === 'failed' && 'border-destructive bg-destructive/10 text-destructive',
        state === 'started' && 'border-border bg-background text-muted-foreground',
      )}
    >
      {state === 'complete' ? (
        <Check className="size-4" aria-hidden="true" />
      ) : state === 'progress' ? (
        <Radio className="size-4 motion-safe:animate-pulse" aria-hidden="true" />
      ) : state === 'failed' ? (
        <TriangleAlert className="size-4" aria-hidden="true" />
      ) : (
        <Circle className="size-3" aria-hidden="true" />
      )}
    </span>
  )
}

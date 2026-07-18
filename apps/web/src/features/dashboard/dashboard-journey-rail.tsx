'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { DashboardJourneyKind } from './dashboard-state'

const PHASES = [
  'discovery',
  'review',
  'strategy',
  'content',
  'results',
] as const

type Phase = (typeof PHASES)[number]

export function JourneyRail({ activeKind }: { readonly activeKind: DashboardJourneyKind }) {
  const t = useTranslations('Dashboard')

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t('journeyLabel')}
        </p>
        <h2 className="text-xl font-bold text-navy">{t('journeyTitle')}</h2>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {PHASES.map((phase) => (
          <li key={phase}>
            <PhaseCard phase={phase} status={phaseStatus(phase, activeKind)} />
          </li>
        ))}
      </ol>
    </section>
  )
}

function PhaseCard({
  phase,
  status,
}: {
  readonly phase: Phase
  readonly status: 'done' | 'active' | 'locked'
}) {
  const t = useTranslations('Dashboard')

  return (
    <div
      className={cn(
        'grid h-full gap-3 rounded-lg border p-3 transition-transform hover:-translate-y-0.5',
        status === 'active' && 'border-primary bg-soft-teal shadow-sm',
        status === 'done' && 'border-primary/25 bg-primary/5',
        status === 'locked' && 'border-border bg-background',
      )}
    >
      <span
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
          status === 'locked'
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground',
        )}
      >
        {t(`phase.${phase}.number`)}
      </span>
      <div className="grid gap-1">
        <h3 className="font-semibold text-navy">{t(`phase.${phase}.title`)}</h3>
        <p className="text-xs leading-5 text-muted-foreground">
          {t(`phase.${phase}.${status}`)}
        </p>
      </div>
    </div>
  )
}

function phaseStatus(
  phase: Phase,
  activeKind: DashboardJourneyKind,
): 'done' | 'active' | 'locked' {
  if (phase === 'discovery') {
    return activeKind === 'empty' ? 'active' : 'done'
  }
  if (phase === 'review') {
    if (activeKind === 'review') return 'active'
    if (activeKind === 'confirmed') return 'done'
    return 'locked'
  }
  if (phase === 'strategy') {
    return activeKind === 'confirmed' ? 'active' : 'locked'
  }
  return 'locked'
}

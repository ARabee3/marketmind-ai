'use client'

import { Check, CircleAlert, Clock3 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { StrategyResource } from '@marketmind/contracts'
import type { StrategyReadinessItemData } from '../lib/strategy-state'
import { getStrategyReadiness } from '../lib/strategy-state'

export function StrategyReadiness({
  resource,
  readiness,
}: {
  readonly resource: StrategyResource
  readonly readiness: readonly StrategyReadinessItemData[]
}) {
  const t = useTranslations('Strategy')
  const view = getStrategyReadiness(resource)
  const approved = resource.status === 'approved'

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t('readiness.label')}
          </p>
          <h2 className="mt-2 text-xl font-bold text-navy">
            {approved
              ? t('readiness.approvedTitle')
              : view.ready
                ? t('readiness.readyTitle')
                : t('readiness.blockedTitle')}
          </h2>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-1 text-xs font-bold',
            approved || view.ready ? 'bg-soft-teal text-primary' : 'bg-warning/10 text-warning',
          )}
        >
          {approved
            ? t('readiness.approvedBadge')
            : view.ready
              ? t('readiness.readyBadge')
              : t('readiness.needsDecisionBadge')}
        </span>
      </div>
      {approved ? null : (
      <>
      <ol className="mt-5 grid gap-3">
        {readiness.map((item) => (
          <li key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-full',
                item.state === 'complete' && 'bg-primary text-primary-foreground',
                item.state === 'missing' && 'bg-warning/10 text-warning',
                item.state === 'warning' && 'bg-muted text-muted-foreground',
              )}
            >
              {item.state === 'complete' ? (
                <Check className="size-4" aria-hidden="true" />
              ) : item.state === 'missing' ? (
                <CircleAlert className="size-4" aria-hidden="true" />
              ) : (
                <Clock3 className="size-4" aria-hidden="true" />
              )}
            </span>
            <span className="text-sm font-semibold text-navy">{t(item.labelKey)}</span>
          </li>
        ))}
      </ol>
      {view.blockers.length > 0 ? (
        <div className="mt-4 rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm leading-6 text-warning">
          {t('readiness.budgetBlocker')}
        </div>
      ) : null}
      </>
      )}
    </section>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { StrategyResource } from '@marketmind/contracts'
import type { StrategyProfileSummary as StrategyProfileSummaryData } from '../lib/strategy-fixtures'
import { strategyCanBeApproved, getReadinessItems } from '../lib/strategy-state'
import { StrategyBadge } from './strategy-badge'
import { StrategyProfileSummary } from './strategy-profile-summary'
import { StrategyReadiness } from './strategy-readiness'

export function StrategyReview({
  profile,
  resource,
}: {
  readonly profile: StrategyProfileSummaryData | null
  readonly resource: StrategyResource
}) {
  const t = useTranslations('Strategy')
  const canApprove = strategyCanBeApproved(resource)
  const readinessItems = getReadinessItems(resource, profile !== null)

  const reviewSections = [
    { id: 'summary' as const, titleKey: 'review.sections.summary.title' as const, bodyKey: 'review.sections.summary.body' as const, sourceKey: 'review.sources.profile' as const },
    { id: 'channels' as const, titleKey: 'review.sections.channels.title' as const, bodyKey: 'review.sections.channels.body' as const, sourceKey: 'review.sources.guidance' as const },
    { id: 'budget' as const, titleKey: 'review.sections.budget.title' as const, bodyKey: 'review.sections.budget.body' as const, sourceKey: 'review.sources.ownerChoice' as const },
  ]

  return (
    <section className="grid gap-5">
      <header className="grid gap-3 rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <StrategyBadge tone="good">{t('demoBadge')}</StrategyBadge>
        <h1 className="text-3xl font-bold md:text-4xl">{t('review.title')}</h1>
        <p className="max-w-2xl text-sm leading-7 text-white/75">{t('review.subtitle')}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid gap-5">
          <StrategyProfileSummary profile={profile} />
          {reviewSections.map((section) => (
            <article key={section.id} className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-navy">{t(section.titleKey)}</h2>
                <StrategyBadge>{t(section.sourceKey)}</StrategyBadge>
              </div>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{t(section.bodyKey)}</p>
            </article>
          ))}
        </div>
        <aside className="grid gap-4 lg:sticky lg:top-24">
          <StrategyReadiness resource={resource} readiness={readinessItems} />
          <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
            <h2 className="text-lg font-bold text-navy">{t('decision.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {canApprove ? t('decision.readyBody') : t('decision.blockedBody')}
            </p>
            <div className="mt-4 grid gap-2">
              <Button type="button" disabled={!canApprove}>
                {t('decision.approve')}
              </Button>
              <Button type="button" variant="outline" disabled>
                {t('decision.revise')}
              </Button>
              <Button type="button" variant="ghost" disabled>
                {t('decision.reject')}
              </Button>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              {t('decision.safetyNote')}
            </p>
          </section>
        </aside>
      </div>
    </section>
  )
}

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
  const plan = resource.latest_plan

  const reviewSections = [
    {
      id: 'summary' as const,
      titleKey: 'review.sections.summary.title' as const,
      bodyItems: plan
        ? [plan.executive_summary.text, plan.situation_diagnosis.text]
        : [t('review.sections.summary.body')],
      sourceKey: 'review.sources.profile' as const,
    },
    {
      id: 'channels' as const,
      titleKey: 'review.sections.channels.title' as const,
      bodyItems: plan?.selected_channels.length
        ? plan.selected_channels.map((channel) => `${channel.channel}: ${channel.rationale.text}`)
        : [t('review.sections.channels.body')],
      sourceKey: 'review.sources.guidance' as const,
    },
    {
      id: 'budget' as const,
      titleKey: 'review.sections.budget.title' as const,
      bodyItems: plan ? budgetAndKpiItems(plan, t('review.sections.budget.body')) : [t('review.sections.budget.body')],
      sourceKey: 'review.sources.ownerChoice' as const,
    },
  ]

  return (
    <section className="grid gap-5">
      <header className="grid gap-3 rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <StrategyBadge tone="good">{t('review.badge')}</StrategyBadge>
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
              <ul className="mt-3 grid gap-2 text-sm leading-7 text-muted-foreground">
                {section.bodyItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
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

function budgetAndKpiItems(plan: NonNullable<StrategyResource['latest_plan']>, fallback: string): string[] {
  const scenarioItems = plan.budget_scenarios?.map((scenario) => `${scenario.total_egp} ${scenario.currency}: ${scenario.notes.text}`) ?? []
  const kpiItems = plan.kpi_targets.map((target) => `${target.metric}: ${target.target_value ?? target.measurement_method}`)
  const items = [...scenarioItems, ...kpiItems, ...plan.blockers.map((blocker) => blocker.message)]
  return items.length > 0 ? items : [fallback]
}

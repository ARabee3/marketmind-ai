'use client'

import { ArrowUpRight, ListChecks } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type {
  OwnerAdviceItem,
  StrategyPlanV2,
} from '@marketmind/contracts'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { StrategyBadge } from './strategy-badge'

/**
 * Immutable-version owner advice page. Groups actions by "Before week 1" and
 * Weeks 1–12, and links back to the relevant calendar week. There are no
 * completion checkboxes or task-management scope in this release.
 */
export function StrategyAdvice({
  strategyId,
  plan,
}: {
  readonly strategyId: string
  readonly plan: StrategyPlanV2
}) {
  const t = useTranslations('Strategy')

  return (
    <section className="grid gap-5">
      <header className="grid gap-3 rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <StrategyBadge tone="good">{t('advice.badge')}</StrategyBadge>
        <h1 className="text-3xl font-bold md:text-4xl">{t('advice.title')}</h1>
        <p className="max-w-2xl text-sm leading-7 text-white/75">
          {t('advice.subtitle')}
        </p>
        <div>
          <Link
            href={`/strategy/${strategyId}/review`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40"
          >
            {t('advice.backToReview')}
            <ArrowUpRight className="size-4 rtl:scale-x-[-1]" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <AdviceBucket
        id="before-week-1"
        title={t('advice.beforeWeek1')}
        body={t('advice.beforeWeek1Body')}
        items={plan.owner_advice.before_week_1}
        strategyId={strategyId}
      />

      {plan.owner_advice.weeks.map((group) => (
        <AdviceBucket
          key={group.week_number}
          id={`week-${group.week_number}`}
          title={t('advice.weekBucket', { week: group.week_number })}
          items={group.items}
          strategyId={strategyId}
          weekNumber={group.week_number}
        />
      ))}
    </section>
  )
}

function AdviceBucket({
  id,
  title,
  body,
  items,
  strategyId,
  weekNumber,
}: {
  readonly id: string
  readonly title: string
  readonly body?: string
  readonly items: readonly OwnerAdviceItem[]
  readonly strategyId: string
  readonly weekNumber?: number
}) {
  const t = useTranslations('Strategy')
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-navy md:text-2xl">{title}</h2>
          {body ? (
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
          ) : null}
        </div>
        {weekNumber !== undefined ? (
          <Link
            href={`/strategy/${strategyId}/review#week-${weekNumber}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-action underline underline-offset-4"
          >
            {t('advice.weekLink')}
            <ArrowUpRight className="size-3 rtl:scale-x-[-1]" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
          {t('advice.empty')}
        </p>
      ) : (
        <ol className="mt-4 grid gap-3">
          {items.map((item) => (
            <AdviceItem key={item.id} item={item} />
          ))}
        </ol>
      )}
    </section>
  )
}

function AdviceItem({ item }: { readonly item: OwnerAdviceItem }) {
  const t = useTranslations('Strategy')
  return (
    <li className="grid gap-3 rounded-lg border border-border bg-background p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="grid gap-2">
        <p className="flex items-start gap-2">
          <ListChecks className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-sm font-bold leading-6 text-navy">
            {t('advice.action')}: <bdi>{item.action}</bdi>
          </span>
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('advice.why')}: <bdi>{item.why_it_matters}</bdi>
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          {t('advice.timing')}: <bdi>{item.timing}</bdi>
        </p>
      </div>
      <div className="grid content-start gap-2 md:justify-items-end">
        <StrategyBadge tone={item.source.source === 'model_synthesis' ? 'warning' : 'neutral'}>
          {t(`advice.categories.${item.category}`)}
        </StrategyBadge>
        <p
          className={cn(
            'rounded-lg border p-3 text-xs leading-5',
            item.source.confidence_note
              ? 'border-warning/20 bg-warning/10 text-warning'
              : 'border-border bg-surface text-muted-foreground',
          )}
        >
          <bdi>{item.source.text}</bdi>
        </p>
      </div>
    </li>
  )
}

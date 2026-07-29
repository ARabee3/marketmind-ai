'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { StrategyVersionSummary } from '@marketmind/contracts'
import { StrategyBadge } from './strategy-badge'

export function StrategyVersionHistory({
  versions,
}: {
  readonly versions: readonly StrategyVersionSummary[]
}) {
  const t = useTranslations('Strategy')
  const format = useFormatter()

  return (
    <section className="grid gap-5">
      <header className="rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <StrategyBadge tone="good">{t('demoBadge')}</StrategyBadge>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('history.title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">{t('history.subtitle')}</p>
      </header>
      <ol className="grid gap-4">
        {versions.map((version) => (
          <li key={`${version.strategy_id}-${version.version}`} className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
                  {t('history.draftNumber', { version: version.version })}
                </p>
                <h2 className="mt-2 text-xl font-bold text-navy">
                  {t(`history.status.${version.status}`)}
                </h2>
              </div>
              <StrategyBadge tone={version.status === 'failed' ? 'danger' : version.status === 'approved' ? 'good' : 'neutral'}>
                {t(`history.status.${version.status}`)}
              </StrategyBadge>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {t('history.createdAt', {
                date: format.dateTime(new Date(version.created_at), { dateStyle: 'medium' }),
              })}
            </p>
            {version.decision ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t('history.decisionSaved')}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

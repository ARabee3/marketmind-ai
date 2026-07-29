'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { StrategyProfileSummary as StrategyProfileSummaryData } from '../lib/strategy-fixtures'
import { StrategyBadge } from './strategy-badge'

export function StrategyProfileSummary({
  profile,
}: {
  readonly profile: StrategyProfileSummaryData | null
}) {
  const t = useTranslations('Strategy')
  const format = useFormatter()

  if (!profile) {
    return (
      <section className="rounded-xl border border-warning/25 bg-warning/10 p-4">
        <StrategyBadge tone="warning">{t('profile.lockedBadge')}</StrategyBadge>
        <h2 className="mt-3 text-xl font-bold text-navy">{t('profile.lockedTitle')}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('profile.lockedBody')}</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
            {t('profile.label')}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-navy">
            <bdi>{profile.businessName}</bdi>
          </h2>
        </div>
        <StrategyBadge tone="good">{t('profile.confirmedBadge')}</StrategyBadge>
      </div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
        <ProfileFact label={t('profile.type')} value={profile.businessType} />
        <ProfileFact label={t('profile.location')} value={profile.location} />
        <ProfileFact
          label={t('profile.confirmedAt')}
          value={format.dateTime(new Date(profile.confirmedAt), { dateStyle: 'medium' })}
        />
        <ProfileFact label={t('profile.version')} value={t('profile.versionValue', { version: profile.version })} />
      </dl>
    </section>
  )
}

function ProfileFact({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold text-navy">
        <bdi>{value}</bdi>
      </dd>
    </div>
  )
}

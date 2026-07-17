'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { buttonVariants } from '@/components/ui/button'
import type { DashboardJourneyState } from './dashboard-state'

export function DashboardLoading() {
  const t = useTranslations('Dashboard')

  return (
    <section className="grid gap-5" aria-busy="true">
      <div className="grid gap-3">
        <div className="h-3 w-28 rounded-full bg-muted" />
        <h1 className="text-3xl font-bold text-navy">{t('loadingTitle')}</h1>
        <p className="max-w-xl text-muted-foreground">{t('loadingBody')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-56 rounded-xl border border-border bg-surface p-5 shadow-elevated" />
        <div className="min-h-56 rounded-xl border border-border bg-surface p-5 shadow-elevated" />
      </div>
    </section>
  )
}

export function NextActionPanel({ journey }: { readonly journey: DashboardJourneyState }) {
  const t = useTranslations('Dashboard')

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <div className="border-b border-border bg-soft-teal px-4 py-3 md:px-5">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t('nextStepLabel')}
        </p>
      </div>
      <div className="grid gap-5 p-4 md:p-5">
        <div className="grid gap-2">
          <h2 className="text-2xl font-bold text-navy">
            {t(`state.${journey.kind}.title`)}
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {t(`state.${journey.kind}.body`)}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {journey.primaryHref ? (
            <Link
              href={journey.primaryHref}
              className={buttonVariants({ size: 'lg', className: 'shadow-tactile' })}
            >
              {t(`actions.${journey.primaryActionType}`)}
            </Link>
          ) : null}
          <p className="text-xs leading-5 text-muted-foreground">
            {t(`strategy.${journey.strategyLockedReason}`)}
          </p>
        </div>
      </div>
    </article>
  )
}

export function BusinessSnapshot({ journey }: { readonly journey: DashboardJourneyState }) {
  const t = useTranslations('Dashboard')
  const hasBusiness = journey.businessName !== null

  return (
    <aside className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-5">
      <div className="grid gap-1">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t('snapshotLabel')}
        </p>
        <h2 className="text-xl font-bold text-navy">
          {hasBusiness ? journey.businessName : t('snapshotEmptyTitle')}
        </h2>
      </div>

      <dl className="mt-5 grid gap-3 text-sm">
        <SnapshotRow label={t('businessType')} value={journey.businessType} />
        <SnapshotRow label={t('location')} value={journey.location} />
        <SnapshotRow
          label={t('readiness')}
          value={
            journey.readinessPercent === null
              ? null
              : t('readinessValue', { value: journey.readinessPercent })
          }
        />
        <SnapshotRow
          label={t('profileVersion')}
          value={
            journey.profileVersion === null
              ? null
              : t('profileVersionValue', { value: journey.profileVersion })
          }
        />
      </dl>
    </aside>
  )
}

function SnapshotRow({
  label,
  value,
}: {
  readonly label: string
  readonly value: string | null
}) {
  const t = useTranslations('Dashboard')

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium text-navy">{value ?? t('notAvailable')}</dd>
    </div>
  )
}

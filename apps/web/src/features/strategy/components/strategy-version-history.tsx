'use client'

import { useFormatter, useTranslations } from 'next-intl'
import type { StrategyVersionSummary } from '@marketmind/contracts'
import { Link } from '@/i18n/navigation'
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
        <StrategyBadge tone="good">{t('history.badge')}</StrategyBadge>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{t('history.title')}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-white/75">{t('history.subtitle')}</p>
      </header>
      {versions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface p-5 text-sm text-muted-foreground">
          {t('history.empty')}
        </p>
      ) : (
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
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <HistoryFact
                label={t('history.profileVersion')}
                value={String(version.profile_version.version)}
              />
              <HistoryFact
                label={t('history.retrievalRun')}
                value={version.retrieval_run_id}
              />
              <HistoryFact
                label={t('history.versionId')}
                value={version.version_id}
              />
              {Object.entries(version.prompt_config).map(([key, value]) => (
                <HistoryFact key={key} label={key} value={String(value)} />
              ))}
            </dl>
            {version.decision ? (
              <div className="mt-4 rounded-lg border border-border bg-background p-3">
                <p className="text-sm font-bold text-navy">
                  {t(`history.decisions.${version.decision.decision}`)}
                </p>
                {version.decision.revision_notes ? (
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {version.decision.revision_notes}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {format.dateTime(new Date(version.decision.decided_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            ) : null}
            <div className="mt-4 flex justify-end">
              <Link
                href={`/strategy/${version.strategy_id}/versions/${version.version}`}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-semibold text-navy hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {t('history.openVersion')}
              </Link>
            </div>
          </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function HistoryFact({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-semibold text-navy">{value}</dd>
    </div>
  )
}

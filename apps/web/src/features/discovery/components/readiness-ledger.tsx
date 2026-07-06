'use client'

import { useTranslations, useFormatter } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DiscoveryReadiness, UncertaintyInput } from '@marketmind/contracts'
import { cn } from '@/lib/utils'

function ScoreBar({ label, score, blocked }: { label: string; score: number; blocked?: boolean }) {
  const fmt = useFormatter()
  const pct = Math.round(score * 100)
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={cn('w-24 shrink-0 truncate', blocked ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div
          className={cn('h-full rounded-full', blocked ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('w-10 text-end tabular-nums', blocked ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
        {fmt.number(score, { style: 'percent' })}
      </span>
    </div>
  )
}

export function ReadinessLedger({
  readiness,
  uncertainties,
}: {
  readiness: DiscoveryReadiness
  uncertainties: UncertaintyInput[]
}) {
  const t = useTranslations('DiscoveryInterview')
  const tReview = useTranslations('DiscoveryReview')
  const fmt = useFormatter()

  const highSeverity = uncertainties.filter((u) => u.severity === 'high')
  const otherSeverity = uncertainties.filter((u) => u.severity !== 'high')

  const domainLabels: Record<string, string> = {
    identity: t('domainIdentity'),
    offer: t('domainOffer'),
    customers: t('domainCustomers'),
    differentiation: t('domainDifferentiation'),
    current_marketing: t('domainCurrentMarketing'),
    goals_and_constraints: t('domainGoals'),
    market_context: t('domainMarketContext'),
  }

  function severityLabel(u: UncertaintyInput): string {
    return tReview(`severity_${u.severity}`)
  }

  return (
    <Card className="border-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-navy">{t('readinessTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall readiness */}
        <div className="space-y-2">
          <ScoreBar label={t('overallReadiness')} score={readiness.profile_readiness} />
          <ScoreBar label={t('researchConfidence')} score={readiness.domain_scores.research_confidence} />
        </div>

        {/* Domain scores */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('domainScores')}
          </h4>
          {readiness.blocking_domains.length > 0 && (
            <p className="text-xs text-destructive font-medium">{t('blockingDomainsLabel')}</p>
          )}
          <div className="space-y-1.5">
            {(
              [
                'identity',
                'offer',
                'customers',
                'differentiation',
                'current_marketing',
                'goals_and_constraints',
                'market_context',
              ] as const
            ).map((domain) => (
              <ScoreBar
                key={domain}
                label={domainLabels[domain] ?? domain}
                score={readiness.domain_scores[domain]}
                blocked={readiness.blocking_domains.includes(domain)}
              />
            ))}
          </div>
        </div>

        {/* Turn count */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('turnCountLabel')}</span>
          <span className="tabular-nums font-medium text-navy">
            {fmt.number(readiness.owner_turn_count)} / {fmt.number(readiness.max_owner_turns)}
          </span>
        </div>

        {/* Uncertainties */}
        {uncertainties.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tReview('uncertaintiesTitle')}
            </h4>
            {highSeverity.length > 0 && (
              <div className="space-y-1">
                {highSeverity.map((u) => (
                  <div
                    key={u.field_key}
                    className="flex items-start gap-2 text-sm text-destructive"
                  >
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                    <span className="min-w-0">
                      <span className="font-medium">{domainLabels[u.domain] ?? u.domain}</span>
                      <span className="block text-xs opacity-90 break-words">
                        {severityLabel(u)}: {u.description}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {otherSeverity.length > 0 && (
              <div className="space-y-1">
                {otherSeverity.map((u) => (
                  <div
                    key={u.field_key}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span className="min-w-0">
                      <span className="font-medium">{domainLabels[u.domain] ?? u.domain}</span>
                      <span className="block text-xs opacity-80 break-words">
                        {severityLabel(u)}: {u.description}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { BusinessProfileDraft } from '@marketmind/contracts'
import { cn } from '@/lib/utils'

export function ConfirmationSuccess({
  draft,
  onRefresh,
}: {
  draft: BusinessProfileDraft
  onRefresh?: () => void
}) {
  const t = useTranslations('DiscoveryReview')

  const unresolved = draft.uncertainties.filter((u) => !u.resolved)
  const readiness = draft.readiness

  const domainLabels: Record<string, string> = {
    identity: t('domainIdentity'),
    offer: t('domainOffer'),
    customers: t('domainCustomers'),
    differentiation: t('domainDifferentiation'),
    current_marketing: t('domainCurrentMarketing'),
    goals_and_constraints: t('domainGoals'),
    market_context: t('domainMarketContext'),
  }

  return (
    <div className="space-y-6">
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-navy">{t('confirmedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="p-4 rounded-md bg-primary/10 text-primary border border-primary/20"
            role="status"
          >
            <p className="text-sm font-medium">{t('strategyUnlocked')}</p>
          </div>

          <p className="text-sm text-muted-foreground">{t('confirmedDescription')}</p>
        </CardContent>
      </Card>

      {/* Carried-forward gaps */}
      {(unresolved.length > 0 || readiness.blocking_domains.length > 0) && (
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-navy">{t('carriedForwardGaps')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {readiness.blocking_domains.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-warning">{t('blockingDomainsLabel')}</h4>
                <ul className="list-disc list-inside text-sm">
                  {readiness.blocking_domains.map((domain) => (
                    <li key={domain}>{domainLabels[domain] ?? domain}</li>
                  ))}
                </ul>
              </div>
            )}
            {unresolved.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-warning">{t('unresolvedUncertainties')}</h4>
                <div className="space-y-2">
                  {unresolved.map((u) => (
                    <div key={u.field_key} className="p-3 rounded-md bg-warning/5 border border-warning/20">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'text-xs font-bold uppercase px-1.5 py-0.5 rounded',
                            u.severity === 'high'
                              ? 'bg-destructive/10 text-destructive'
                              : u.severity === 'medium'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {t(`severity_${u.severity}`)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {domainLabels[u.domain] ?? u.domain}
                        </span>
                      </div>
                      <p className="text-sm mt-1 break-words">
                        <bdi>{u.description}</bdi>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {onRefresh && (
        <Button variant="outline" onClick={onRefresh} className="w-full">
          {t('refreshStatus')}
        </Button>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type {
  BusinessProfileDraft,
  DiscoveryStatusResponse,
  SourceRef,
  SourceType,
  MarketEvidence,
  ResearchObservation,
} from '@marketmind/contracts'
import { cn } from '@/lib/utils'

function NotProvided() {
  const t = useTranslations('DiscoveryReview')
  return <span className="text-muted-foreground italic text-sm">{t('notProvided')}</span>
}

function FactList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <NotProvided />
  return (
    <ul className="list-disc list-inside text-sm space-y-0.5">
      {items.map((item, idx) => (
        <li key={idx} className="break-words">
          <bdi>{item}</bdi>
        </li>
      ))}
    </ul>
  )
}

function FactValue({ value }: { value?: string }) {
  if (!value) return <NotProvided />
  return (
    <p className="text-sm break-words">
      <bdi>{value}</bdi>
    </p>
  )
}

function isValidHttpUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function EvidenceSection({
  title,
  items,
  sourceRefs,
  sourceTypeLabel,
}: {
  title: string
  items: MarketEvidence[]
  sourceRefs: SourceRef[]
  sourceTypeLabel: (sourceType: SourceType) => string
}) {
  if (!items || items.length === 0) return null

  const sourceMap = new Map(sourceRefs.map((s) => [s.id, s]))

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-navy">{title}</h4>
      <div className="space-y-2">
        {items.map((ev) => {
          const source = ev.source_ref_id ? sourceMap.get(ev.source_ref_id) : undefined
          return (
            <div key={ev.observation_id} className="p-3 rounded-md bg-muted/50 border border-border min-w-0">
              <p className="text-sm break-words">
                <bdi>{ev.statement}</bdi>
              </p>
              {source && (
                <div className="mt-1 text-xs text-muted-foreground break-words">
                  {isValidHttpUrl(source.url) ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-primary break-words"
                    >
                      {source.title || source.url}
                    </a>
                  ) : (
                    <span>{source.title || sourceTypeLabel(source.source_type)}</span>
                  )}
                  {source.snippet && <span className="block mt-0.5 italic break-words">{source.snippet}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ObservationSection({
  title,
  observations,
  sourceRefs,
  sourceTypeLabel,
}: {
  title: string
  observations: ResearchObservation[]
  sourceRefs: SourceRef[]
  sourceTypeLabel: (sourceType: SourceType) => string
}) {
  if (!observations || observations.length === 0) return null

  const sourceMap = new Map(sourceRefs.map((s) => [s.id, s]))

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-navy">{title}</h4>
      <div className="space-y-2">
        {observations.map((obs) => {
          const source = obs.source_ref_id ? sourceMap.get(obs.source_ref_id) : undefined
          return (
            <div key={obs.id} className="p-3 rounded-md bg-muted/50 border border-border min-w-0">
              <p className="text-sm break-words">
                <bdi>{obs.statement}</bdi>
              </p>
              {source && (
                <div className="mt-1 text-xs text-muted-foreground break-words">
                  {isValidHttpUrl(source.url) ? (
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-primary break-words"
                    >
                      {source.title || source.url}
                    </a>
                  ) : (
                    <span>{source.title || sourceTypeLabel(source.source_type)}</span>
                  )}
                  {source.snippet && <span className="block mt-0.5 italic break-words">{source.snippet}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DraftReview({
  status,
  draft,
  pending,
  onConfirm,
  disabled,
}: {
  status: DiscoveryStatusResponse
  draft: BusinessProfileDraft
  pending: boolean
  onConfirm: (acknowledgeIncomplete: boolean) => void
  disabled?: boolean
}) {
  const t = useTranslations('DiscoveryReview')
  const fmt = useFormatter()
  const [acknowledged, setAcknowledged] = useState(false)

  const isComplete = draft.completeness === 'complete'
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
  const sourceTypeLabel = (sourceType: SourceType) => t(`citationSource_${sourceType}`)

  const facts = draft.confirmed_facts
  const sourceRefs = status.intelligence.source_refs

  const unresolved = draft.uncertainties.filter((u) => !u.resolved)
  const resolved = draft.uncertainties.filter((u) => u.resolved)

  const canConfirm = isComplete || acknowledged

  // Deduplicate research_observations against market_context evidence
  const marketEvidenceIds = new Set<string>()
  Object.values(draft.market_context).forEach((group: MarketEvidence[]) => {
    group.forEach((ev) => marketEvidenceIds.add(ev.observation_id))
  })

  const visibleObservations = draft.research_observations.filter(
    (obs) =>
      obs.status === 'accepted' &&
      obs.visibility === 'owner_visible' &&
      !marketEvidenceIds.has(obs.id),
  )

  const hasAnyEvidence =
    draft.market_context.competitor_landscape.length > 0 ||
    draft.market_context.local_demand_signals.length > 0 ||
    draft.market_context.digital_presence_signals.length > 0 ||
    draft.market_context.other_signals.length > 0 ||
    visibleObservations.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-navy">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('completenessLabel')}:{' '}
            <span className={cn('font-medium', isComplete ? 'text-primary' : 'text-warning')}>
              {isComplete ? t('complete') : t('incomplete')}
            </span>
            {' · '}
            {t('completionReasonLabel')}: {t(`reason_${draft.completion_reason}`)}
          </p>
        </div>
        <div className="text-end">
          <p className="text-sm text-muted-foreground">
            {t('readinessLabel')}: {fmt.number(readiness.profile_readiness, { style: 'percent' })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('turnCountLabel')}: {fmt.number(readiness.owner_turn_count)} / {fmt.number(readiness.max_owner_turns)}
          </p>
        </div>
      </div>

      {/* Blocking domains */}
      {readiness.blocking_domains.length > 0 && (
        <div
          className="p-4 rounded-md bg-warning/10 text-warning border border-warning/20"
          role="status"
        >
          <p className="text-sm font-medium">{t('blockingDomainsLabel')}</p>
          <ul className="text-sm list-disc list-inside">
            {readiness.blocking_domains.map((domain) => (
              <li key={domain}>{domainLabels[domain] ?? domain}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Facts */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-navy">{t('confirmedFactsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Identity */}
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-navy">{t('domainIdentity')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span className="text-xs text-muted-foreground">{t('businessName')}</span>
                <FactValue value={facts.identity.business_name} />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('businessType')}</span>
                <FactValue value={facts.identity.business_type} />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('city')}</span>
                <FactValue value={facts.identity.city} />
              </div>
              <div>
                <span className="text-xs text-muted-foreground">{t('area')}</span>
                <FactValue value={facts.identity.area} />
              </div>
            </div>
          </div>

          {/* Offer */}
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-navy">{t('domainOffer')}</h4>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('coreOfferings')}</span>
              <FactList items={facts.offer.core_offerings} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('bestSellers')}</span>
              <FactList items={facts.offer.best_sellers} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('priceRange')}</span>
              <FactValue value={facts.offer.price_range} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('purchaseOccasions')}</span>
              <FactList items={facts.offer.purchase_occasions} />
            </div>
          </div>

          {/* Customers */}
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-navy">{t('domainCustomers')}</h4>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('primarySegments')}</span>
              <FactList items={facts.customers.primary_segments} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('visitOrOrderOccasions')}</span>
              <FactList items={facts.customers.visit_or_order_occasions} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('peakPeriods')}</span>
              <FactList items={facts.customers.peak_periods} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('customerNeeds')}</span>
              <FactList items={facts.customers.customer_needs} />
            </div>
          </div>

          {/* Differentiation */}
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-navy">{t('domainDifferentiation')}</h4>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('ownerClaimedStrengths')}</span>
              <FactList items={facts.differentiation.owner_claimed_strengths} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('customerChoiceReasons')}</span>
              <FactList items={facts.differentiation.customer_choice_reasons} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('proofPoints')}</span>
              <FactList items={facts.differentiation.proof_points} />
            </div>
          </div>

          {/* Current Marketing */}
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-navy">{t('domainCurrentMarketing')}</h4>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('activeChannels')}</span>
              <FactList items={facts.current_marketing.active_channels} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('currentActivities')}</span>
              <FactList items={facts.current_marketing.current_activities} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('deliveryPlatforms')}</span>
              <FactList items={facts.current_marketing.delivery_platforms} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('availableAssets')}</span>
              <FactList items={facts.current_marketing.available_assets} />
            </div>
          </div>

          {/* Goals */}
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-navy">{t('domainGoals')}</h4>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('growthGoals')}</span>
              <FactList items={facts.goals_and_constraints.growth_goals} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('timeframe')}</span>
              <FactValue value={facts.goals_and_constraints.timeframe} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('marketingBudgetRange')}</span>
              <FactValue value={facts.goals_and_constraints.marketing_budget_range} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('teamCapacity')}</span>
              <FactValue value={facts.goals_and_constraints.team_capacity} />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t('operationalConstraints')}</span>
              <FactList items={facts.goals_and_constraints.operational_constraints} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Owner goals & notes */}
      {(draft.owner_goals.length > 0 || draft.strategy_relevant_notes.length > 0) && (
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base text-navy">{t('ownerGoalsAndNotes')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {draft.owner_goals.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-navy mb-1">{t('ownerGoals')}</h4>
                <FactList items={draft.owner_goals} />
              </div>
            )}
            {draft.strategy_relevant_notes.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-navy mb-1">{t('strategyNotes')}</h4>
                <div className="space-y-1">
                  {draft.strategy_relevant_notes.map((note, idx) => (
                    <p key={idx} className="text-sm text-muted-foreground break-words">
                      <bdi>{note}</bdi>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Market context evidence */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-navy">{t('marketEvidenceTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasAnyEvidence ? (
            <>
              <EvidenceSection
                title={t('competitorLandscape')}
                items={draft.market_context.competitor_landscape}
                sourceRefs={sourceRefs}
                sourceTypeLabel={sourceTypeLabel}
              />
              <EvidenceSection
                title={t('localDemandSignals')}
                items={draft.market_context.local_demand_signals}
                sourceRefs={sourceRefs}
                sourceTypeLabel={sourceTypeLabel}
              />
              <EvidenceSection
                title={t('digitalPresenceSignals')}
                items={draft.market_context.digital_presence_signals}
                sourceRefs={sourceRefs}
                sourceTypeLabel={sourceTypeLabel}
              />
              <EvidenceSection
                title={t('otherSignals')}
                items={draft.market_context.other_signals}
                sourceRefs={sourceRefs}
                sourceTypeLabel={sourceTypeLabel}
              />
              <ObservationSection
                title={t('observationsTitle')}
                observations={visibleObservations}
                sourceRefs={sourceRefs}
                sourceTypeLabel={sourceTypeLabel}
              />
            </>
          ) : (
            <NotProvided />
          )}
        </CardContent>
      </Card>

      {/* Uncertainties */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-navy">{t('uncertaintiesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {unresolved.length === 0 && resolved.length === 0 && <NotProvided />}
          {unresolved.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-warning">{t('unresolvedUncertainties')}</h4>
              <div className="space-y-2">
                {unresolved.map((u) => (
                  <div
                    key={u.field_key}
                    className="p-3 rounded-md bg-warning/5 border border-warning/20"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
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
                      <span className="text-xs text-muted-foreground">
                        · {t('sourceLabel')}: {t(`source_${u.source}`)}
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
          {resolved.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-primary">{t('resolvedUncertainties')}</h4>
              <div className="space-y-2">
                {resolved.map((u) => (
                  <div
                    key={u.field_key}
                    className="p-3 rounded-md bg-muted/50 border border-border"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {t('resolved')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {domainLabels[u.domain] ?? u.domain}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {t('sourceLabel')}: {t(`source_${u.source}`)}
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

      {/* Confirmation controls */}
      <div className="space-y-4 pt-4 border-t border-border">
        {!isComplete && (
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              disabled={pending || disabled}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="font-normal break-words">{t('acknowledgeIncomplete')}</span>
          </label>
        )}
        <Button
          onClick={() => onConfirm(!isComplete && acknowledged)}
          disabled={disabled || pending || !canConfirm}
          className="w-full"
          size="lg"
        >
          {pending ? t('confirmingLabel') : t('confirmProfile')}
        </Button>
      </div>
    </div>
  )
}

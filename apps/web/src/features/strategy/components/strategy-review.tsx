'use client'

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Dialog } from '@base-ui/react/dialog'
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  History,
  Link2,
  ShieldAlert,
} from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import type {
  BudgetScenario,
  ChannelScorecard,
  KpiTarget,
  RetrievedKnowledgeItem,
  RetrievedKnowledgePack,
  SourcedClaim,
  StrategyPlan,
  StrategyProgressEvent,
  StrategyResource,
} from '@marketmind/contracts'
import { Button } from '@/components/ui/button'
import { Link, useRouter } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { useStrategyActions } from '../hooks/use-strategy-actions'
import { isStrategyPlanV2 } from '../lib/strategy-v2'
import type { StrategyProfileSummary as ProfileSummary } from '../lib/strategy-fixtures'
import { StrategyBadge } from './strategy-badge'
import { StrategyProfileSummary } from './strategy-profile-summary'
import { StrategyReviewV2 } from './strategy-review-v2'

type DecisionAction = 'approve' | 'revision_requested' | 'reject'

const EvidenceContext = createContext<{
  readonly citations: ReadonlyMap<string, StrategyPlan['citations'][number]>
  readonly retrieval: RetrievedKnowledgePack | null
}>({
  citations: new Map(),
  retrieval: null,
})

export function StrategyReview({
  profile,
  resource,
  currentVersionId,
  retrieval,
  progress,
  onRefresh,
  readOnly = false,
}: {
  readonly profile: ProfileSummary | null
  readonly resource: StrategyResource
  readonly currentVersionId: string | null
  readonly retrieval: RetrievedKnowledgePack | null
  readonly progress: readonly StrategyProgressEvent[]
  readonly onRefresh: () => Promise<void>
  readonly readOnly?: boolean
}) {
  const t = useTranslations('Strategy')
  const router = useRouter()
  const latest = resource.latest_plan
  const { decide, retry, pending, error } = useStrategyActions()
  const [decision, setDecision] = useState<DecisionAction | null>(null)
  const [feedback, setFeedback] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [evidencePending, setEvidencePending] = useState(false)

  // Owner-first strategy-v2 plans render on the calendar-first review.
  // Hooks above stay unconditional; this is a pure render-time dispatch.
  const isV2 = latest !== null && isStrategyPlanV2(latest)
  const plan = isV2 ? null : (latest as StrategyPlan | null)

  const evidence = useMemo(
    () => inspectEvidence(plan, retrieval),
    [plan, retrieval],
  )
  const evidenceContext = useMemo(
    () => ({
      citations: new Map(
        plan?.citations.map((citation) => [citation.citation_id, citation]) ??
          [],
      ),
      retrieval,
    }),
    [plan, retrieval],
  )
  const blockingItems =
    plan?.blockers.filter((blocker) => blocker.severity === 'blocking') ?? []
  const profileIsCurrent =
    readOnly ||
    (Boolean(profile) &&
      Boolean(plan) &&
      profile?.version === plan?.profile_version.version &&
      resource.brief?.business_profile_version.business_profile_version_id ===
        plan?.profile_version.business_profile_version_id)
  const canApprove =
    !readOnly &&
    resource.status === 'draft' &&
    currentVersionId !== null &&
    blockingItems.length === 0 &&
    evidence.ready &&
    profileIsCurrent
  const lastFailure = [...progress]
    .reverse()
    .find((event) => event.status === 'failed')
  const canRetry =
    resource.status === 'failed' && lastFailure?.retryable === true

  async function submitDecision() {
    if (!decision || !currentVersionId) return
    if (decision !== 'approve' && !feedback.trim()) return
    const result = await decide(resource.strategy_id, {
      versionId: currentVersionId,
      action: decision,
      feedback: feedback.trim() || undefined,
    })
    if (!result) return
    setDecision(null)
    setFeedback('')
    if (result.nextStatus === 'needs_brief') {
      // The owner rejected the plan. The server wiped the whole strategy
      // cycle; route the owner back to the creation wizard to start over.
      router.push('/strategy/new')
      return
    }
    setNotice(t(`decision.success.${decision}`))
    await onRefresh()
  }

  async function submitRetry() {
    const result = await retry(resource.strategy_id)
    if (!result) return
    setNotice(t('decision.success.retry'))
    await onRefresh()
  }

  async function reloadEvidence() {
    setEvidencePending(true)
    try {
      await onRefresh()
    } finally {
      setEvidencePending(false)
    }
  }

  if (isV2 && latest) {
    return (
      <StrategyReviewV2
        profile={profile}
        resource={resource}
        currentVersionId={currentVersionId}
        retrieval={retrieval}
        progress={progress}
        onRefresh={onRefresh}
        readOnly={readOnly}
      />
    )
  }

  if (!plan) {
    return (
      <section className="rounded-xl border border-warning/25 bg-warning/10 p-5">
        <StrategyBadge tone="warning">
          {t('review.unavailableBadge')}
        </StrategyBadge>
        <h1 className="mt-3 text-2xl font-bold text-navy">
          {t('review.unavailableTitle')}
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {t('review.unavailableBody')}
        </p>
      </section>
    )
  }

  return (
    <EvidenceContext.Provider value={evidenceContext}>
      <section className="grid gap-5">
        <header className="grid gap-3 rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StrategyBadge tone="good">{t('review.badge')}</StrategyBadge>
            <Link
              href={`/strategy/${resource.strategy_id}/versions`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40"
            >
              <History className="size-4" aria-hidden="true" />
              {t('review.openHistory')}
            </Link>
          </div>
          <h1 className="text-3xl font-bold md:text-4xl">
            {t('review.title')}
          </h1>
          <p className="max-w-2xl text-sm leading-7 text-white/75">
            {t('review.subtitle')}
          </p>
        </header>

        {!profileIsCurrent ? (
          <StatusBanner
            tone="danger"
            title={t('review.staleProfileTitle')}
            body={t('review.staleProfileBody')}
          />
        ) : null}
        {!readOnly && retrieval === null ? (
          <StatusBanner
            tone="warning"
            title={t('review.evidenceLoadTitle')}
            body={t('review.evidenceLoadBody')}
            action={
              <Button
                type="button"
                variant="outline"
                disabled={evidencePending}
                onClick={reloadEvidence}
              >
                {t(
                  evidencePending
                    ? 'review.reloadingEvidence'
                    : 'review.reloadEvidence',
                )}
              </Button>
            }
          />
        ) : !readOnly && !evidence.ready ? (
          <StatusBanner
            tone="danger"
            title={t('review.invalidEvidenceTitle')}
            body={t('review.invalidEvidenceBody', {
              count: evidence.invalidCitationIds.length,
            })}
          />
        ) : null}
        {resource.status === 'failed' ? (
          <StatusBanner
            tone="danger"
            title={t('review.failedRevisionTitle')}
            body={
              canRetry
                ? t('review.failedRevisionRetryable')
                : t('review.failedRevisionNotRetryable')
            }
          />
        ) : null}

        <nav
          aria-label={t('review.sectionNavigation')}
          className="overflow-x-auto rounded-xl border border-border bg-surface p-2 shadow-elevated"
        >
          <ul className="flex min-w-max gap-1">
            {SECTION_IDS.map((id) => (
              <li key={id}>
                <a
                  href={`#strategy-${id}`}
                  className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-navy focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {t(`review.navigation.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="grid gap-5">
            {!readOnly || profile ? (
              <StrategyProfileSummary profile={profile} />
            ) : null}

            <ReviewSection
              id="overview"
              title={t('review.sections.overview.title')}
              why={t('review.sections.overview.why')}
            >
              <Claim
                claim={plan.executive_summary}
                retrieval={retrieval}
                label={t('review.fields.executiveSummary')}
              />
              <Claim
                claim={plan.situation_diagnosis}
                retrieval={retrieval}
                label={t('review.fields.situationDiagnosis')}
              />
            </ReviewSection>

            <ReviewSection
              id="direction"
              title={t('review.sections.direction.title')}
              why={t('review.sections.direction.why')}
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                <Fact
                  label={t('review.fields.objective')}
                  value={t(`review.objectives.${plan.primary_objective}`)}
                />
                <Fact
                  label={t('review.fields.funnelStage')}
                  value={plan.funnel_stage}
                />
                <Fact
                  label={t('review.fields.planLanguage')}
                  value={plan.plan_language}
                />
                <Fact
                  label={t('review.fields.ruleVersion')}
                  value={plan.channel_score_rule_version}
                />
              </dl>
              <Claim
                claim={plan.target_audience}
                retrieval={retrieval}
                label={t('review.fields.targetAudience')}
              />
              <Claim
                claim={plan.positioning}
                retrieval={retrieval}
                label={t('review.fields.positioning')}
              />
              <Claim
                claim={plan.tone}
                retrieval={retrieval}
                label={t('review.fields.tone')}
              />
            </ReviewSection>

            <ReviewSection
              id="channels"
              title={t('review.sections.channels.title')}
              why={t('review.sections.channels.why')}
            >
              {plan.all_channel_scores.length === 0 &&
              plan.selected_channels.length === 0 ? (
                <EmptyState>{t('review.empty.channels')}</EmptyState>
              ) : (
                <div className="grid gap-3">
                  {(plan.all_channel_scores.length
                    ? plan.all_channel_scores
                    : plan.selected_channels
                  ).map((channel) => (
                    <ChannelScore
                      key={channel.channel}
                      channel={channel}
                      selected={plan.selected_channels.some(
                        (selected) => selected.channel === channel.channel,
                      )}
                      retrieval={retrieval}
                    />
                  ))}
                </div>
              )}
            </ReviewSection>

            <ReviewSection
              id="content"
              title={t('review.sections.content.title')}
              why={t('review.sections.content.why')}
            >
              <div className="rounded-lg border border-action/20 bg-action/5 p-4">
                <p className="text-sm font-bold text-navy">
                  {t('review.contentBoundaryTitle')}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t('review.contentBoundaryBody')}
                </p>
              </div>
              <ClaimList
                title={t('review.fields.pillars')}
                claims={plan.content_strategy.pillars}
                retrieval={retrieval}
              />
              <ClaimList
                title={t('review.fields.formatMix')}
                claims={plan.content_strategy.format_mix}
                retrieval={retrieval}
              />
              <Fact
                label={t('review.fields.cadence')}
                value={plan.content_strategy.weekly_cadence}
              />
            </ReviewSection>

            <ReviewSection
              id="roadmap"
              title={t('review.sections.roadmap.title')}
              why={t('review.sections.roadmap.why')}
            >
              {plan.content_strategy.weeks.length === 0 ? (
                <EmptyState>{t('review.empty.roadmap')}</EmptyState>
              ) : (
                <ol className="grid gap-3 sm:grid-cols-2">
                  {plan.content_strategy.weeks.map((week) => (
                    <li
                      key={week.week_number}
                      className="rounded-lg border border-border bg-background p-4"
                    >
                      <p className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
                        {t('review.week', { week: week.week_number })}
                      </p>
                      <h3 className="mt-2 font-bold text-navy">{week.theme}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {week.formats.join(' · ')}
                      </p>
                      {week.notes ? (
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {week.notes}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </ReviewSection>

            <ReviewSection
              id="budget"
              title={t('review.sections.budget.title')}
              why={t('review.sections.budget.why')}
            >
              <p className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm leading-6 text-warning">
                {t('review.spendSafety')}
              </p>
              {plan.budget_scenarios?.length ? (
                <div className="grid gap-3">
                  {plan.budget_scenarios.map((scenario) => (
                    <Budget key={scenario.scenario_type} scenario={scenario} />
                  ))}
                </div>
              ) : (
                <EmptyState>{t('review.empty.budget')}</EmptyState>
              )}
            </ReviewSection>

            <ReviewSection
              id="measurement"
              title={t('review.sections.measurement.title')}
              why={t('review.sections.measurement.why')}
            >
              {plan.kpi_targets.length ? (
                <div className="grid gap-3">
                  {plan.kpi_targets.map((target) => (
                    <Kpi
                      key={`${target.metric}-${target.funnel_stage}`}
                      target={target}
                      retrieval={retrieval}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState>{t('review.empty.measurement')}</EmptyState>
              )}
            </ReviewSection>

            <ReviewSection
              id="risks"
              title={t('review.sections.risks.title')}
              why={t('review.sections.risks.why')}
            >
              <ClaimList
                title={t('review.fields.assumptions')}
                claims={plan.assumptions}
                retrieval={retrieval}
              />
              <ClaimList
                title={t('review.fields.risks')}
                claims={plan.risks}
                retrieval={retrieval}
              />
              <IssueList
                title={t('review.fields.knowledgeGaps')}
                items={plan.knowledge_gaps.map((gap) => ({
                  id: `${gap.category}-${gap.description}`,
                  message: gap.description,
                  blocking: gap.severity === 'blocking',
                }))}
              />
              <IssueList
                title={t('review.fields.blockers')}
                items={plan.blockers.map((blocker) => ({
                  id: `${blocker.code}-${blocker.message}`,
                  message: blocker.message,
                  blocking: blocker.severity === 'blocking',
                }))}
              />
            </ReviewSection>

            <ReviewSection
              id="evidence"
              title={t('review.sections.evidence.title')}
              why={t('review.sections.evidence.why')}
            >
              <dl className="grid gap-3 sm:grid-cols-2">
                <Fact
                  label={t('review.fields.retrievalRun')}
                  value={plan.retrieval_run_id}
                />
                <Fact
                  label={t('review.fields.profileVersion')}
                  value={String(plan.profile_version.version)}
                />
              </dl>
              <p className="text-sm leading-6 text-muted-foreground">
                {t('review.evidenceSummary', {
                  count: plan.citations.length,
                })}
              </p>
              <div className="grid gap-3">
                {plan.citations.map((citation) => (
                  <EvidenceDisclosure
                    key={citation.citation_id}
                    citationId={citation.citation_id}
                    retrieval={retrieval}
                    fallbackCitation={citation}
                  />
                ))}
              </div>
            </ReviewSection>
          </div>

          <aside className="grid gap-4 lg:sticky lg:top-24">
            {readOnly ? (
              <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
                <StrategyBadge>{t('history.readOnlyBadge')}</StrategyBadge>
                <h2 className="mt-3 text-lg font-bold text-navy">
                  {t('history.readOnlyTitle')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('history.readOnlyBody')}
                </p>
              </section>
            ) : resource.status === 'approved' ? (
              <ApprovedDecisionPanel />
            ) : resource.status === 'rejected' ? (
              <RejectedDecisionPanel />
            ) : (
              <>
                <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
                  <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
                    {t('decision.readinessLabel')}
                  </p>
                  <h2 className="mt-2 text-lg font-bold text-navy">
                    {canApprove
                      ? t('decision.readyTitle')
                      : t('decision.blockedTitle')}
                  </h2>
                  <ul className="mt-4 grid gap-2">
                    <ReadinessItem
                      complete={profileIsCurrent}
                      label={t('decision.profileCurrent')}
                    />
                    <ReadinessItem
                      complete={evidence.ready}
                      label={t('decision.evidenceValid')}
                    />
                    <ReadinessItem
                      complete={blockingItems.length === 0}
                      label={t('decision.noBlockers')}
                    />
                  </ul>
                </section>

                <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
                  <h2 className="text-lg font-bold text-navy">
                    {t('decision.title')}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {canApprove
                      ? t('decision.readyBody')
                      : t('decision.blockedBody')}
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Button
                      type="button"
                      disabled={!canApprove || pending}
                      onClick={() => setDecision('approve')}
                    >
                      {t('decision.approve')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={resource.status !== 'draft' || pending}
                      onClick={() => setDecision('revision_requested')}
                    >
                      {t('decision.revise')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={resource.status !== 'draft' || pending}
                      onClick={() => setDecision('reject')}
                    >
                      {t('decision.reject')}
                    </Button>
                    {canRetry ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={pending}
                        onClick={submitRetry}
                      >
                        {t('decision.retry')}
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    {t('decision.safetyNote')}
                  </p>
                  <div className="mt-3" aria-live="polite">
                    {error ? (
                      <p className="text-sm text-danger">{error}</p>
                    ) : null}
                    {notice ? (
                      <p className="text-sm font-semibold text-primary">
                        {notice}
                      </p>
                    ) : null}
                  </div>
                </section>
              </>
            )}
          </aside>
        </div>

        {!readOnly ? (
          <DecisionDialog
            action={decision}
            feedback={feedback}
            pending={pending}
            onFeedbackChange={setFeedback}
            onClose={() => {
              if (!pending) setDecision(null)
            }}
            onConfirm={submitDecision}
          />
        ) : null}
      </section>
    </EvidenceContext.Provider>
  )
}

const SECTION_IDS = [
  'overview',
  'direction',
  'channels',
  'content',
  'roadmap',
  'budget',
  'measurement',
  'risks',
  'evidence',
] as const

const SCORE_DIMENSIONS = [
  'objective_fit',
  'audience_fit',
  'existing_presence',
  'asset_format_fit',
  'team_capacity',
  'budget_fit',
  'evidence_strength',
  'measurement_readiness',
] as const

function inspectEvidence(
  plan: StrategyPlan | null,
  retrieval: RetrievedKnowledgePack | null,
): { ready: boolean; invalidCitationIds: string[] } {
  if (
    !plan ||
    !retrieval ||
    retrieval.retrieval_run_id !== plan.retrieval_run_id
  ) {
    return {
      ready: false,
      invalidCitationIds:
        plan?.citations.map((citation) => citation.citation_id) ?? [],
    }
  }

  const itemByChunk = new Map(
    retrieval.items.map((item) => [item.chunk_id, item]),
  )
  const now = Date.now()
  const invalidCitationIds = plan.citations
    .filter((citation) => {
      const item = itemByChunk.get(citation.chunk_id)
      if (!item || item.source_quality.review_status !== 'approved') return true
      if (
        item.entry_id !== citation.entry_id ||
        item.entry_version !== citation.entry_version
      ) {
        return true
      }
      const effectiveAt = new Date(item.source_quality.effective_at).getTime()
      if (!Number.isFinite(effectiveAt) || effectiveAt > now) return true
      const expiresAt = item.source_quality.expires_at
      if (expiresAt === null) return false
      const expiresAtTime = new Date(expiresAt).getTime()
      return !Number.isFinite(expiresAtTime) || expiresAtTime <= now
    })
    .map((citation) => citation.citation_id)

  return {
    ready: plan.citations.length > 0 && invalidCitationIds.length === 0,
    invalidCitationIds,
  }
}

function ReviewSection({
  id,
  title,
  why,
  children,
}: {
  readonly id: (typeof SECTION_IDS)[number]
  readonly title: string
  readonly why: string
  readonly children: ReactNode
}) {
  return (
    <article
      id={`strategy-${id}`}
      className="scroll-mt-24 rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6"
    >
      <header className="border-b border-border pb-4">
        <h2 className="text-xl font-bold text-navy md:text-2xl">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{why}</p>
      </header>
      <div className="mt-5 grid gap-4">{children}</div>
    </article>
  )
}

function Claim({
  claim,
  retrieval,
  label,
}: {
  readonly claim: SourcedClaim
  readonly retrieval: RetrievedKnowledgePack | null
  readonly label: string
}) {
  const t = useTranslations('Strategy')
  return (
    <section className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-navy">{label}</h3>
        <StrategyBadge
          tone={claim.source === 'model_synthesis' ? 'warning' : 'neutral'}
        >
          {t(`review.claimSources.${claim.source}`)}
        </StrategyBadge>
      </div>
      <p className="mt-2 text-sm leading-7 text-muted-foreground">
        <bdi>{claim.text}</bdi>
      </p>
      {claim.confidence_note ? (
        <p className="mt-2 text-xs leading-5 text-warning">
          {claim.confidence_note}
        </p>
      ) : null}
      {claim.citation_ids.length ? (
        <div className="mt-3 grid gap-2">
          {claim.citation_ids.map((citationId) => (
            <EvidenceDisclosure
              key={citationId}
              citationId={citationId}
              retrieval={retrieval}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ClaimList({
  title,
  claims,
  retrieval,
}: {
  readonly title: string
  readonly claims: readonly SourcedClaim[]
  readonly retrieval: RetrievedKnowledgePack | null
}) {
  const t = useTranslations('Strategy')
  return (
    <section>
      <h3 className="font-bold text-navy">{title}</h3>
      {claims.length ? (
        <div className="mt-3 grid gap-3">
          {claims.map((claim, index) => (
            <Claim
              key={`${claim.text}-${index}`}
              claim={claim}
              retrieval={retrieval}
              label={t('review.itemNumber', { number: index + 1 })}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <EmptyState>{t('review.empty.items')}</EmptyState>
        </div>
      )}
    </section>
  )
}

function EvidenceDisclosure({
  citationId,
  retrieval,
  fallbackCitation,
}: {
  readonly citationId: string
  readonly retrieval: RetrievedKnowledgePack | null
  readonly fallbackCitation?: StrategyPlan['citations'][number]
}) {
  const t = useTranslations('Strategy')
  const format = useFormatter()
  const [renderedAt] = useState(Date.now)
  const context = useContext(EvidenceContext)
  const fallback = fallbackCitation ?? context.citations.get(citationId) ?? null
  const item = findEvidenceItem(retrieval ?? context.retrieval, fallback)

  if (!item) {
    if (fallback) {
      return (
        <details className="group rounded-lg border border-border bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-navy focus-visible:ring-3 focus-visible:ring-ring/40">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{fallback.title}</span>
            <StrategyBadge tone="neutral">
              {t(`review.evidenceTiers.${fallback.evidence_tier}`)}
            </StrategyBadge>
          </summary>
          <div className="border-t border-border p-3">
            <p className="text-sm leading-6 text-muted-foreground">
              <bdi>{fallback.excerpt}</bdi>
            </p>
            <p className="mt-3 rounded-md border border-warning/20 bg-warning/10 p-2 text-xs text-warning">
              {t('review.historicalEvidenceUnavailable')}
            </p>
            <Fact
              label={t('review.fields.entryVersion')}
              value={String(fallback.entry_version)}
            />
          </div>
        </details>
      )
    }
    return (
      <p className="rounded-lg border border-danger/25 bg-danger/5 p-3 text-xs text-danger">
        {t('review.evidenceUnavailable', { id: citationId })}
      </p>
    )
  }

  const expired =
    item.source_quality.expires_at !== null &&
    new Date(item.source_quality.expires_at).getTime() <= renderedAt

  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-navy focus-visible:ring-3 focus-visible:ring-ring/40">
        <Link2 className="size-4 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        <StrategyBadge tone={expired ? 'danger' : 'neutral'}>
          {t(`review.evidenceTiers.${item.source_quality.evidence_tier}`)}
        </StrategyBadge>
      </summary>
      <div className="border-t border-border p-3">
        <p className="text-sm leading-6 text-muted-foreground">
          <bdi>{item.excerpt}</bdi>
        </p>
        {item.is_fallback ? (
          <p className="mt-3 rounded-md border border-warning/20 bg-warning/10 p-2 text-xs text-warning">
            {item.fallback_label ?? t('review.globalFallback')}
          </p>
        ) : null}
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Fact
            label={t('review.fields.entryVersion')}
            value={String(item.entry_version)}
          />
          <Fact
            label={t('review.fields.marketTier')}
            value={item.market_tier ?? t('review.notAvailable')}
          />
          <Fact
            label={t('review.fields.effectiveAt')}
            value={format.dateTime(new Date(item.source_quality.effective_at), {
              dateStyle: 'medium',
            })}
          />
          <Fact
            label={t('review.fields.expiresAt')}
            value={
              item.source_quality.expires_at
                ? format.dateTime(new Date(item.source_quality.expires_at), {
                    dateStyle: 'medium',
                  })
                : t('review.noExpiry')
            }
          />
        </dl>
        {item.source_quality.source_references.length ? (
          <ul className="mt-3 grid gap-2">
            {item.source_quality.source_references.map((source) => (
              <li key={source}>
                {source.startsWith('https://') ? (
                  <a
                    href={source}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-action underline underline-offset-4"
                  >
                    {t('review.openSource')}
                    <ArrowUpRight className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <code className="break-all text-xs text-muted-foreground">
                    {source}
                  </code>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

function findEvidenceItem(
  retrieval: RetrievedKnowledgePack | null,
  fallback: StrategyPlan['citations'][number] | null,
): RetrievedKnowledgeItem | null {
  if (retrieval) {
    const citation = fallback ?? null
    if (citation) {
      return (
        retrieval.items.find((item) => item.chunk_id === citation.chunk_id) ??
        null
      )
    }
  }
  return null
}

function ChannelScore({
  channel,
  selected,
  retrieval,
}: {
  readonly channel: ChannelScorecard
  readonly selected: boolean
  readonly retrieval: RetrievedKnowledgePack | null
}) {
  const t = useTranslations('Strategy')
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-navy">{channel.channel}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`review.channelRoles.${channel.role}`)}
          </p>
        </div>
        <StrategyBadge tone={selected ? 'good' : 'warning'}>
          {selected
            ? t('review.channelSelected')
            : t('review.channelNotSelected')}
        </StrategyBadge>
      </div>
      <p className="mt-3 text-3xl font-bold text-primary">
        {channel.total_score}
        <span className="text-sm font-medium text-muted-foreground">/100</span>
      </p>
      {channel.excluded_reason ? (
        <p className="mt-3 rounded-md border border-warning/20 bg-warning/10 p-3 text-sm text-warning">
          {channel.excluded_reason}
        </p>
      ) : null}
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {SCORE_DIMENSIONS.map((dimension) => (
          <Fact
            key={dimension}
            label={t(`review.scoreDimensions.${dimension}`)}
            value={`${channel.scores[dimension]}/100`}
          />
        ))}
      </dl>
      <div className="mt-4">
        <Claim
          claim={channel.rationale}
          retrieval={retrieval}
          label={t('review.fields.rationale')}
        />
      </div>
    </article>
  )
}

function Budget({ scenario }: { readonly scenario: BudgetScenario }) {
  const t = useTranslations('Strategy')
  const format = useFormatter()
  const allocationTotal = scenario.channel_allocations.reduce(
    (sum, allocation) => sum + allocation.amount_egp,
    0,
  )
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
            {t(`review.scenarioTypes.${scenario.scenario_type}`)}
          </p>
          <p className="mt-2 text-2xl font-bold text-navy">
            {format.number(scenario.total_egp)} {scenario.currency}
          </p>
        </div>
        {scenario.requires_owner_budget_approval ? (
          <StrategyBadge tone="warning">
            {t('review.budgetApprovalRequired')}
          </StrategyBadge>
        ) : null}
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {scenario.channel_allocations.map((allocation) => (
          <Fact
            key={allocation.channel}
            label={allocation.channel}
            value={`${format.number(allocation.amount_egp)} EGP · ${allocation.percentage}%`}
          />
        ))}
      </dl>
      <p
        className={cn(
          'mt-3 text-xs font-semibold',
          allocationTotal === scenario.total_egp
            ? 'text-primary'
            : 'text-danger',
        )}
      >
        {t('review.allocationCheck', {
          allocated: format.number(allocationTotal),
          total: format.number(scenario.total_egp),
        })}
      </p>
    </article>
  )
}

function Kpi({
  target,
  retrieval,
}: {
  readonly target: KpiTarget
  readonly retrieval: RetrievedKnowledgePack | null
}) {
  const t = useTranslations('Strategy')
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-navy">{target.metric}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {target.target_value ?? target.measurement_method}
          </p>
        </div>
        <StrategyBadge>
          {t(`review.kpiModes.${target.target_mode}`)}
        </StrategyBadge>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {target.measurement_method}
      </p>
      <div className="mt-3">
        <Claim
          claim={target.notes}
          retrieval={retrieval}
          label={t('review.fields.measurementNotes')}
        />
      </div>
    </article>
  )
}

function IssueList({
  title,
  items,
}: {
  readonly title: string
  readonly items: readonly {
    id: string
    message: string
    blocking: boolean
  }[]
}) {
  const t = useTranslations('Strategy')
  return (
    <section>
      <h3 className="font-bold text-navy">{title}</h3>
      {items.length ? (
        <ul className="mt-3 grid gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-sm leading-6',
                item.blocking
                  ? 'border-danger/25 bg-danger/5 text-danger'
                  : 'border-warning/25 bg-warning/10 text-warning',
              )}
            >
              <ShieldAlert
                className="mt-1 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                <strong className="block">
                  {item.blocking
                    ? t('review.blockingLabel')
                    : t('review.warningLabel')}
                </strong>
                {item.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3">
          <EmptyState>{t('review.empty.items')}</EmptyState>
        </div>
      )}
    </section>
  )
}

function Fact({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-navy">
        <bdi>{value}</bdi>
      </dd>
    </div>
  )
}

function ReadinessItem({
  complete,
  label,
}: {
  readonly complete: boolean
  readonly label: string
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full',
          complete
            ? 'bg-primary text-primary-foreground'
            : 'bg-danger/10 text-danger',
        )}
      >
        {complete ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <CircleAlert className="size-4" aria-hidden="true" />
        )}
      </span>
      <span className="text-sm font-semibold text-navy">{label}</span>
    </li>
  )
}

function StatusBanner({
  tone,
  title,
  body,
  action,
}: {
  readonly tone: 'danger' | 'warning'
  readonly title: string
  readonly body: string
  readonly action?: React.ReactNode
}) {
  return (
    <section
      role="alert"
      className={cn(
        'rounded-xl border p-4',
        tone === 'danger'
          ? 'border-danger/25 bg-danger/5'
          : 'border-warning/25 bg-warning/10',
      )}
    >
      <h2
        className={cn(
          'font-bold',
          tone === 'danger' ? 'text-danger' : 'text-warning',
        )}
      >
        {title}
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      {action ? (
        <div className="mt-3" aria-live="polite">
          {action}
        </div>
      ) : null}
    </section>
  )
}

function ApprovedDecisionPanel() {
  const t = useTranslations('Strategy')
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
      <StrategyBadge tone="good">{t('decision.approvedBadge')}</StrategyBadge>
      <h2 className="mt-3 text-lg font-bold text-navy">
        {t('decision.approvedTitle')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t('decision.approvedBody')}
      </p>
      <div className="mt-4">
        <Link
          href="/content"
          className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {t('decision.approvedAction')}
        </Link>
      </div>
    </section>
  )
}

function RejectedDecisionPanel() {
  const t = useTranslations('Strategy')
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
      <StrategyBadge tone="danger">{t('decision.rejectedBadge')}</StrategyBadge>
      <h2 className="mt-3 text-lg font-bold text-navy">
        {t('decision.rejectedTitle')}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {t('decision.rejectedBody')}
      </p>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        {t('decision.safetyNote')}
      </p>
    </section>
  )
}

function EmptyState({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  )
}

function DecisionDialog({
  action,
  feedback,
  pending,
  onFeedbackChange,
  onClose,
  onConfirm,
}: {
  readonly action: DecisionAction | null
  readonly feedback: string
  readonly pending: boolean
  readonly onFeedbackChange: (value: string) => void
  readonly onClose: () => void
  readonly onConfirm: () => void
}) {
  const t = useTranslations('Strategy')
  const needsFeedback = action !== null && action !== 'approve'
  const confirmDisabled = pending || (needsFeedback && !feedback.trim())

  return (
    <Dialog.Root
      open={action !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
            'max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-5 shadow-elevated',
            'focus-visible:ring-3 focus-visible:ring-ring/40 md:p-6',
          )}
        >
          <Dialog.Title className="text-xl font-bold text-navy">
            {action ? t(`decision.dialog.${action}.title`) : ''}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            {action ? t(`decision.dialog.${action}.body`) : ''}
          </Dialog.Description>
          {needsFeedback ? (
            <div className="mt-4 grid gap-2">
              <label
                htmlFor="strategy-decision-feedback"
                className="text-sm font-semibold text-navy"
              >
                {t('decision.feedbackLabel')}
              </label>
              <textarea
                id="strategy-decision-feedback"
                name="strategy-decision-feedback"
                autoComplete="off"
                value={feedback}
                onChange={(event) => onFeedbackChange(event.target.value)}
                className="min-h-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                placeholder={t('decision.feedbackPlaceholder')}
              />
            </div>
          ) : null}
          <p className="mt-4 rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs leading-5 text-warning">
            {t('decision.safetyNote')}
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close
              render={
                <Button type="button" variant="ghost" disabled={pending} />
              }
            >
              {t('decision.cancel')}
            </Dialog.Close>
            <Button
              type="button"
              variant={action === 'reject' ? 'destructive' : 'default'}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {pending ? t('decision.pending') : t('decision.confirm')}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

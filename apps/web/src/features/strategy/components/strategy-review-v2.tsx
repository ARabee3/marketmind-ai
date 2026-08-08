'use client'

import { useMemo, useState } from 'react'
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
  RetrievedKnowledgePack,
  StrategyPlanV2,
  StrategyProgressEvent,
  StrategyResource,
} from '@marketmind/contracts'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { useStrategyActions } from '../hooks/use-strategy-actions'
import type { StrategyProfileSummary as ProfileSummary } from '../lib/strategy-fixtures'
import { StrategyBadge } from './strategy-badge'
import { StrategyProfileSummary } from './strategy-profile-summary'

type DecisionAction = 'approve' | 'revision_requested' | 'reject'

const WEEK_GROUPS: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [5, 8],
  [9, 12],
]

export function StrategyReviewV2({
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
  const format = useFormatter()
  const plan = resource.latest_plan as StrategyPlanV2 | null
  const { decide, retry, pending, error } = useStrategyActions()
  const [decision, setDecision] = useState<DecisionAction | null>(null)
  const [feedback, setFeedback] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [openDetails, setOpenDetails] = useState<string[]>([])

  const handoffReady = plan?.content_handoff.available === true
  const blockingItems = plan?.blockers.filter(
    (blocker) => blocker.severity === 'blocking',
  ) ?? []
  const evidenceReady = useMemo(
    () => planEvidenceReady(plan, retrieval),
    [plan, retrieval],
  )
  const profileIsCurrent =
    readOnly
    || (
      Boolean(profile)
      && Boolean(plan)
      && profile?.version === plan?.profile_version.version
      && resource.brief?.business_profile_version
        .business_profile_version_id
        === plan?.profile_version.business_profile_version_id
    )
  const canApprove =
    !readOnly
    && resource.status === 'draft'
    && currentVersionId !== null
    && blockingItems.length === 0
    && evidenceReady
    && profileIsCurrent
  const lastFailure = [...progress]
    .reverse()
    .find((event) => event.status === 'failed')
  const canRetry =
    resource.status === 'failed'
    && lastFailure?.retryable === true

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
    setNotice(t(`decision.success.${decision}`))
    await onRefresh()
  }

  async function submitRetry() {
    const result = await retry(resource.strategy_id)
    if (!result) return
    setNotice(t('decision.success.retry'))
    await onRefresh()
  }

  function toggleDetails(id: string) {
    setOpenDetails((previous) =>
      previous.includes(id)
        ? previous.filter((entry) => entry !== id)
        : [...previous, id],
    )
  }

  if (!plan) {
    return (
      <section className="rounded-xl border border-warning/25 bg-warning/10 p-5">
        <StrategyBadge tone="warning">{t('review.unavailableBadge')}</StrategyBadge>
        <h1 className="mt-3 text-2xl font-bold text-navy">
          {t('review.unavailableTitle')}
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          {t('review.unavailableBody')}
        </p>
      </section>
    )
  }

  const adviceCountFor = (weekNumber: number) =>
    plan.owner_advice.weeks.find((group) => group.week_number === weekNumber)
      ?.items.length ?? 0

  return (
    <section className="grid gap-5">
      <header className="grid gap-3 rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StrategyBadge tone="good">{t('reviewV2.badge')}</StrategyBadge>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/strategy/${resource.strategy_id}/advice`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40"
            >
              {t('reviewV2.openAdvice')}
              <ArrowUpRight className="size-4 rtl:scale-x-[-1]" aria-hidden="true" />
            </Link>
            <Link
              href={`/strategy/${resource.strategy_id}/versions`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/15 focus-visible:ring-3 focus-visible:ring-white/40"
            >
              <History className="size-4" aria-hidden="true" />
              {t('reviewV2.openHistory')}
            </Link>
          </div>
        </div>
        <h1 className="text-3xl font-bold md:text-4xl">{t('reviewV2.title')}</h1>
        <p className="max-w-2xl text-sm leading-7 text-white/75">
          {t('reviewV2.subtitle')}
        </p>
      </header>

      {!profileIsCurrent ? (
        <StatusBanner
          tone="danger"
          title={t('review.staleProfileTitle')}
          body={t('review.staleProfileBody')}
        />
      ) : null}
      {!readOnly && !evidenceReady ? (
        <StatusBanner
          tone="danger"
          title={t('review.invalidEvidenceTitle')}
          body={t('review.invalidEvidenceBody', { count: plan.citations.length })}
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="grid gap-5">
          {!readOnly || profile ? (
            <StrategyProfileSummary profile={profile} />
          ) : null}

          <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6">
            <h2 className="text-xl font-bold text-navy md:text-2xl">
              {t('reviewV2.summaryLabel')}
            </h2>
            <dl className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-background p-4">
                <dt className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
                  {t('reviewV2.goalLabel')}
                </dt>
                <dd className="mt-2 text-sm leading-6 text-navy">
                  <bdi>{plan.goal.text}</bdi>
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-background p-4">
                <dt className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
                  {t('reviewV2.channelsLabel')}
                </dt>
                <dd className="mt-2 grid gap-2">
                  {plan.channel_commitments.map((commitment) => (
                    <div
                      key={commitment.channel}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="font-semibold text-navy">
                        <bdi>{t(`channels.${commitment.channel}`)}</bdi>
                      </span>
                      <span className="flex flex-wrap items-center gap-1">
                        <StrategyBadge tone={commitment.role === 'primary' ? 'good' : 'neutral'}>
                          {t(`channels.roles.${commitment.role}`)}
                        </StrategyBadge>
                        <StrategyBadge>
                          {t(`channels.setupStates.${commitment.setup_state}`)}
                        </StrategyBadge>
                      </span>
                    </div>
                  ))}
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-background p-4">
                <dt className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
                  {t('reviewV2.datesLabel')}
                </dt>
                <dd className="mt-2 grid gap-2 text-sm text-navy">
                  <span>
                    {t('reviewV2.startsOn', {
                      date: format.dateTime(new Date(plan.start_date), {
                        dateStyle: 'medium',
                      }),
                    })}
                  </span>
                  <span>
                    {t('reviewV2.objective')}:{' '}
                    {t(`review.objectives.${plan.primary_objective}`)}
                  </span>
                  <span>
                    {t('reviewV2.planLanguage')}: {plan.plan_language}
                  </span>
                </dd>
              </div>
            </dl>
          </section>

          <section
            className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6"
            aria-label={t('reviewV2.title')}
          >
            <div className="hidden lg:grid lg:grid-cols-3 lg:gap-4">
              {WEEK_GROUPS.map(([start, end], index) => (
                <div key={index} className="grid content-start gap-3">
                  <h3 className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
                    {t(`reviewV2.weeksGroup.${index === 0 ? 'one' : index === 1 ? 'two' : 'three'}`)}
                  </h3>
                  {plan.calendar_weeks
                    .filter((week) => week.week_number >= start && week.week_number <= end)
                    .map((week) => (
                      <WeekCard
                        key={week.week_number}
                        plan={plan}
                        weekNumber={week.week_number}
                        adviceCount={adviceCountFor(week.week_number)}
                      />
                    ))}
                </div>
              ))}
            </div>

            <div className="grid gap-3 lg:hidden">
              {plan.calendar_weeks.map((week) => (
                <details key={week.week_number} className="group rounded-lg border border-border bg-background">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-bold text-navy focus-visible:ring-3 focus-visible:ring-ring/40">
                    <span>{t('reviewV2.week', { week: week.week_number })}</span>
                    <span className="text-xs font-semibold text-primary">
                      {week.focus}
                    </span>
                  </summary>
                  <div className="border-t border-border p-3">
                    <WeekFields plan={plan} weekNumber={week.week_number} />
                    <OwnerAdviceLink
                      strategyId={plan.strategy_id}
                      weekNumber={week.week_number}
                      count={adviceCountFor(week.week_number)}
                    />
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated md:p-6">
            <h2 className="text-lg font-bold text-navy">{t('reviewV2.detailsTitle')}</h2>
            <div className="mt-4 grid gap-3">
              <DetailSection
                id="why"
                title={t('reviewV2.details.why')}
                open={openDetails.includes('why')}
                onToggle={() => toggleDetails('why')}
              >
                <p className="text-sm leading-7 text-muted-foreground">
                  <bdi>{plan.evidence_summary.text}</bdi>
                </p>
                <p className="mt-3 text-sm font-bold text-navy">
                  {t('reviewV2.channelsLabelList')}
                </p>
                <ul className="mt-2 grid gap-2">
                  {plan.channel_commitments.map((commitment) => (
                    <li
                      key={commitment.channel}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-bold text-navy">
                          <bdi>{t(`channels.${commitment.channel}`)}</bdi>
                        </span>
                        <StrategyBadge>
                          {t(`channels.capabilities.${commitment.capability_state}`)}
                        </StrategyBadge>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        <bdi>{commitment.rationale.text}</bdi>
                      </p>
                    </li>
                  ))}
                </ul>
              </DetailSection>

              <DetailSection
                id="handoff"
                title={t('reviewV2.contentHandoff.label')}
                open={openDetails.includes('handoff')}
                onToggle={() => toggleDetails('handoff')}
              >
                {handoffReady ? (
                  <>
                    <StrategyBadge tone="good">
                      {t('reviewV2.contentHandoff.ready')}
                    </StrategyBadge>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t('reviewV2.contentHandoff.readyBody')}
                    </p>
                  </>
                ) : (
                  <>
                    <StrategyBadge tone="warning">
                      {t('reviewV2.contentHandoff.unavailable')}
                    </StrategyBadge>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t('reviewV2.contentHandoff.unavailableBody')}
                    </p>
                  </>
                )}
              </DetailSection>

              <DetailSection
                id="evidence"
                title={t('reviewV2.details.evidence')}
                open={openDetails.includes('evidence')}
                onToggle={() => toggleDetails('evidence')}
              >
                <p className="text-sm leading-6 text-muted-foreground">
                  {t('reviewV2.details.evidenceBody', { count: plan.citations.length })}
                </p>
                <div className="mt-3 grid gap-2">
                  {plan.citations.map((citation) => (
                    <details
                      key={citation.citation_id}
                      className="group rounded-lg border border-border bg-background"
                    >
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-navy focus-visible:ring-3 focus-visible:ring-ring/40">
                        <Link2 className="size-4 text-primary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{citation.title}</span>
                        <StrategyBadge tone="neutral">
                          {t(`review.evidenceTiers.${citation.evidence_tier}`)}
                        </StrategyBadge>
                      </summary>
                      <div className="border-t border-border p-3">
                        <p className="text-sm leading-6 text-muted-foreground">
                          <bdi>{citation.excerpt}</bdi>
                        </p>
                        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                          <Fact
                            label={t('review.fields.entryVersion')}
                            value={String(citation.entry_version)}
                          />
                          <Fact
                            label={t('review.fields.retrievalRun')}
                            value={plan.retrieval_run_id}
                          />
                        </dl>
                      </div>
                    </details>
                  ))}
                </div>
              </DetailSection>

              <DetailSection
                id="risks"
                title={t('reviewV2.details.risks')}
                open={openDetails.includes('risks')}
                onToggle={() => toggleDetails('risks')}
              >
                <IssueList
                  title={t('review.fields.risks')}
                  items={plan.risks.map((risk) => ({
                    id: risk.text,
                    message: risk.text,
                    blocking: false,
                  }))}
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
              </DetailSection>

              <DetailSection
                id="history"
                title={t('reviewV2.details.history')}
                open={openDetails.includes('history')}
                onToggle={() => toggleDetails('history')}
              >
                <Link
                  href={`/strategy/${resource.strategy_id}/versions`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-action underline underline-offset-4"
                >
                  <History className="size-4" aria-hidden="true" />
                  {t('reviewV2.openHistory')}
                </Link>
              </DetailSection>
            </div>
          </section>
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
                    complete={evidenceReady}
                    label={t('decision.evidenceValid')}
                  />
                  <ReadinessItem
                    complete={blockingItems.length === 0}
                    label={t('decision.noBlockers')}
                  />
                </ul>
              </section>

              <section className="rounded-xl border border-border bg-surface p-4 shadow-elevated">
                <h2 className="text-lg font-bold text-navy">{t('decision.title')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {canApprove ? t('decision.readyBody') : t('decision.blockedBody')}
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
                  {error ? <p className="text-sm text-danger">{error}</p> : null}
                  {notice ? (
                    <p className="text-sm font-semibold text-primary">{notice}</p>
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
  )
}

function WeekCard({
  plan,
  weekNumber,
  adviceCount,
}: {
  readonly plan: StrategyPlanV2
  readonly weekNumber: number
  readonly adviceCount: number
}) {
  const t = useTranslations('Strategy')
  const week = plan.calendar_weeks.find(
    (entry) => entry.week_number === weekNumber,
  )!
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-bold tracking-[0.1em] text-primary uppercase">
        {t('reviewV2.week', { week: weekNumber })}
      </p>
      <h4 className="mt-2 font-bold text-navy">{week.focus}</h4>
      <dl className="mt-3 grid gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t('reviewV2.outcome')}</dt>
          <dd className="mt-1 leading-6 text-navy">
            <bdi>{week.expected_outcome}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('reviewV2.measurement')}</dt>
          <dd className="mt-1 leading-6 text-navy">
            <bdi>{week.measurement_check}</bdi>
          </dd>
        </div>
      </dl>
      <OwnerAdviceLink
        strategyId={plan.strategy_id}
        weekNumber={weekNumber}
        count={adviceCount}
      />
    </article>
  )
}

function WeekFields({
  plan,
  weekNumber,
}: {
  readonly plan: StrategyPlanV2
  readonly weekNumber: number
}) {
  const t = useTranslations('Strategy')
  const week = plan.calendar_weeks.find(
    (entry) => entry.week_number === weekNumber,
  )!
  return (
    <dl className="grid gap-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">{t('reviewV2.focus')}</dt>
        <dd className="mt-1 font-semibold text-navy">{week.focus}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t('reviewV2.outcome')}</dt>
        <dd className="mt-1 leading-6 text-navy">{week.expected_outcome}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t('reviewV2.measurement')}</dt>
        <dd className="mt-1 leading-6 text-navy">{week.measurement_check}</dd>
      </div>
    </dl>
  )
}

function OwnerAdviceLink({
  strategyId,
  weekNumber,
  count,
}: {
  readonly strategyId: string
  readonly weekNumber: number
  readonly count: number
}) {
  const t = useTranslations('Strategy')
  return (
    <Link
      href={`/strategy/${strategyId}/advice#week-${weekNumber}`}
      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-action underline underline-offset-4"
    >
      {t('reviewV2.ownerActions', { count })}
      <ArrowUpRight className="size-3 rtl:scale-x-[-1]" aria-hidden="true" />
      <span className="sr-only">
        {t('reviewV2.openAdviceForWeek', { week: weekNumber })}
      </span>
    </Link>
  )
}

function DetailSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  readonly id: string
  readonly title: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`plan-details-${id}`}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3 text-sm font-bold text-navy focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <span>{title}</span>
        <span aria-hidden="true" className={cn('text-primary', open && 'rotate-180')}>
          ▾
        </span>
      </button>
      {open ? (
        <div id={`plan-details-${id}`} className="grid gap-3 border-t border-border p-3">
          {children}
        </div>
      ) : null}
    </div>
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
        <ul className="mt-2 grid gap-2">
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
              <ShieldAlert className="mt-1 size-4 shrink-0" aria-hidden="true" />
              <span>
                <strong className="block">
                  {item.blocking
                    ? t('reviewV2.blockingLabel')
                    : t('reviewV2.warningLabel')}
                </strong>
                <bdi>{item.message}</bdi>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('reviewV2.noBlockers')}
        </p>
      )}
    </section>
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
}: {
  readonly tone: 'danger' | 'warning'
  readonly title: string
  readonly body: string
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
    </section>
  )
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-navy">
        <bdi>{value}</bdi>
      </dd>
    </div>
  )
}

function planEvidenceReady(
  plan: StrategyPlanV2 | null,
  retrieval: RetrievedKnowledgePack | null,
): boolean {
  if (!plan || !retrieval) return false
  if (retrieval.retrieval_run_id !== plan.retrieval_run_id) return false
  const itemByChunk = new Map(retrieval.items.map((item) => [item.chunk_id, item]))
  const now = Date.now()
  const invalid = plan.citations.filter((citation) => {
    const item = itemByChunk.get(citation.chunk_id)
    if (!item || item.source_quality.review_status !== 'approved') return true
    if (
      item.entry_id !== citation.entry_id
      || item.entry_version !== citation.entry_version
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
  return plan.citations.length > 0 && invalid.length === 0
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
              render={<Button type="button" variant="ghost" disabled={pending} />}
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

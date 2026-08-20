'use client'

import { useCallback, useEffect, useState } from 'react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type {
  OptimizationProposalWorkspaceV1,
  PerformanceCapabilityV1,
  PerformanceMetricValueV1,
  PerformanceOverviewV1,
  PerformancePostProjectionV1,
  PerformanceWindow,
} from '@marketmind/contracts'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  Compass,
  Facebook,
  FlaskConical,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getCurrentJourney } from '@/lib/api/journey'
import {
  decideOptimizationProposal,
  getOptimizationProposals,
  getPerformanceOverview,
  refreshPerformancePost,
  type PerformanceApiError,
} from '@/lib/api/performance'
import { OptimizationDecisionPanel } from './optimization-decision-panel'
import {
  getPerformanceDemoWorkspace,
  PERFORMANCE_DEMO_OVERVIEW,
} from './performance-demo'
import {
  baselineProgress,
  metricValueFor,
  PERFORMANCE_METRIC_ORDER,
  PERFORMANCE_STAGE_ORDER,
  performanceSetupAction,
  stageStatus,
  type PerformanceSetupAction,
  type PerformanceStageStatus,
} from './performance-state'

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'setup_required'; readonly setup: PerformanceSetupAction }
  | { readonly status: 'ready'; readonly overview: PerformanceOverviewV1 }
  | { readonly status: 'error' }

type OptimizationLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly workspaces: readonly OptimizationProposalWorkspaceV1[] }
  | { readonly status: 'error' }

type Notice =
  | { readonly kind: 'success'; readonly key: 'queued' | 'notDue' | 'optimizationSaved' }
  | { readonly kind: 'error'; readonly key: 'refreshFailed' | 'rateLimited' | 'optimizationFailed' }

export function PerformancePage() {
  const t = useTranslations('Performance')
  const formatter = useFormatter()
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [optimizationState, setOptimizationState] = useState<OptimizationLoadState>({
    status: 'loading',
  })
  const [reloading, setReloading] = useState(false)
  const [refreshingPostId, setRefreshingPostId] = useState<string | null>(null)
  const [decidingOptimizationId, setDecidingOptimizationId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  const fetchOverview = useCallback(async () => getPerformanceOverview(), [])
  const fetchOptimization = useCallback(async () => getOptimizationProposals(), [])

  const loadData = useCallback(async () => {
    setNotice(null)
    // Performance routes fail closed (403) until the owner has a business
    // scope, so gate the monitoring calls behind a confirmed profile and a
    // ready Content cycle. A first-time owner still gets the full guided next
    // step from the journey instead of a generic "could not load" error.
    try {
      const journey = await getCurrentJourney()
      const setup = performanceSetupAction(journey)
      if (setup) {
        setLoadState({ status: 'setup_required', setup })
        setOptimizationState({ status: 'loading' })
        return false
      }
    } catch {
      setLoadState((current) =>
        current.status === 'ready' ? current : { status: 'error' },
      )
      setOptimizationState({ status: 'error' })
      return false
    }
    const [overviewResult, optimizationResult] = await Promise.allSettled([
      fetchOverview(),
      fetchOptimization(),
    ])
    if (overviewResult.status === 'fulfilled') {
      setLoadState({ status: 'ready', overview: overviewResult.value })
    } else {
      setLoadState((current) =>
        current.status === 'ready' ? current : { status: 'error' },
      )
    }
    if (optimizationResult.status === 'fulfilled') {
      setOptimizationState({ status: 'ready', workspaces: optimizationResult.value })
    } else {
      setOptimizationState({ status: 'error' })
    }
    return overviewResult.status === 'fulfilled'
  }, [fetchOptimization, fetchOverview])

  const loadOverview = useCallback(() => {
    setLoadState({ status: 'loading' })
    setOptimizationState({ status: 'loading' })
    void loadData()
  }, [loadData])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  async function reload() {
    if (reloading) return
    setReloading(true)
    setOptimizationState({ status: 'loading' })
    setNotice(null)
    try {
      const overviewLoaded = await loadData()
      if (!overviewLoaded) {
        setNotice({ kind: 'error', key: 'refreshFailed' })
      }
    } finally {
      setReloading(false)
    }
  }

  async function refreshPost(post: PerformancePostProjectionV1) {
    if (refreshingPostId) return
    setRefreshingPostId(post.publishing_result_id)
    setNotice(null)
    try {
      const response = await refreshPerformancePost(post.publishing_result_id)
      setOptimizationState({ status: 'loading' })
      await loadData()
      setNotice({
        kind: 'success',
        key: response.status === 'not_due' ? 'notDue' : 'queued',
      })
    } catch (error) {
      const apiError = error as Partial<PerformanceApiError>
      setNotice({
        kind: 'error',
        key: apiError.status === 429 ? 'rateLimited' : 'refreshFailed',
      })
    } finally {
      setRefreshingPostId(null)
    }
  }

  async function decideOptimization(
    workspace: OptimizationProposalWorkspaceV1,
    action: 'approve' | 'dismiss',
  ) {
    if (decidingOptimizationId) return
    const proposalId = workspace.proposal.proposal_id
    setDecidingOptimizationId(proposalId)
    setNotice(null)
    try {
      const response = await decideOptimizationProposal(proposalId, {
        action,
        evidence_checksum: workspace.proposal.evidence_checksum,
        idempotency_key: optimizationIdempotencyKey(proposalId, action),
      })
      setOptimizationState((current) =>
        current.status !== 'ready'
          ? current
          : {
              status: 'ready',
              workspaces: current.workspaces.map((candidate) =>
                candidate.proposal.proposal_id === proposalId
                  ? response.workspace
                  : candidate,
              ),
            },
      )
      setNotice({ kind: 'success', key: 'optimizationSaved' })
    } catch {
      setNotice({ kind: 'error', key: 'optimizationFailed' })
    } finally {
      setDecidingOptimizationId(null)
    }
  }

  if (demoMode) {
    return <PerformanceDemoPage onExit={() => setDemoMode(false)} />
  }

  if (loadState.status === 'loading') return <PerformanceLoading />

  if (loadState.status === 'setup_required') {
    return (
      <PerformanceSetupRequired
        setup={loadState.setup}
        onOpenDemo={() => setDemoMode(true)}
        onRefresh={() => void loadOverview()}
      />
    )
  }

  if (loadState.status === 'error') {
    return (
      <section className="grid gap-5" aria-live="polite">
        <PerformanceHeader
          overview={null}
          reloading={false}
          onReload={() => void loadOverview()}
          onOpenDemo={() => setDemoMode(true)}
        />
        <div className="grid gap-3 rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
          <p className="flex items-start gap-2 font-semibold">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('loadFailed')}
          </p>
          <p className="max-w-2xl leading-6">{t('loadFailedBody')}</p>
          <div>
            <Button type="button" variant="outline" onClick={() => void loadOverview()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t('retry')}
            </Button>
          </div>
        </div>
      </section>
    )
  }

  const overview = loadState.overview
  // The API generation time keeps the server/client render deterministic and
  // is refreshed whenever the evidence view is reloaded.
  const timelineNow = new Date(overview.generated_at)

  return (
    <section className="grid gap-6">
      <PerformanceHeader
        overview={overview}
        reloading={reloading}
        onReload={() => void reload()}
        onOpenDemo={() => setDemoMode(true)}
      />

      <div aria-live="polite" className="min-h-0">
        {notice ? (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={
              notice.kind === 'error'
                ? 'flex items-start gap-2 text-sm font-semibold text-danger'
                : 'flex items-start gap-2 text-sm font-semibold text-primary'
            }
          >
            {notice.kind === 'error' ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            {t(`notices.${notice.key}`)}
          </p>
        ) : null}
      </div>

      <OptimizationDecisionPanel
        workspaces={optimizationState.status === 'ready' ? optimizationState.workspaces : []}
        loading={optimizationState.status === 'loading'}
        error={optimizationState.status === 'error'}
        decidingProposalId={decidingOptimizationId}
        onDecide={(workspace, action) => void decideOptimization(workspace, action)}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          {overview.posts.length === 0 ? (
            <EmptyPerformanceState />
          ) : (
            overview.posts.map((post) => (
              <PostEvidence
                key={post.publishing_result_id}
                post={post}
                now={timelineNow}
                refreshing={refreshingPostId === post.publishing_result_id}
                onRefresh={() => void refreshPost(post)}
                formatDate={(value) =>
                  formatter.dateTime(new Date(value), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                }
                formatNumber={(value) =>
                  formatter.number(value, { maximumFractionDigits: 0 })
                }
              />
            ))
          )}
        </div>

        <aside className="grid h-fit gap-4">
          <BaselinePanel overview={overview} />
          <ConnectionPanel capability={overview.capability} />
        </aside>
      </div>
    </section>
  )
}

function PerformanceLoading() {
  const t = useTranslations('Performance')

  return (
    <section className="grid gap-6" aria-busy="true" aria-label={t('loading')}>
      <div className="grid gap-3 rounded-xl bg-navy p-5 md:p-7">
        <Skeleton className="h-3 w-36 bg-primary-foreground/20" />
        <Skeleton className="h-10 w-3/4 bg-primary-foreground/20" />
        <Skeleton className="h-5 w-full max-w-2xl bg-primary-foreground/20" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="min-h-96 rounded-xl" />
        <div className="grid gap-4">
          <Skeleton className="min-h-52 rounded-xl" />
          <Skeleton className="min-h-60 rounded-xl" />
        </div>
      </div>
    </section>
  )
}

function PerformanceSetupRequired({
  setup,
  onOpenDemo,
  onRefresh,
}: {
  readonly setup: PerformanceSetupAction
  readonly onOpenDemo: () => void
  readonly onRefresh: () => void
}) {
  const t = useTranslations('Performance')

  return (
    <section className="grid gap-5">
      <PerformanceHeader
        overview={null}
        reloading={false}
        onReload={onRefresh}
        onOpenDemo={onOpenDemo}
      />
      <section className="grid gap-4 rounded-xl border border-dashed border-border bg-surface p-7 text-center shadow-elevated md:p-10">
        <span className="mx-auto grid size-12 place-items-center rounded-lg bg-soft-teal text-primary">
          <Compass className="size-6" aria-hidden="true" />
        </span>
        <h2 className="text-2xl font-bold text-navy">
          {t(`setupRequired.title.${setup.requirement}`)}
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">
          {t(`setupRequired.body.${setup.requirement}`)}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={setup.destination}
            className={buttonVariants({
              className: 'shadow-tactile hover:brightness-105',
            })}
          >
            {t(`setupRequired.${setup.labelKey}`)}
            <ArrowUpRight
              className="ms-2 size-4 rtl:scale-x-[-1]"
              aria-hidden="true"
            />
          </Link>
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw className="me-2 size-4" aria-hidden="true" />
            {t('setupRequired.tryAgain')}
          </Button>
        </div>
      </section>
    </section>
  )
}

function PerformanceDemoPage({ onExit }: { readonly onExit: () => void }) {
  const locale = useLocale()
  const formatter = useFormatter()
  const overview = PERFORMANCE_DEMO_OVERVIEW
  const workspace = getPerformanceDemoWorkspace(locale)
  const timelineNow = new Date(overview.generated_at)

  return (
    <section className="grid gap-6">
      <PerformanceHeader
        overview={overview}
        reloading={false}
        onReload={onExit}
        onOpenDemo={onExit}
        demoMode
      />

      <DemoEvidenceBanner />

      <OptimizationDecisionPanel
        workspaces={[workspace]}
        loading={false}
        error={false}
        decidingProposalId={null}
        onDecide={() => undefined}
        readOnly
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-5">
          {overview.posts.map((post) => (
            <PostEvidence
              key={post.publishing_result_id}
              post={post}
              now={timelineNow}
              refreshing={false}
              onRefresh={() => undefined}
              formatDate={(value) =>
                formatter.dateTime(new Date(value), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              }
              formatNumber={(value) =>
                formatter.number(value, { maximumFractionDigits: 0 })
              }
              demoMode
            />
          ))}
        </div>

        <aside className="grid h-fit gap-4">
          <BaselinePanel overview={overview} demoMode />
          <ConnectionPanel capability={undefined} demoMode />
        </aside>
      </div>
    </section>
  )
}

function DemoEvidenceBanner() {
  const t = useTranslations('Performance')

  return (
    <aside
      className="grid gap-3 rounded-xl border border-warning/30 bg-warning/10 p-5 shadow-elevated md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start md:gap-4"
      role="note"
      aria-labelledby="performance-demo-heading"
    >
      <span className="grid size-10 place-items-center rounded-lg bg-warning/15 text-warning">
        <FlaskConical className="size-5" aria-hidden="true" />
      </span>
      <div className="grid min-w-0 gap-1">
        <p className="text-xs font-semibold tracking-[0.12em] text-warning uppercase">
          {t('demo.eyebrow')}
        </p>
        <h2
          id="performance-demo-heading"
          className="text-base font-bold text-navy"
        >
          {t('demo.bannerTitle')}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('demo.bannerBody')}
        </p>
      </div>
      <Badge variant="default">{t('demo.readOnly')}</Badge>
    </aside>
  )
}

function PerformanceHeader({
  overview,
  reloading,
  onReload,
  onOpenDemo,
  demoMode = false,
}: {
  readonly overview: PerformanceOverviewV1 | null
  readonly reloading: boolean
  readonly onReload: () => void
  readonly onOpenDemo: () => void
  readonly demoMode?: boolean
}) {
  const t = useTranslations('Performance')
  const formatter = useFormatter()
  const capability = overview?.capability
  const capabilityStatus = capability?.status ?? 'unknown'

  return (
    <header className="relative overflow-hidden rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7">
      <div className="pointer-events-none absolute -top-28 end-8 size-64 rounded-full bg-primary/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-36 start-16 size-72 rounded-full bg-journey-mint/15 blur-3xl" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="grid gap-3">
          <p className="text-xs font-semibold tracking-[0.14em] text-journey-mint uppercase">
            {demoMode ? t('demo.eyebrow') : t('eyebrow')}
          </p>
          <h1 className="max-w-3xl text-balance text-3xl leading-tight font-bold md:text-4xl">
            {demoMode ? t('demo.title') : t('title')}
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-primary-foreground/75 md:text-base">
            {demoMode ? t('demo.headerSubtitle') : t('subtitle')}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[auto_auto] sm:items-end lg:justify-items-end">
          <div className="grid gap-1 text-sm sm:text-end">
            <span className="text-primary-foreground/60">
              {demoMode ? t('demo.generatedLabel') : t('lastSyncLabel')}
            </span>
            <span className="font-semibold">
              {demoMode && overview?.generated_at
                ? formatter.dateTime(new Date(overview.generated_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : capability?.last_successful_sync
                  ? formatter.dateTime(
                      new Date(capability.last_successful_sync),
                      {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }
                    )
                  : t('notAvailable')}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {demoMode ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/20 px-3 py-1 text-xs font-semibold text-primary-foreground">
                <FlaskConical className="size-3.5" aria-hidden="true" />
                {t('demo.badge')}
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-xs font-semibold">
                  <Facebook className="size-3.5" aria-hidden="true" />
                  {t(`capability.${capabilityStatus}.label`)}
                </span>
                {capabilityStatus === 'blocked' ? (
                  <Link
                    href="/connections"
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                      className:
                        'border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground',
                    })}
                  >
                    {t('connection.reconnectAction')}
                  </Link>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  onClick={onOpenDemo}
                >
                  <FlaskConical className="size-4" aria-hidden="true" />
                  {t('demo.open')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                  disabled={reloading}
                  onClick={onReload}
                >
                  <RefreshCw
                    className={
                      reloading ? 'size-4 motion-safe:animate-spin' : 'size-4'
                    }
                    aria-hidden="true"
                  />
                  {t('refreshOverview')}
                </Button>
              </>
            )}
            {demoMode ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                onClick={onOpenDemo}
              >
                {t('demo.exit')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}

function EmptyPerformanceState() {
  const t = useTranslations('Performance')

  return (
    <article className="grid gap-4 rounded-xl border border-border bg-surface p-6 shadow-elevated md:p-8">
      <span className="grid size-12 place-items-center rounded-lg bg-soft-teal text-primary">
        <Facebook className="size-6" aria-hidden="true" />
      </span>
      <div className="grid gap-2">
        <h2 className="text-xl font-bold text-navy md:text-2xl">{t('empty.title')}</h2>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          {t('empty.body')}
        </p>
      </div>
      <div>
        <Link href="/publishing" className={buttonVariants({ variant: 'outline' })}>
          {t('empty.action')}
        </Link>
      </div>
    </article>
  )
}

function BaselinePanel({
  overview,
  demoMode = false,
}: {
  readonly overview: PerformanceOverviewV1
  readonly demoMode?: boolean
}) {
  const t = useTranslations('Performance')
  const { baseline } = overview
  const progress = baselineProgress(
    baseline.observed_snapshot_count,
    baseline.required_snapshot_count
  )

  return (
    <article className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-elevated">
      <div className="grid gap-1">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
          {t('baseline.eyebrow')}
        </p>
        <h2 className="text-xl font-bold text-navy">
          {demoMode ? t('demo.baselineTitle') : t('baseline.title')}
        </h2>
      </div>
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-3xl font-bold tabular-nums text-navy">
            {t('baseline.count', {
              observed: baseline.observed_snapshot_count,
              required: baseline.required_snapshot_count,
            })}
          </p>
          <Badge
            variant={
              demoMode || baseline.status !== 'ready' ? 'default' : 'active'
            }
          >
            {demoMode
              ? t('demo.baselineStatus')
              : t(`baseline.status.${baseline.status}`)}
          </Badge>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={t('baseline.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={baseline.required_snapshot_count}
          aria-valuenow={Math.min(
            baseline.observed_snapshot_count,
            baseline.required_snapshot_count
          )}
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {demoMode ? t('demo.baselineExplanation') : t('baseline.explanation')}
      </p>
      {baseline.reason ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t(`baseline.reason.${baseline.reason}`)}
        </p>
      ) : null}
    </article>
  )
}

function ConnectionPanel({
  capability,
  demoMode = false,
}: {
  readonly capability: PerformanceCapabilityV1 | undefined
  readonly demoMode?: boolean
}) {
  const t = useTranslations('Performance')

  if (demoMode) {
    return (
      <article className="grid gap-4 rounded-xl border border-warning/30 bg-warning/10 p-5 shadow-elevated">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-xs font-semibold tracking-[0.12em] text-warning uppercase">
              {t('demo.connectionEyebrow')}
            </p>
            <h2 className="text-xl font-bold text-navy">
              {t('demo.connectionTitle')}
            </h2>
          </div>
          <Info className="mt-1 size-5 text-warning" aria-hidden="true" />
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('demo.connectionBody')}
        </p>
        <Badge variant="default">{t('demo.readOnly')}</Badge>
      </article>
    )
  }

  const status = capability?.status ?? 'unknown'
  const blockers = capability?.blockers ?? []

  return (
    <article className="grid gap-4 rounded-xl border border-border bg-surface p-5 shadow-elevated">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">
            {t('connection.eyebrow')}
          </p>
          <h2 className="text-xl font-bold text-navy">
            {t('connection.title')}
          </h2>
        </div>
        <ConnectionStatusIcon status={status} />
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        {t(`connection.status.${status}.body`)}
      </p>
      {blockers.length > 0 ? (
        <ul
          className="grid gap-2 text-sm"
          aria-label={t('connection.blockersLabel')}
        >
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-start gap-2 text-warning">
              <ShieldAlert
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>{t(`connection.blockers.${blocker}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        href="/connections"
        className={buttonVariants({
          variant: status === 'ready' ? 'outline' : 'default',
        })}
      >
        {status === 'ready'
          ? t('connection.viewAction')
          : t('connection.reconnectAction')}
      </Link>
    </article>
  )
}

function ConnectionStatusIcon({
  status,
}: {
  readonly status: PerformanceCapabilityV1['status']
}) {
  if (status === 'ready') {
    return (
      <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
        <CheckCircle2 className="size-5" />
      </span>
    )
  }
  if (status === 'blocked') {
    return (
      <span className="grid size-9 place-items-center rounded-lg bg-warning/10 text-warning" aria-hidden="true">
        <ShieldAlert className="size-5" />
      </span>
    )
  }
  return (
    <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
      <Info className="size-5" />
    </span>
  )
}

function PostEvidence({
  post,
  now,
  refreshing,
  onRefresh,
  formatDate,
  formatNumber,
  demoMode = false,
}: {
  readonly post: PerformancePostProjectionV1
  readonly now: Date
  readonly refreshing: boolean
  readonly onRefresh: () => void
  readonly formatDate: (value: string) => string
  readonly formatNumber: (value: number) => string
  readonly demoMode?: boolean
}) {
  const t = useTranslations('Performance')

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated">
      <header className="grid gap-4 border-b border-border bg-background p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-6">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Facebook className="size-4 text-primary" aria-hidden="true" />
            <h2 className="text-xl font-bold text-navy">{t('post.title')}</h2>
            <Badge variant={demoMode ? 'default' : 'owner'}>
              {demoMode ? t('demo.postBadge') : t('post.realEvidence')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('post.publishedAt', { date: formatDate(post.published_at) })}
          </p>
        </div>
        {demoMode ? (
          <span className="text-xs font-semibold text-warning">
            {t('demo.readOnly')}
          </span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw
              className={
                refreshing ? 'size-4 motion-safe:animate-spin' : 'size-4'
              }
              aria-hidden="true"
            />
            {refreshing ? t('post.refreshing') : t('post.refresh')}
          </Button>
        )}
      </header>

      <div className="grid gap-5 p-5 md:p-6">
        <EvidenceRail post={post} now={now} />
        <MetricComparison post={post} formatNumber={formatNumber} />
      </div>
    </article>
  )
}

function EvidenceRail({
  post,
  now,
}: {
  readonly post: PerformancePostProjectionV1
  readonly now: Date
}) {
  const t = useTranslations('Performance')

  return (
    <ol className="grid grid-cols-4 gap-1 border-y border-border/80 py-4" aria-label={t('rail.label')}>
      {PERFORMANCE_STAGE_ORDER.map((stage, index) => {
        const status = stageStatus(post, stage, now)
        return (
          <li key={stage} className="relative grid min-w-0 justify-items-center gap-2 px-1 text-center">
            <span
              className={
                index === PERFORMANCE_STAGE_ORDER.length - 1
                  ? 'hidden'
                  : 'absolute inset-inline-start-[calc(50%+18px)] inset-inline-end-[calc(-50%+18px)] top-4 h-px bg-border'
              }
              aria-hidden="true"
            />
            <StageIcon status={status} />
            <span className="relative text-xs font-semibold text-navy">
              {t(`rail.stages.${stage}.label`)}
            </span>
            <span className="relative text-[11px] leading-4 text-muted-foreground">
              {t(`rail.status.${status}`)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function StageIcon({ status }: { readonly status: PerformanceStageStatus }) {
  const className = 'relative z-10 size-4'
  if (status === 'complete') return <CheckCircle2 className={`${className} text-primary`} aria-hidden="true" />
  if (status === 'collecting') return <LoaderCircle className={`${className} text-action motion-safe:animate-spin`} aria-hidden="true" />
  if (status === 'retrying') return <RefreshCw className={`${className} text-warning`} aria-hidden="true" />
  if (status === 'blocked') return <ShieldAlert className={`${className} text-danger`} aria-hidden="true" />
  if (status === 'unavailable') return <XCircle className={`${className} text-danger`} aria-hidden="true" />
  return <Clock3 className={`${className} text-muted-foreground`} aria-hidden="true" />
}

function MetricComparison({
  post,
  formatNumber,
}: {
  readonly post: PerformancePostProjectionV1
  readonly formatNumber: (value: number) => string
}) {
  const t = useTranslations('Performance')
  const windows: readonly PerformanceWindow[] = ['24h', '72h', '7d']

  return (
    <section className="grid gap-3" aria-labelledby={`metrics-${post.publishing_result_id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`metrics-${post.publishing_result_id}`} className="text-base font-bold text-navy">
          {t('metrics.title')}
        </h3>
        <p className="text-xs text-muted-foreground">{t('metrics.caption')}</p>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('metrics.tableCaption')}</caption>
          <thead className="bg-muted/40">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-3 text-start text-xs font-semibold text-muted-foreground">
                {t('metrics.metric')}
              </th>
              {windows.map((window) => (
                <th key={window} scope="col" className="px-4 py-3 text-end text-xs font-semibold text-muted-foreground">
                  {t(`rail.stages.${window}.label`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERFORMANCE_METRIC_ORDER.map((metric) => (
              <tr key={metric} className="border-b border-border last:border-b-0">
                <th scope="row" className="px-4 py-3 text-start font-semibold text-navy">
                  {t(`metrics.names.${metric}`)}
                </th>
                {windows.map((window) => (
                  <td key={window} className="px-4 py-3 text-end tabular-nums">
                    <MetricValue
                      value={metricValueFor(post, window, metric)}
                      formatNumber={formatNumber}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 md:hidden" aria-label={t('metrics.tableCaption')}>
        {PERFORMANCE_METRIC_ORDER.map((metric) => (
          <div key={metric} className="grid gap-2 rounded-lg border border-border p-3">
            <h4 className="text-sm font-semibold text-navy">{t(`metrics.names.${metric}`)}</h4>
            <dl className="grid grid-cols-3 gap-2">
              {windows.map((window) => (
                <div key={window} className="grid gap-1 rounded-md bg-background p-2 text-center">
                  <dt className="text-[11px] text-muted-foreground">{t(`rail.stages.${window}.label`)}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-navy">
                    <MetricValue
                      value={metricValueFor(post, window, metric)}
                      formatNumber={formatNumber}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}

function MetricValue({
  value,
  formatNumber,
}: {
  readonly value: PerformanceMetricValueV1
  readonly formatNumber: (value: number) => string
}) {
  const t = useTranslations('Performance')
  if (value.status === 'available') {
    return <span>{formatNumber(value.value)}</span>
  }
  const reason = t(`metrics.reasons.${value.reason}`)
  return (
    <span
      className="font-medium text-muted-foreground"
      title={reason}
      aria-label={`${t('metrics.unavailable')}: ${reason}`}
    >
      {t('metrics.unavailable')}
    </span>
  )
}

function optimizationIdempotencyKey(
  proposalId: string,
  action: 'approve' | 'dismiss',
): string {
  return `optimization-decision:${proposalId}:${action}`
}

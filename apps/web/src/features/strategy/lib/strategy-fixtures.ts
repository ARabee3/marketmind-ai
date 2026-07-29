import type {
  StrategyProgressEvent,
  StrategyResource,
  StrategyStatus,
  StrategyVersionSummary,
} from '@marketmind/contracts'
import { createStrategyPlanFixture } from './strategy-plan-fixture'

export type StrategyDemoFixtureName =
  | 'locked'
  | 'ready'
  | 'generating'
  | 'draftReady'
  | 'draftNeedsBudget'
  | 'revisionFailed'

export type StrategyProfileSummary = {
  readonly businessName: string
  readonly businessType: string
  readonly location: string
  readonly confirmedAt: string
  readonly version: number
}

export type StrategyReadinessItem = {
  readonly id: string
  readonly labelKey: 'readiness.profile' | 'readiness.objective' | 'readiness.budget'
  readonly state: 'complete' | 'missing' | 'warning'
}

export type StrategyReviewSection = {
  readonly id: string
  readonly titleKey:
    | 'review.sections.summary.title'
    | 'review.sections.channels.title'
    | 'review.sections.budget.title'
  readonly bodyKey:
    | 'review.sections.summary.body'
    | 'review.sections.channels.body'
    | 'review.sections.budget.body'
  readonly sourceKey: 'review.sources.profile' | 'review.sources.guidance' | 'review.sources.ownerChoice'
}

export type StrategyDemoFixture = {
  readonly scenario: StrategyDemoFixtureName
  readonly isDemo: true
  readonly profile: StrategyProfileSummary | null
  readonly resource: StrategyResource
  readonly readiness: readonly StrategyReadinessItem[]
  readonly progress: readonly StrategyProgressEvent[]
  readonly reviewSections: readonly StrategyReviewSection[]
  readonly versions: readonly StrategyVersionSummary[]
}

const strategyId = '11111111-1111-4111-8111-111111111111'
const briefId = '22222222-2222-4222-8222-222222222222'
const retrievalRunId = '33333333-3333-4333-8333-333333333333'
const profileVersionId = '44444444-4444-4444-8444-444444444444'
const createdAt = '2026-07-17T10:00:00.000Z'

const profile: StrategyProfileSummary = {
  businessName: 'Nile Sweets',
  businessType: 'dessert shop',
  location: 'Assiut City, Assiut',
  confirmedAt: '2026-07-17T10:05:00.000Z',
  version: 2,
}

const brief = {
  id: briefId,
  strategy_id: strategyId,
  business_profile_version: {
    business_profile_version_id: profileVersionId,
    confirmed_at: profile.confirmedAt,
    version: profile.version,
  },
  primary_objective: 'conversion',
  start_date: '2026-08-01T00:00:00.000Z',
  plan_language: 'ar-EG',
  paid_media_allowed: true,
  external_budget_mode: 'scenario_only',
  external_budget_egp: null,
  team_capacity: 'Owner plus one part-time helper',
  constraints: ['No ad spend before owner approval'],
  clarification_answers: [],
  created_at: createdAt,
  updated_at: createdAt,
} satisfies NonNullable<StrategyResource['brief']>

const blockingPlan = createStrategyPlanFixture({
  idSuffix: 'draftNeedsBudget',
  brief,
  retrievalRunId,
  blockers: [
  {
    code: 'budget_required',
    field: 'external_budget_egp',
    message: 'Budget decision is required before approval.',
    severity: 'blocking',
  },
  ],
})

const approvedDecision = {
  id: '55555555-5555-4555-8555-555555555555',
  strategy_id: strategyId,
  strategy_version: 1,
  decision: 'approved',
  revision_notes: null,
  decided_by_user_id: '66666666-6666-4666-8666-666666666666',
  decided_at: '2026-07-17T12:00:00.000Z',
} satisfies NonNullable<StrategyVersionSummary['decision']>

export function getStrategyDemoFixture(name: StrategyDemoFixtureName): StrategyDemoFixture {
  if (name === 'locked') {
    return baseFixture(name, null, {
      strategy_id: strategyId,
      status: 'needs_brief',
      brief: null,
      latest_plan: null,
    })
  }

  const status: StrategyStatus =
    name === 'ready'
      ? 'ready'
      : name === 'generating'
        ? 'generating'
        : name === 'revisionFailed'
          ? 'failed'
          : 'draft'
  const latest_plan =
    name === 'draftNeedsBudget'
      ? blockingPlan
      : name === 'draftReady' || name === 'revisionFailed'
        ? createStrategyPlanFixture({ idSuffix: name, brief, retrievalRunId, blockers: [] })
        : null

  return baseFixture(name, profile, {
    strategy_id: strategyId,
    status,
    brief,
    latest_plan,
  })
}

function baseFixture(
  scenario: StrategyDemoFixtureName,
  profileSummary: StrategyProfileSummary | null,
  resource: StrategyResource,
): StrategyDemoFixture {
  return {
    scenario,
    isDemo: true,
    profile: profileSummary,
    resource,
    readiness: [
      { id: 'profile', labelKey: 'readiness.profile', state: profileSummary ? 'complete' : 'missing' },
      {
        id: 'objective',
        labelKey: 'readiness.objective',
        state: resource.brief ? 'complete' : 'missing',
      },
      {
        id: 'budget',
        labelKey: 'readiness.budget',
        state: resource.latest_plan?.blockers.some((blocker) => blocker.severity === 'blocking')
          ? 'missing'
          : 'warning',
      },
    ],
    progress: progressFor(resource.status),
    reviewSections: [
      {
        id: 'summary',
        titleKey: 'review.sections.summary.title',
        bodyKey: 'review.sections.summary.body',
        sourceKey: 'review.sources.profile',
      },
      {
        id: 'channels',
        titleKey: 'review.sections.channels.title',
        bodyKey: 'review.sections.channels.body',
        sourceKey: 'review.sources.guidance',
      },
      {
        id: 'budget',
        titleKey: 'review.sections.budget.title',
        bodyKey: 'review.sections.budget.body',
        sourceKey: 'review.sources.ownerChoice',
      },
    ],
    versions: versionsFor(scenario, resource.status),
  }
}

function progressFor(status: StrategyStatus): StrategyProgressEvent[] {
  const stages = ['queued', 'retrieval', 'generating', 'validating'] as const
  return stages.map((stage, index) => ({
    type: 'strategy_progress',
    strategy_id: strategyId,
    seq: index + 1,
    stage,
    status:
      status === 'draft' || status === 'approved'
        ? 'complete'
        : status === 'failed' && stage === 'validating'
          ? 'failed'
          : index < 3
            ? 'complete'
            : 'progress',
    message_key: `Strategy.progress.${stage}`,
    message_text: stage,
    retryable: status === 'failed',
    payload: {},
    created_at: createdAt,
  }))
}

function versionsFor(
  scenario: StrategyDemoFixtureName,
  status: StrategyStatus,
): StrategyVersionSummary[] {
  if (scenario === 'revisionFailed') {
    return [
      versionSummary(2, 'failed'),
      { ...versionSummary(1, 'approved'), decision: approvedDecision },
    ]
  }

  return [versionSummary(1, status)]
}

function versionSummary(version: number, status: StrategyStatus): StrategyVersionSummary {
  return {
    strategy_id: strategyId,
    version,
    status,
    brief_id: briefId,
    retrieval_run_id: retrievalRunId,
    created_at: createdAt,
  }
}

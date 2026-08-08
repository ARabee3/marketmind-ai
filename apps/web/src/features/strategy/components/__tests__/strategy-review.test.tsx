import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type {
  RetrievedKnowledgePack,
  SourcedClaim,
  StrategyResource,
} from '@marketmind/contracts'
import { StrategyReview } from '../strategy-review'
import { createStrategyPlanFixture } from '../../lib/strategy-plan-fixture'
import { createStrategyPlanV2Fixture } from '../../lib/strategy-plan-v2-fixture'

const mockResource = {
  strategy_id: 'strat-1',
  status: 'needs_brief',
  brief: null,
  latest_plan: null,
} satisfies StrategyResource

const brief: NonNullable<StrategyResource['brief']> = {
  id: '22222222-2222-4222-8222-222222222222',
  strategy_id: '11111111-1111-4111-8111-111111111111',
  business_profile_version: {
    business_profile_version_id: '44444444-4444-4444-8444-444444444444',
    confirmed_at: '2026-07-17T10:05:00.000Z',
    version: 2,
  },
  primary_objective: 'conversion',
  start_date: '2026-08-01T00:00:00.000Z',
  plan_language: 'ar-EG',
  paid_media_allowed: true,
  external_budget_mode: 'monthly_amount',
  external_budget_egp: 5000,
  team_capacity: 'Owner plus one helper',
  constraints: [],
  clarification_answers: [],
  created_at: '2026-07-28T10:00:00.000Z',
  updated_at: '2026-07-28T10:00:00.000Z',
}

const sourcedClaim: SourcedClaim = {
  text: 'Focus repeat orders before expanding paid ads.',
  source: 'model_synthesis',
  citation_ids: ['77777777-7777-4777-8777-777777777777'],
}

const draftResource = {
  strategy_id: brief.strategy_id,
  status: 'draft',
  brief,
  latest_plan: {
    ...createStrategyPlanFixture({
      idSuffix: 'draftReady',
      brief,
      retrievalRunId: '33333333-3333-4333-8333-333333333333',
      blockers: [],
    }),
    executive_summary: sourcedClaim,
    situation_diagnosis: {
      ...sourcedClaim,
      text: 'Customers already know the business, but repeat purchase signals need structure.',
    },
    selected_channels: [
      {
        channel: 'Facebook',
        role: 'primary',
        scores: {
          objective_fit: 80,
          audience_fit: 80,
          existing_presence: 70,
          asset_format_fit: 70,
          team_capacity: 70,
          budget_fit: 60,
          evidence_strength: 70,
          measurement_readiness: 60,
        },
        total_score: 70,
        excluded_reason: null,
        rationale: {
          ...sourcedClaim,
          text: 'Best fit for existing local audience conversations.',
        },
      },
    ],
    kpi_targets: [
      {
        metric: 'Repeat orders',
        funnel_stage: 'conversion',
        target_mode: 'owner_target',
        target_value: '+15%',
        measurement_method: 'Weekly order log',
        notes: sourcedClaim,
      },
    ],
  },
} satisfies StrategyResource

const retrievalPack = {
  retrieval_run_id: '33333333-3333-4333-8333-333333333333',
  query_summary: 'Egypt dessert-shop conversion guidance',
  query_context: {
    business_type: 'dessert shop',
    market: 'egypt',
    locale: 'ar-EG',
    objective: 'conversion',
    funnel_stage: 'conversion',
    active_channels: ['Facebook'],
    asset_capability: ['photo'],
    team_capacity: 'Owner plus one helper',
    budget_mode: 'monthly_amount',
    industry: 'hospitality',
  },
  profile_version_id: brief.business_profile_version.business_profile_version_id,
  brief_id: brief.id,
  items: [
    {
      chunk_id: '99999999-9999-4999-8999-999999999999',
      entry_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      entry_version: 1,
      title: 'Reviewed marketing guidance',
      excerpt: 'Use recent owner-confirmed evidence before approving the plan.',
      kind: 'framework',
      tags: { markets: ['egypt'] },
      relevance_score: 0.82,
      source_quality: {
        evidence_tier: 'reviewed_guidance',
        source_references: ['https://example.com/reviewed-guidance'],
        effective_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2027-01-01T00:00:00.000Z',
        review_status: 'approved',
      },
      market_tier: 'egypt',
      is_fallback: false,
      fallback_label: null,
    },
  ],
  knowledge_gaps: [],
  retrieval_metadata: {
    embedding_provider: 'fake',
    embedding_model: 'fake-32',
    embedding_dimensions: 32,
    collection_name: 'marketmind-test',
    retrieval_latency_ms: 10,
  },
  retrieved_at: '2026-07-28T10:00:00.000Z',
} satisfies RetrievedKnowledgePack

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'decision.approve') return 'Approve strategy'
    if (key === 'decision.revise') return 'Request revision'
    if (key === 'decision.reject') return 'Reject draft'
    if (key === 'profile.versionValue') return `Version ${values?.version}`
    return key
  },
  useFormatter: () => ({
    dateTime: () => 'Jul 17, 2026',
  }),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode
    href: string
  }) => <a href={href} {...props}>{children}</a>,
}))

describe('StrategyReview', () => {
  it('shows an explicit unavailable state when no draft exists', () => {
    render(
      <StrategyReview
        profile={null}
        resource={mockResource}
        currentVersionId={null}
        retrieval={null}
        progress={[]}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText('review.unavailableTitle')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve strategy' })).toBeNull()
  })

  it('dispatches owner-first strategy-v2 plans to the calendar review', () => {
    const v2Brief = {
      ...brief,
      weekly_capacity: 'three_to_five_hours',
      channel_choices: [
        {
          channel: 'facebook',
          role: 'primary',
          setup_state: 'setup_later',
        },
      ],
    } as const
    const v2Resource = {
      strategy_id: brief.strategy_id,
      status: 'draft',
      brief: v2Brief,
      latest_plan: {
        ...createStrategyPlanV2Fixture({
          idSuffix: 'draftReady',
          brief: v2Brief,
          retrievalRunId: '33333333-3333-4333-8333-333333333333',
          blockers: [],
        }),
        goal: sourcedClaim,
        content_handoff: {
          available: false,
          reason: 'no_content_supported_channels',
          message: 'owner-managed plan',
        },
      },
    } satisfies StrategyResource

    render(
      <StrategyReview
        profile={null}
        resource={v2Resource}
        currentVersionId="88888888-8888-4888-8888-888888888888"
        retrieval={null}
        progress={[]}
        onRefresh={vi.fn()}
      />,
    )

    // The v2 review shows the calendar-first reading order, not v1 chapters.
    expect(screen.getByText('reviewV2.badge')).toBeTruthy()
    expect(screen.getByText('reviewV2.openAdvice')).toBeTruthy()
    expect(screen.queryByText('review.sections.overview.title')).toBeNull()
  })

  it('renders the latest strategy plan instead of static demo copy', () => {
    render(
      <StrategyReview
        profile={null}
        resource={draftResource}
        currentVersionId="88888888-8888-4888-8888-888888888888"
        retrieval={null}
        progress={[]}
        onRefresh={vi.fn()}
      />,
    )

    expect(
      screen.getAllByText('Focus repeat orders before expanding paid ads.').length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Best fit for existing local audience conversations.')).toBeTruthy()
    expect(screen.getByText('+15%')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve strategy' }).hasAttribute('disabled')).toBe(true)
  })

  it('enables approval only when profile, blockers, and persisted evidence are valid', () => {
    render(
      <StrategyReview
        profile={{
          businessName: 'Nile Sweets',
          businessType: 'dessert shop',
          location: 'Assiut',
          confirmedAt: brief.business_profile_version.confirmed_at,
          version: brief.business_profile_version.version,
        }}
        resource={draftResource}
        currentVersionId="88888888-8888-4888-8888-888888888888"
        retrieval={retrievalPack}
        progress={[]}
        onRefresh={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Approve strategy' }).hasAttribute('disabled'),
    ).toBe(false)
    expect(screen.queryByText('review.invalidEvidenceTitle')).toBeNull()
  })
})

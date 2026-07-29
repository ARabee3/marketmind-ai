import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SourcedClaim, StrategyResource } from '@marketmind/contracts'
import { StrategyReview } from '../strategy-review'
import { createStrategyPlanFixture } from '../../lib/strategy-plan-fixture'

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

describe('StrategyReview', () => {
  it('disables decision controls until ready for approval', () => {
    render(<StrategyReview profile={null} resource={mockResource} />)

    for (const name of ['Approve strategy', 'Request revision', 'Reject draft']) {
      expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
    }
  })

  it('renders the latest strategy plan instead of static demo copy', () => {
    render(<StrategyReview profile={null} resource={draftResource} />)

    expect(screen.getByText('Focus repeat orders before expanding paid ads.')).toBeTruthy()
    expect(screen.getByText('Facebook: Best fit for existing local audience conversations.')).toBeTruthy()
    expect(screen.getByText('Repeat orders: +15%')).toBeTruthy()
  })
})

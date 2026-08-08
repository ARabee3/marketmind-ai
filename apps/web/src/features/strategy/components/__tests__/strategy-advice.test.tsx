import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StrategyPlanV2 } from '@marketmind/contracts'
import { StrategyAdvice } from '../strategy-advice'

const messages: Record<string, string> = {
  'advice.badge': 'Owner advice',
  'advice.title': 'Your to-do list for the plan',
  'advice.subtitle': 'Every item is something you do.',
  'advice.beforeWeek1': 'Before week 1',
  'advice.beforeWeek1Body': 'Set up the foundation.',
  'advice.weekBucket': 'Week {week}',
  'advice.backToReview': 'Back to the plan',
  'advice.action': 'What you do',
  'advice.why': 'Why it matters',
  'advice.timing': 'When',
  'advice.category': 'Category',
  'advice.categories.channel_setup': 'Channel setup',
  'advice.categories.content': 'Content',
  'advice.categories.measurement': 'Measurement',
  'advice.categories.budget': 'Budget',
  'advice.categories.audience': 'Audience',
  'advice.categories.capability': 'Capability',
  'advice.empty': 'No advice items for this week.',
  'advice.weekLink': 'See this week in the plan',
}

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const template = messages[key] ?? key
    if (!values) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      String(values[name] ?? `{${name}}`),
    )
  },
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={String(href)}>{children}</a>
  ),
}))

const plan: StrategyPlanV2 = {
  id: 'p1',
  strategy_id: 'strat-1',
  version: 1,
  contract_version: 'strategy-v2',
  brief_id: 'b1',
  profile_version: {
    business_profile_version_id: 'pv1',
    confirmed_at: '2026-07-17T10:05:00.000Z',
    version: 1,
  },
  retrieval_run_id: 'r1',
  goal: {
    text: 'جذب عملاء جدد',
    source: 'owner_input',
    citation_ids: [],
  },
  primary_objective: 'acquisition',
  funnel_stage: 'awareness_to_purchase',
  plan_language: 'ar-EG',
  start_date: '2026-08-03T00:00:00.000Z',
  calendar_weeks: [],
  owner_advice: {
    before_week_1: [
      {
        id: 'adv-b1',
        week_number: 0,
        category: 'channel_setup',
        action: 'Complete the Facebook page setup.',
        why_it_matters: 'A complete page builds the first impression.',
        timing: 'Within the first three days',
        source: {
          text: 'Reviewed local guidance.',
          source: 'retrieved_evidence',
          citation_ids: ['c1'],
        },
      },
    ],
    weeks: [
      {
        week_number: 1,
        items: [
          {
            id: 'adv-1',
            week_number: 1,
            category: 'content',
            action: 'Publish the week content and record the result.',
            why_it_matters: 'Small consistent actions build results.',
            timing: 'Before the end of the week',
            source: {
              text: 'Based on the owner capacity.',
              source: 'owner_input',
              citation_ids: [],
            },
          },
        ],
      },
      {
        week_number: 2,
        items: [],
      },
    ],
  },
  channel_commitments: [],
  evidence_summary: {
    text: 'Evidence summary',
    source: 'model_synthesis',
    citation_ids: [],
  },
  risks: [],
  knowledge_gaps: [],
  blockers: [],
  citations: [],
  content_handoff: {
    available: false,
    reason: 'no_content_supported_channels',
    message: 'owner-managed plan',
  },
  created_at: '2026-07-28T09:00:00.000Z',
}

describe('StrategyAdvice', () => {
  it('groups advice by Before week 1 and each week', () => {
    render(<StrategyAdvice strategyId="strat-1" plan={plan} />)

    expect(screen.getByRole('heading', { name: 'Before week 1' })).toBeTruthy()
    expect(screen.getByText('Week 1')).toBeTruthy()
    expect(screen.getByText('Week 2')).toBeTruthy()
    expect(screen.getByText('Complete the Facebook page setup.')).toBeTruthy()
    expect(
      screen.getByText('Publish the week content and record the result.'),
    ).toBeTruthy()
  })

  it('shows an empty state for weeks without advice', () => {
    render(<StrategyAdvice strategyId="strat-1" plan={plan} />)
    expect(screen.getByText('No advice items for this week.')).toBeTruthy()
  })

  it('links back to the plan review', () => {
    render(<StrategyAdvice strategyId="strat-1" plan={plan} />)
    expect(screen.getByText('Back to the plan')).toBeTruthy()
  })
})

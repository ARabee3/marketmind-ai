import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DraftReview } from '../draft-review'
import type { BusinessProfileDraft, DiscoveryStatusResponse } from '@marketmind/contracts'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (value: number, opts?: { style?: string }) => {
      if (opts?.style === 'percent') return `${Math.round(value * 100)}%`
      return String(value)
    },
  }),
}))

function makeDraft(overrides: Partial<BusinessProfileDraft> = {}): BusinessProfileDraft {
  return {
    id: 'draft-1',
    session_id: 'test-session',
    version: 1,
    status: 'ready_for_confirmation',
    completeness: 'incomplete',
    completion_reason: 'owner_finished_early',
    readiness: {
      ready: false,
      llm_recommended: false,
      profile_readiness: 0.6,
      domain_scores: {
        identity: 1,
        offer: 0.5,
        customers: 0.5,
        differentiation: 0.5,
        current_marketing: 0.5,
        goals_and_constraints: 0.5,
        market_context: 0.5,
        research_confidence: 0.5,
        profile_readiness: 0.6,
      },
      blocking_domains: ['offer'],
      owner_turn_count: 5,
      max_owner_turns: 15,
    },
    confirmed_facts: {
      identity: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
      offer: { core_offerings: ['Coffee'], best_sellers: [], purchase_occasions: [] },
      customers: { primary_segments: [], visit_or_order_occasions: [], peak_periods: [], customer_needs: [] },
      differentiation: { owner_claimed_strengths: [], customer_choice_reasons: [], proof_points: [] },
      current_marketing: { active_channels: [], current_activities: [], delivery_platforms: [], available_assets: [] },
      goals_and_constraints: { growth_goals: [], operational_constraints: [] },
    },
    market_context: { competitor_landscape: [], local_demand_signals: [], digital_presence_signals: [], other_signals: [] },
    research_observations: [],
    uncertainties: [
      {
        field_key: 'f1',
        domain: 'offer',
        description: 'Missing info',
        severity: 'medium',
        category: 'missing_information',
        source: 'owner_unknown',
        resolved: false,
      },
    ],
    owner_goals: ['Grow revenue'],
    strategy_relevant_notes: ['Note 1'],
    raw_ai_output: {},
    ...overrides,
  }
}

function makeStatus(overrides: Partial<DiscoveryStatusResponse> = {}): DiscoveryStatusResponse {
  return {
    session_id: 'test-session',
    status: 'summary_ready',
    language_mode: 'en',
    intake_summary: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
    intelligence: {
      status: 'complete',
      search_mode: 'free_search',
      source_refs: [
        {
          id: 'source-1',
          source_type: 'search_result',
          url: 'https://example.com/cafe',
          title: 'Example Cafe',
          snippet: 'A nice cafe in Cairo',
          confidence: 0.8,
          metadata: {},
        },
        {
          id: 'source-2',
          source_type: 'metadata',
          url: 'ftp://invalid.url',
          title: 'Invalid source',
          snippet: '',
          confidence: 0.5,
          metadata: {},
        },
      ],
      research_observations: [
        {
          id: 'obs-1',
          source_ref_id: 'source-1',
          kind: 'market_context',
          statement: 'Cairo cafe market is growing',
          confidence: 0.8,
          visibility: 'owner_visible',
          status: 'accepted',
          metadata: {},
        },
        {
          id: 'obs-2',
          source_ref_id: 'source-1',
          kind: 'competitor',
          statement: 'Competitor analysis internal note',
          confidence: 0.7,
          visibility: 'internal',
          status: 'accepted',
          metadata: {},
        },
        {
          id: 'obs-3',
          source_ref_id: 'source-1',
          kind: 'market_context',
          statement: 'Discarded observation',
          confidence: 0.3,
          visibility: 'owner_visible',
          status: 'discarded',
          metadata: {},
        },
      ],
      conversation_hooks: [],
      knowledge_gaps: [],
    },
    messages: [],
    profile_state: {
      known_facts: {
        identity: { business_name: 'Test Cafe', business_type: 'Cafe', city: 'Cairo' },
        offer: { core_offerings: ['Coffee'], best_sellers: [], purchase_occasions: [] },
        customers: { primary_segments: [], visit_or_order_occasions: [], peak_periods: [], customer_needs: [] },
        differentiation: { owner_claimed_strengths: [], customer_choice_reasons: [], proof_points: [] },
        current_marketing: { active_channels: [], current_activities: [], delivery_platforms: [], available_assets: [] },
        goals_and_constraints: { growth_goals: [], operational_constraints: [] },
      },
      uncertainties: [],
      readiness: {
        ready: false,
        llm_recommended: false,
        profile_readiness: 0.6,
        domain_scores: {
          identity: 1,
          offer: 0.5,
          customers: 0.5,
          differentiation: 0.5,
          current_marketing: 0.5,
          goals_and_constraints: 0.5,
          market_context: 0.5,
          research_confidence: 0.5,
          profile_readiness: 0.6,
        },
        blocking_domains: ['offer'],
        owner_turn_count: 5,
        max_owner_turns: 15,
      },
    },
    progress_events: [],
    strategy_locked: true,
    ...overrides,
  }
}

describe('DraftReview', () => {
  it('renders completeness and completion reason', () => {
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft()}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('incomplete')).toBeDefined()
    expect(screen.getByText((content) => content.includes('reason_owner_finished_early'))).toBeDefined()
  })

  it('shows blocking domains', () => {
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft()}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getAllByText('domainOffer').length).toBeGreaterThanOrEqual(1)
  })

  it('shows owner goals and strategy notes', () => {
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft()}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('Grow revenue')).toBeDefined()
    expect(screen.getByText('Note 1')).toBeDefined()
  })

  it('shows unresolved uncertainties', () => {
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft()}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText('Missing info')).toBeDefined()
  })

  it('requires acknowledgement for incomplete draft', () => {
    const onConfirm = vi.fn()
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft()}
        pending={false}
        onConfirm={onConfirm}
      />,
    )

    const confirmButton = screen.getByRole('button', { name: 'confirmProfile' })
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true)

    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    expect((confirmButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('does not show acknowledgement for complete draft', () => {
    const onConfirm = vi.fn()
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft({ completeness: 'complete', completion_reason: 'sufficient' })}
        pending={false}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.queryByRole('checkbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'confirmProfile' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('shows not provided for empty fields', () => {
    render(
      <DraftReview
        status={makeStatus()}
        draft={makeDraft()}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getAllByText('notProvided').length).toBeGreaterThan(0)
  })

  it('renders visible accepted observations not in market_context', () => {
    const status = makeStatus()
    const draft = makeDraft({
      research_observations: [
        {
          id: 'obs-1',
          source_ref_id: 'source-1',
          kind: 'market_context',
          statement: 'Cairo cafe market is growing',
          confidence: 0.8,
          visibility: 'owner_visible',
          status: 'accepted',
          metadata: {},
        },
      ],
    })
    render(
      <DraftReview
        status={status}
        draft={draft}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    // obs-1 is accepted, owner_visible, and not in market_context
    expect(screen.getByText('Cairo cafe market is growing')).toBeDefined()
  })

  it('hides internal and discarded observations', () => {
    const status = makeStatus()
    render(
      <DraftReview
        status={status}
        draft={makeDraft()}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.queryByText('Competitor analysis internal note')).toBeNull()
    expect(screen.queryByText('Discarded observation')).toBeNull()
  })

  it('deduplicates observations already in market_context evidence', () => {
    const status = makeStatus()
    const draft = makeDraft({
      market_context: {
        competitor_landscape: [],
        local_demand_signals: [
          {
            observation_id: 'obs-1',
            source_ref_id: 'source-1',
            statement: 'Cairo cafe market is growing',
            confidence: 0.8,
          },
        ],
        digital_presence_signals: [],
        other_signals: [],
      },
    })

    render(
      <DraftReview
        status={status}
        draft={draft}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    // obs-1 is already in local_demand_signals, so it should not appear in observations
    const observationSection = screen.queryByText('observationsTitle')
    expect(observationSection).toBeNull()
  })

  it('shows notProvided when all evidence is empty', () => {
    const status = makeStatus()
    const draft = makeDraft({
      market_context: {
        competitor_landscape: [],
        local_demand_signals: [],
        digital_presence_signals: [],
        other_signals: [],
      },
      research_observations: [],
    })

    render(
      <DraftReview
        status={status}
        draft={draft}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    // Scope to the market evidence card; there are other notProvided spans in facts
    const marketEvidenceCard = screen.getByText('marketEvidenceTitle').closest('[data-slot="card"]')
    expect(marketEvidenceCard?.textContent).toContain('notProvided')
  })

  it('renders only valid http/https links', () => {
    const status = makeStatus()
    const draft = makeDraft({
      market_context: {
        competitor_landscape: [
          {
            observation_id: 'obs-4',
            source_ref_id: 'source-2',
            statement: 'Invalid URL source',
            confidence: 0.5,
          },
        ],
        local_demand_signals: [],
        digital_presence_signals: [],
        other_signals: [],
      },
    })

    render(
      <DraftReview
        status={status}
        draft={draft}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    // source-2 has ftp:// URL which should not render as a clickable anchor
    expect(screen.getByText('Invalid source')).toBeDefined()
    expect(screen.queryByRole('link', { name: /Invalid source/ })).toBeNull()
  })

  it('preserves original citation content', () => {
    const status = makeStatus()
    const draft = makeDraft({
      market_context: {
        competitor_landscape: [],
        local_demand_signals: [
          {
            observation_id: 'obs-cite',
            source_ref_id: 'source-1',
            statement: 'Cairo cafe market is growing',
            confidence: 0.8,
          },
        ],
        digital_presence_signals: [],
        other_signals: [],
      },
    })
    render(
      <DraftReview
        status={status}
        draft={draft}
        pending={false}
        onConfirm={vi.fn()}
      />,
    )

    // The evidence should show the exact statement
    expect(screen.getByText('Cairo cafe market is growing')).toBeDefined()
    // The source title should be preserved
    expect(screen.getByText('Example Cafe')).toBeDefined()
    // The snippet should be preserved
    expect(screen.getByText('A nice cafe in Cairo')).toBeDefined()
  })
})

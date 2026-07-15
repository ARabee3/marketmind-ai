import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { DiscoveryStatusResponse } from '@marketmind/contracts'
import { useDiscoverySession } from '../use-discovery-session'
import {
  getDiscoveryStatus,
  respondToDiscovery,
  summarizeDiscovery,
  confirmDiscoveryProfile,
} from '@/lib/api/discovery'

vi.mock('@/lib/api/discovery', () => ({
  getDiscoveryStatus: vi.fn(),
  respondToDiscovery: vi.fn(),
  summarizeDiscovery: vi.fn(),
  confirmDiscoveryProfile: vi.fn(),
}))

function makeStatus(overrides: Partial<DiscoveryStatusResponse> = {}): DiscoveryStatusResponse {
  return {
    session_id: 'test-session',
    status: 'in_progress',
    language_mode: 'en',
    current_question: 'What is your best selling product?',
    intake_summary: { business_name: 'Test', business_type: 'Cafe', city: 'Cairo' },
    intelligence: {
      status: 'complete',
      search_mode: 'free_search',
      source_refs: [],
      research_observations: [],
      conversation_hooks: [],
      knowledge_gaps: [],
    },
    messages: [],
    profile_state: {
      known_facts: {
        identity: { business_name: 'Test', business_type: 'Cafe', city: 'Cairo' },
        offer: { core_offerings: [], best_sellers: [], purchase_occasions: [] },
        customers: { primary_segments: [], visit_or_order_occasions: [], peak_periods: [], customer_needs: [] },
        differentiation: { owner_claimed_strengths: [], customer_choice_reasons: [], proof_points: [] },
        current_marketing: { active_channels: [], current_activities: [], delivery_platforms: [], available_assets: [] },
        goals_and_constraints: { growth_goals: [], operational_constraints: [] },
      },
      uncertainties: [],
      readiness: {
        ready: false,
        llm_recommended: false,
        profile_readiness: 0.5,
        domain_scores: {
          identity: 1,
          offer: 0.5,
          customers: 0.5,
          differentiation: 0.5,
          current_marketing: 0.5,
          goals_and_constraints: 0.5,
          market_context: 0.5,
          research_confidence: 0.5,
          profile_readiness: 0.5,
        },
        blocking_domains: ['offer'],
        owner_turn_count: 2,
        max_owner_turns: 15,
      },
    },
    progress_events: [],
    strategy_locked: true,
    ...overrides,
  }
}

describe('useDiscoverySession', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('hydrates from /status on mount', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValueOnce(makeStatus({
      status: 'in_progress',
      current_suggested_answers: ['Families', 'Office workers'],
    }))

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))
    expect(result.current.status).not.toBeNull()
    expect(result.current.status?.status).toBe('in_progress')
    expect(result.current.status?.current_suggested_answers).toEqual([
      'Families',
      'Office workers',
    ])
  })

  it('shows load_error when /status fails', async () => {
    vi.mocked(getDiscoveryStatus).mockRejectedValueOnce({ status: 500, code: 'server_error', message: 'fail' })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('load_error'))
    expect(result.current.errorTranslationKey).toBe('Errors.serverError')
  })

  it('prevents duplicate respond while pending', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValue(makeStatus({ status: 'in_progress' }))
    vi.mocked(respondToDiscovery).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({} as unknown as Awaited<ReturnType<typeof respondToDiscovery>>), 1000)),
    )

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    act(() => {
      result.current.respond('answer 1')
    })

    expect(result.current.pending).toBe(true)

    // Second call should be ignored
    act(() => {
      result.current.respond('answer 2')
    })

    expect(vi.mocked(respondToDiscovery)).toHaveBeenCalledTimes(1)
  })

  it('rejects whitespace-only answers', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValue(makeStatus())

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    await act(async () => {
      const r1 = await result.current.respond('')
      expect(r1.accepted).toBe(false)
    })

    await act(async () => {
      const r2 = await result.current.respond('   ')
      expect(r2.accepted).toBe(false)
    })

    expect(vi.mocked(respondToDiscovery)).not.toHaveBeenCalled()
  })

  it('preserves real answers with leading and trailing whitespace byte-for-byte', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValue(makeStatus())
    vi.mocked(respondToDiscovery).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof respondToDiscovery>>)

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    await act(async () => {
      const r = await result.current.respond('  إجابة / answer  ')
      expect(r.accepted).toBe(true)
    })

    expect(vi.mocked(respondToDiscovery)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(respondToDiscovery)).toHaveBeenLastCalledWith(
      'test',
      { message: '  إجابة / answer  ' },
    )
  })

  it('returns accepted after known successful respond', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValue(makeStatus())
    vi.mocked(respondToDiscovery).mockResolvedValueOnce({} as unknown as Awaited<ReturnType<typeof respondToDiscovery>>)

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    let accepted = false
    await act(async () => {
      const r = await result.current.respond('my answer')
      accepted = r.accepted
    })

    expect(accepted).toBe(true)
    expect(getDiscoveryStatus).toHaveBeenCalledTimes(2) // initial + refresh
  })

  it('retains input after unpersisted failure (no new owner message)', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValue(makeStatus())
    vi.mocked(respondToDiscovery).mockRejectedValueOnce({ status: 500, code: 'server_error', message: 'fail' })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    let accepted = true
    await act(async () => {
      const r = await result.current.respond('my answer')
      accepted = r.accepted
    })

    expect(accepted).toBe(false)
    expect(getDiscoveryStatus).toHaveBeenCalledTimes(2) // initial + recovery
  })

  it('accepts after failed POST when recovered status shows new owner message', async () => {
    const initialStatus = makeStatus({
      messages: [{ id: 'msg-1', role: 'assistant', content: 'Q1', language: 'en', source: 'chat', created_at: '2026-01-01T00:00:00Z' }],
    })
    const recoveredStatus = makeStatus({
      messages: [
        { id: 'msg-1', role: 'assistant', content: 'Q1', language: 'en', source: 'chat', created_at: '2026-01-01T00:00:00Z' },
        { id: 'msg-2', role: 'owner', content: 'my answer', language: 'en', source: 'chat', created_at: '2026-01-01T00:00:01Z' },
      ],
    })

    vi.mocked(getDiscoveryStatus)
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(recoveredStatus)

    vi.mocked(respondToDiscovery).mockRejectedValueOnce({ status: 500, code: 'server_error', message: 'fail' })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    let accepted = false
    await act(async () => {
      const r = await result.current.respond('my answer')
      accepted = r.accepted
    })

    expect(accepted).toBe(true)
    expect(getDiscoveryStatus).toHaveBeenCalledTimes(2)
  })

  it('recovers status after failed respond', async () => {
    vi.mocked(getDiscoveryStatus).mockResolvedValue(makeStatus())
    vi.mocked(respondToDiscovery).mockRejectedValueOnce({ status: 500, code: 'server_error', message: 'fail' })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    await act(async () => {
      await result.current.respond('my answer')
    })

    expect(result.current.pending).toBe(false)
    expect(getDiscoveryStatus).toHaveBeenCalledTimes(2) // initial + recovery
  })

  it('transitions to review after summarize', async () => {
    const draft = {
      id: 'draft-1',
      session_id: 'test-session',
      version: 1,
      status: 'ready_for_confirmation' as const,
      completeness: 'complete' as const,
      completion_reason: 'sufficient' as const,
      readiness: makeStatus().profile_state.readiness,
      confirmed_facts: makeStatus().profile_state.known_facts,
      market_context: { competitor_landscape: [], local_demand_signals: [], digital_presence_signals: [], other_signals: [] },
      research_observations: [],
      uncertainties: [],
      owner_goals: [],
      strategy_relevant_notes: [],
      raw_ai_output: {},
    }

    vi.mocked(getDiscoveryStatus)
      .mockResolvedValueOnce(makeStatus({ status: 'in_progress' }))
      .mockResolvedValueOnce(makeStatus({ status: 'summary_ready', profile_draft: draft }))

    vi.mocked(summarizeDiscovery).mockResolvedValueOnce({
      session_id: 'test-session',
      status: 'summary_ready',
      profile_draft: draft,
      strategy_locked: true,
    })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    await act(async () => {
      await result.current.summarize({})
    })

    await waitFor(() => expect(result.current.phase).toBe('review'))
    expect(result.current.status?.profile_draft).toBeDefined()
  })

  it('transitions to confirmed after confirm', async () => {
    const draft = {
      id: 'draft-1',
      session_id: 'test-session',
      version: 1,
      status: 'ready_for_confirmation' as const,
      completeness: 'complete' as const,
      completion_reason: 'sufficient' as const,
      readiness: makeStatus().profile_state.readiness,
      confirmed_facts: makeStatus().profile_state.known_facts,
      market_context: { competitor_landscape: [], local_demand_signals: [], digital_presence_signals: [], other_signals: [] },
      research_observations: [],
      uncertainties: [],
      owner_goals: [],
      strategy_relevant_notes: [],
      raw_ai_output: {},
    }

    vi.mocked(getDiscoveryStatus)
      .mockResolvedValueOnce(makeStatus({ status: 'summary_ready', profile_draft: draft }))
      .mockResolvedValueOnce(makeStatus({ status: 'confirmed', profile_draft: { ...draft, status: 'confirmed' } }))

    vi.mocked(confirmDiscoveryProfile).mockResolvedValueOnce({
      session_id: 'test-session',
      status: 'confirmed',
      business_profile_version_id: 'version-1',
      confirmed_at: new Date().toISOString(),
      strategy_locked: false,
    })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('review'))

    await act(async () => {
      await result.current.confirm({ profile_draft_id: 'draft-1', owner_confirmation: true })
    })

    await waitFor(() => expect(result.current.phase).toBe('confirmed'))
  })

  it('transitions directly to review when respond returns summary_ready', async () => {
    const draft = {
      id: 'draft-auto',
      session_id: 'test-session',
      version: 1,
      status: 'ready_for_confirmation' as const,
      completeness: 'complete' as const,
      completion_reason: 'sufficient' as const,
      readiness: {
        ...makeStatus().profile_state.readiness,
        ready: true,
        llm_recommended: true,
        owner_turn_count: 3,
      },
      confirmed_facts: makeStatus().profile_state.known_facts,
      market_context: { competitor_landscape: [], local_demand_signals: [], digital_presence_signals: [], other_signals: [] },
      research_observations: [],
      uncertainties: [],
      owner_goals: [],
      strategy_relevant_notes: [],
      raw_ai_output: {},
    }

    const initialStatus = makeStatus({ status: 'in_progress' })
    const summaryStatus = makeStatus({
      status: 'summary_ready',
      profile_draft: draft,
      profile_state: {
        ...initialStatus.profile_state,
        readiness: draft.readiness,
      },
    })

    vi.mocked(getDiscoveryStatus)
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(summaryStatus)

    vi.mocked(respondToDiscovery).mockResolvedValueOnce({
      session_id: 'test-session',
      status: 'summary_ready',
      assistant_message: {
        id: 'msg-auto',
        role: 'assistant',
        content: 'Review ready',
        language: 'en',
        source: 'chat',
        created_at: new Date().toISOString(),
      },
      updated_known_facts: initialStatus.profile_state.known_facts,
      uncertainties: [],
      readiness: draft.readiness,
      profile_draft: draft,
      strategy_locked: true,
    })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    await act(async () => {
      const response = await result.current.respond('my answer')
      expect(response.accepted).toBe(true)
    })

    await waitFor(() => expect(result.current.phase).toBe('review'))
    expect(result.current.status?.profile_draft).toBeDefined()
    expect(result.current.status?.profile_draft?.completeness).toBe('complete')
    expect(summarizeDiscovery).not.toHaveBeenCalled()
  })

  it('transitions to review with incomplete turn_limit draft at fifteenth turn', async () => {
    const draft = {
      id: 'draft-limit',
      session_id: 'test-session',
      version: 1,
      status: 'ready_for_confirmation' as const,
      completeness: 'incomplete' as const,
      completion_reason: 'turn_limit' as const,
      readiness: {
        ...makeStatus().profile_state.readiness,
        ready: false,
        llm_recommended: false,
        owner_turn_count: 15,
      },
      confirmed_facts: makeStatus().profile_state.known_facts,
      market_context: { competitor_landscape: [], local_demand_signals: [], digital_presence_signals: [], other_signals: [] },
      research_observations: [],
      uncertainties: [
        {
          field_key: 'budget',
          domain: 'goals_and_constraints',
          description: 'Marketing budget unknown',
          severity: 'low',
          category: 'owner_unknown',
          source: 'owner_unknown',
          resolved: false,
        } as const,
      ],
      owner_goals: [],
      strategy_relevant_notes: [],
      raw_ai_output: {},
    }

    const initialStatus = makeStatus({
      status: 'in_progress',
      profile_state: {
        ...makeStatus().profile_state,
        readiness: { ...makeStatus().profile_state.readiness, owner_turn_count: 14 },
      },
    })
    const summaryStatus = makeStatus({
      status: 'summary_ready',
      profile_draft: draft,
      profile_state: {
        ...initialStatus.profile_state,
        readiness: draft.readiness,
      },
    })

    vi.mocked(getDiscoveryStatus)
      .mockResolvedValueOnce(initialStatus)
      .mockResolvedValueOnce(summaryStatus)

    vi.mocked(respondToDiscovery).mockResolvedValueOnce({
      session_id: 'test-session',
      status: 'summary_ready',
      assistant_message: {
        id: 'msg-limit',
        role: 'assistant',
        content: 'We have reached the question limit.',
        language: 'en',
        source: 'chat',
        created_at: new Date().toISOString(),
      },
      updated_known_facts: initialStatus.profile_state.known_facts,
      uncertainties: draft.uncertainties,
      readiness: draft.readiness,
      profile_draft: draft,
      strategy_locked: true,
    })

    const { result } = renderHook(() => useDiscoverySession({ sessionId: 'test' }))

    await waitFor(() => expect(result.current.phase).toBe('interview'))

    await act(async () => {
      const response = await result.current.respond('last answer')
      expect(response.accepted).toBe(true)
    })

    await waitFor(() => expect(result.current.phase).toBe('review'))
    expect(result.current.status?.profile_draft).toBeDefined()
    expect(result.current.status?.profile_draft?.completeness).toBe('incomplete')
    expect(result.current.status?.profile_draft?.completion_reason).toBe('turn_limit')
    expect(result.current.status?.profile_state.readiness.owner_turn_count).toBe(15)
    expect(result.current.status?.profile_state.readiness.ready).toBe(false)
  })
})

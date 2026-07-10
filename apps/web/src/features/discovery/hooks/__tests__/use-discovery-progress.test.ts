import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type {
  DiscoveryProfileState,
  DiscoveryProgressEvent,
} from '@marketmind/contracts'
import { useDiscoveryProgress, isResearchActive, isTerminal, canOpenInterview } from '../use-discovery-progress'
import { getDiscoveryStatus } from '@/lib/api/discovery'

// Mock API client
vi.mock('@/lib/api/discovery', () => ({
  getDiscoveryStatus: vi.fn(),
}))

// Mock Socket.IO client
const mockSocketOn = vi.fn()
const mockSocketEmit = vi.fn()
const mockSocketDisconnect = vi.fn()
const mockSocketConnect = vi.fn()
const mockIoOn = vi.fn()
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: mockSocketOn,
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
    connect: mockSocketConnect,
    io: {
      on: mockIoOn,
    },
  }),
}))

function makeEvent(
  seq: number,
  stage: DiscoveryProgressEvent['stage'],
  status: DiscoveryProgressEvent['status'],
  messageKey: string,
): DiscoveryProgressEvent {
  return {
    type: 'progress',
    seq,
    stage,
    status,
    message_key: messageKey,
    message_text: '',
    payload: {},
    created_at: '',
    session_id: 'test',
  }
}

const emptyProfileState: DiscoveryProfileState = {
  known_facts: {
    identity: {},
    offer: { core_offerings: [], best_sellers: [], purchase_occasions: [] },
    customers: {
      primary_segments: [],
      visit_or_order_occasions: [],
      peak_periods: [],
      customer_needs: [],
    },
    differentiation: {
      owner_claimed_strengths: [],
      customer_choice_reasons: [],
      proof_points: [],
    },
    current_marketing: {
      active_channels: [],
      current_activities: [],
      delivery_platforms: [],
      available_assets: [],
    },
    goals_and_constraints: {
      growth_goals: [],
      operational_constraints: [],
    },
  },
  uncertainties: [],
  readiness: {
    ready: false,
    llm_recommended: false,
    profile_readiness: 0,
    domain_scores: {
      identity: 0,
      offer: 0,
      customers: 0,
      differentiation: 0,
      current_marketing: 0,
      goals_and_constraints: 0,
      market_context: 0,
      research_confidence: 0,
      profile_readiness: 0,
    },
    blocking_domains: [],
    owner_turn_count: 0,
    max_owner_turns: 15,
  },
}

describe('useDiscoveryProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Socket-focused tests control events directly. Keep the initial status
    // request pending unless a test explicitly provides an HTTP response.
    vi.mocked(getDiscoveryStatus).mockImplementation(() => new Promise(() => {}))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('helper functions', () => {
    it('identifies active research states', () => {
      expect(isResearchActive('researching')).toBe(true)
      expect(isResearchActive('ready_for_chat')).toBe(false)
      expect(isResearchActive(null)).toBe(false)
    })

    it('identifies terminal states', () => {
      expect(isTerminal('failed')).toBe(true)
      expect(isTerminal('confirmed')).toBe(true)
      expect(isTerminal('in_progress')).toBe(false)
    })

    it('identifies when interview can be opened', () => {
      expect(canOpenInterview('ready_for_chat')).toBe(true)
      expect(canOpenInterview('partial_ready')).toBe(true)
      expect(canOpenInterview('research_failed')).toBe(true)
      expect(canOpenInterview('in_progress')).toBe(true)
      expect(canOpenInterview('researching')).toBe(false)
    })
  })

  describe('hook state machine', () => {
    it('hydrates from HTTP on mount', async () => {
      vi.mocked(getDiscoveryStatus).mockResolvedValueOnce({
        session_id: 'test',
        status: 'researching',
        language_mode: 'en',
        intake_summary: { business_name: 'test', business_type: 'test', city: 'test' },
        intelligence: { status: 'running', search_mode: 'metadata_only', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
        messages: [],
        profile_state: emptyProfileState,
        progress_events: [
          makeEvent(1, 'queued', 'complete', 'discovery.session.accepted'),
        ],
        strategy_locked: true,
      })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      // Wait for async hydrate
      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.sessionStatus).toBe('researching')
      expect(result.current.events).toHaveLength(1)
      expect(result.current.restoredFromStatus).toBe(true)
    })

    it('surfaces HTTP status failures as localized connection errors', async () => {
      vi.mocked(getDiscoveryStatus).mockRejectedValue({ status: 500, code: 'server_error', message: 'fail' })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.connectionError).toBe('Errors.networkError')
    })

    it('handles incoming socket events and deduplicates', async () => {
      let snapshotCallback: (events: unknown[]) => void = () => {}
      let progressCallback: (event: unknown) => void = () => {}

      mockSocketOn.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'discovery.progress.snapshot') snapshotCallback = cb
        if (event === 'discovery.progress') progressCallback = cb
      })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      // Simulate snapshot
      act(() => {
        snapshotCallback([
          makeEvent(1, 'queued', 'complete', 'discovery.session.accepted'),
        ])
      })

      expect(result.current.events).toHaveLength(1)

      // Simulate live event
      act(() => {
        progressCallback(
          makeEvent(2, 'metadata', 'progress', 'discovery.metadata.started'),
        )
      })

      expect(result.current.events).toHaveLength(2)

      // Simulate duplicate event (seq 2 again)
      act(() => {
        progressCallback(
          makeEvent(2, 'metadata', 'complete', 'discovery.metadata.completed'),
        )
      })

      // Still 2
      expect(result.current.events).toHaveLength(2)
    })

    it('updates research warning from progress event payload', async () => {
      let progressCallback: (event: unknown) => void = () => {}

      mockSocketOn.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'discovery.progress') progressCallback = cb
      })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      act(() => {
        progressCallback({
          ...makeEvent(1, 'ready', 'complete', 'discovery.ready_for_chat'),
          payload: { session_status: 'partial_ready' },
        })
      })

      expect(result.current.sessionStatus).toBe('partial_ready')
      expect(result.current.researchWarning).toBe('DiscoveryProgress.errorPartialResearch')
    })

    it('polls only while researching', async () => {
      vi.mocked(getDiscoveryStatus).mockResolvedValue({
        session_id: 'test',
        status: 'researching',
        language_mode: 'en',
        intake_summary: { business_name: 'test', business_type: 'test', city: 'test' },
        intelligence: { status: 'running', search_mode: 'metadata_only', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
        messages: [],
        profile_state: emptyProfileState,
        progress_events: [],
        strategy_locked: true,
      })

      renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      // Wait for async hydrate
      await act(async () => {
        await Promise.resolve()
      })

      // Initial load only
      expect(getDiscoveryStatus).toHaveBeenCalledTimes(1)

      // Fast forward one polling interval
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(getDiscoveryStatus).toHaveBeenCalledTimes(2)
    })

    it('stops polling once status leaves researching', async () => {
      vi.mocked(getDiscoveryStatus)
        .mockResolvedValueOnce({
          session_id: 'test',
          status: 'researching',
          language_mode: 'en',
          intake_summary: { business_name: 'test', business_type: 'test', city: 'test' },
          intelligence: { status: 'running', search_mode: 'metadata_only', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
          messages: [],
          profile_state: emptyProfileState,
          progress_events: [],
          strategy_locked: true,
        })
        .mockResolvedValueOnce({
          session_id: 'test',
          status: 'ready_for_chat',
          language_mode: 'en',
          intake_summary: { business_name: 'test', business_type: 'test', city: 'test' },
          intelligence: { status: 'complete', search_mode: 'free_search', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
          messages: [],
          profile_state: emptyProfileState,
          progress_events: [],
          strategy_locked: true,
        })

      renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      await act(async () => {
        await Promise.resolve()
      })

      // Initial load
      expect(getDiscoveryStatus).toHaveBeenCalledTimes(1)

      // Poll reaches ready_for_chat
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(getDiscoveryStatus).toHaveBeenCalledTimes(2)

      // No more polling
      await act(async () => {
        vi.advanceTimersByTime(4000)
      })

      expect(getDiscoveryStatus).toHaveBeenCalledTimes(2)
    })

    it('rehydrates from HTTP after socket reconnect', async () => {
      let reconnectCallback: () => void = () => {}

      mockIoOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'reconnect') reconnectCallback = cb
      })

      vi.mocked(getDiscoveryStatus).mockResolvedValue({
        session_id: 'test',
        status: 'researching',
        language_mode: 'en',
        intake_summary: { business_name: 'test', business_type: 'test', city: 'test' },
        intelligence: { status: 'running', search_mode: 'metadata_only', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
        messages: [],
        profile_state: emptyProfileState,
        progress_events: [],
        strategy_locked: true,
      })

      renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      await act(async () => {
        await Promise.resolve()
      })

      expect(getDiscoveryStatus).toHaveBeenCalledTimes(1)

      act(() => {
        reconnectCallback()
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(getDiscoveryStatus).toHaveBeenCalledTimes(2)
    })

    it('sets connection error on connect_error and reconnect_failed', async () => {
      let connectErrorCallback: (error?: Error & { data?: { status?: number } }) => Promise<void> | void = () => {}
      let reconnectFailedCallback: () => void = () => {}

      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'connect_error') connectErrorCallback = cb
      })
      mockIoOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'reconnect_failed') reconnectFailedCallback = cb
      })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      act(() => {
        connectErrorCallback()
      })

      expect(result.current.connectionState).toBe('failed')
      expect(result.current.connectionError).toBe('DiscoveryProgress.connectionFailed')

      act(() => {
        reconnectFailedCallback()
      })

      expect(result.current.connectionState).toBe('failed')
      expect(result.current.connectionError).toBe('DiscoveryProgress.connectionFailed')
    })

    it('refreshes once and reconnects when the socket rejects an expired token', async () => {
      let connectErrorCallback: (error?: Error & { data?: { status?: number } }) => Promise<void> | void = () => {}
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessToken: 'fresh-token' }), { status: 200 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      mockSocketOn.mockImplementation((event: string, cb: (error?: Error & { data?: { status?: number } }) => Promise<void> | void) => {
        if (event === 'connect_error') connectErrorCallback = cb
      })

      renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      await act(async () => {
        await connectErrorCallback(new Error('Authentication error'))
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3001/api/v1/auth/refresh',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      )
      expect(mockSocketConnect).toHaveBeenCalledTimes(1)
    })

    it('keeps research warning across disconnect', async () => {
      let disconnectCallback: () => void = () => {}

      mockSocketOn.mockImplementation((event: string, cb: () => void) => {
        if (event === 'disconnect') disconnectCallback = cb
      })

      vi.mocked(getDiscoveryStatus).mockResolvedValueOnce({
        session_id: 'test',
        status: 'partial_ready',
        language_mode: 'en',
        intake_summary: { business_name: 'test', business_type: 'test', city: 'test' },
        intelligence: { status: 'partial', search_mode: 'free_search', source_refs: [], research_observations: [], conversation_hooks: [], knowledge_gaps: [] },
        messages: [],
        profile_state: emptyProfileState,
        progress_events: [],
        strategy_locked: true,
      })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      await act(async () => {
        await Promise.resolve()
      })

      expect(result.current.researchWarning).toBe('DiscoveryProgress.errorPartialResearch')

      act(() => {
        disconnectCallback()
      })

      expect(result.current.connectionState).toBe('reconnecting')
      expect(result.current.researchWarning).toBe('DiscoveryProgress.errorPartialResearch')
    })
  })
})

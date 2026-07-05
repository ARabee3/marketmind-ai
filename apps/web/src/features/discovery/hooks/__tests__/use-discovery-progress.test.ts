/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: mockSocketOn,
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
  }),
}))

describe('useDiscoveryProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  
  afterEach(() => {
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
        profile_state: { known_facts: {} as any, uncertainties: [], readiness: {} as any },
        progress_events: [
          { type: 'progress', seq: 1, stage: 'queued', status: 'complete', message_key: '', message_text: '', payload: {}, created_at: '', session_id: 'test' }
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

    it('handles incoming socket events and deduplicates', async () => {
      let snapshotCallback: any
      let progressCallback: any
      
      mockSocketOn.mockImplementation((event: string, cb: any) => {
        if (event === 'discovery.progress.snapshot') snapshotCallback = cb
        if (event === 'discovery.progress') progressCallback = cb
      })

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      // Simulate snapshot
      act(() => {
        snapshotCallback([
          { type: 'progress', seq: 1, stage: 'queued', status: 'complete', message_key: '', message_text: '', payload: {}, created_at: '', session_id: 'test' }
        ])
      })

      expect(result.current.events).toHaveLength(1)

      // Simulate live event
      act(() => {
        progressCallback(
          { type: 'progress', seq: 2, stage: 'metadata', status: 'progress', message_key: '', message_text: '', payload: {}, created_at: '', session_id: 'test' }
        )
      })

      expect(result.current.events).toHaveLength(2)
      
      // Simulate duplicate event (seq 2 again)
      act(() => {
        progressCallback(
          { type: 'progress', seq: 2, stage: 'metadata', status: 'complete', message_key: '', message_text: '', payload: {}, created_at: '', session_id: 'test' }
        )
      })

      // Still 2
      expect(result.current.events).toHaveLength(2)
    })
    
    it('polls only when disconnected and active', async () => {
      let disconnectCallback: any
      mockSocketOn.mockImplementation((event: string, cb: any) => {
        if (event === 'disconnect') disconnectCallback = cb
      })

      vi.mocked(getDiscoveryStatus).mockResolvedValue({
        status: 'researching',
        progress_events: [],
      } as any)

      const { result } = renderHook(() => useDiscoveryProgress({ sessionId: 'test' }))

      // Wait for async hydrate
      await act(async () => {
        await Promise.resolve()
      })

      // Initially loads status once
      expect(getDiscoveryStatus).toHaveBeenCalledTimes(1)

      // Simulate disconnect
      act(() => {
        disconnectCallback()
      })

      // Fast forward polling interval
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(getDiscoveryStatus).toHaveBeenCalledTimes(2)
    })
  })
})

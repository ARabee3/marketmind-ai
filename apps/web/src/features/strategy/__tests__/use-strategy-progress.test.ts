import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useStrategyProgress, isActiveStatus, isTerminalStatus } from '../hooks/use-strategy-progress'
import { setAccessToken } from '@/lib/api/token-store'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(null)
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  vi.useRealTimers()
})

describe('isActiveStatus / isTerminalStatus', () => {
  it('identifies active statuses', () => {
    expect(isActiveStatus('generating')).toBe(true)
    expect(isActiveStatus('retrieving')).toBe(true)
    expect(isActiveStatus('queued')).toBe(true)
    expect(isActiveStatus('validating')).toBe(true)
    expect(isActiveStatus('draft')).toBe(false)
    expect(isActiveStatus('approved')).toBe(false)
    expect(isActiveStatus('failed')).toBe(false)
  })

  it('identifies terminal statuses', () => {
    expect(isTerminalStatus('draft')).toBe(true)
    expect(isTerminalStatus('approved')).toBe(true)
    expect(isTerminalStatus('rejected')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('generating')).toBe(false)
    expect(isTerminalStatus('needs_brief')).toBe(false)
  })
})

describe('useStrategyProgress', () => {
  it('returns null status when strategyId is null', () => {
    const { result } = renderHook(() => useStrategyProgress(null))

    expect(result.current.status).toBeNull()
    expect(result.current.progress).toEqual([])
    expect(result.current.isActive).toBe(false)
    expect(result.current.isTerminal).toBe(false)
  })

  it('loads status and persisted events on mount', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'strat-1', status: 'generating' }), { status: 200 }),
    ).mockResolvedValueOnce(
      new Response(JSON.stringify([
        {
          type: 'strategy_progress',
          strategy_id: 'strat-1',
          seq: 1,
          stage: 'retrieval',
          status: 'complete',
          message_key: 'strategy.retrieval.complete',
          message_text: 'Knowledge retrieval complete.',
          payload: {},
          created_at: '2026-07-28T10:00:00.000Z',
        },
      ]), { status: 200 }),
    )

    const { result } = renderHook(() => useStrategyProgress('strat-1'))

    await waitFor(() => expect(result.current.status).toBe('generating'))

    expect(result.current.progress).toHaveLength(1)
    expect(result.current.progress[0]?.stage).toBe('retrieval')
    expect(result.current.isActive).toBe(true)
    expect(result.current.isTerminal).toBe(false)
  })

  it('stops polling on terminal status', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'strat-1', status: 'draft' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))

    renderHook(() => useStrategyProgress('strat-1'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

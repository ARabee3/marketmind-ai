import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { StrategyProgressEvent } from '@marketmind/contracts'
import { useStrategyProgress } from '../hooks/use-strategy-progress'
import { getStrategy, getStrategyProgress } from '@/lib/api/strategy'
import { refreshAccessToken } from '@/lib/api/client'

vi.mock('@/lib/api/strategy', () => ({
  getStrategy: vi.fn(),
  getStrategyProgress: vi.fn(),
}))

vi.mock('@/lib/api/client', () => ({
  refreshAccessToken: vi.fn(),
}))

const mockSocketOn = vi.fn()
const mockSocketEmit = vi.fn()
const mockSocketDisconnect = vi.fn()
const mockSocketConnect = vi.fn()
const mockManagerOn = vi.fn()

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: mockSocketOn,
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
    connect: mockSocketConnect,
    io: { on: mockManagerOn },
  }),
}))

const getStrategyMock = vi.mocked(getStrategy)
const getStrategyProgressMock = vi.mocked(getStrategyProgress)
const refreshAccessTokenMock = vi.mocked(refreshAccessToken)

function makeEvent(
  seq: number,
  status: StrategyProgressEvent['status'] = 'progress',
): StrategyProgressEvent {
  return {
    type: 'strategy_progress',
    strategy_id: 'strategy-1',
    seq,
    stage: 'generating',
    status,
    message_key: `strategy.progress.${seq}`,
    message_text: `Progress ${seq}`,
    payload: {},
    created_at: '2026-08-01T10:00:00.000Z',
  }
}

describe('useStrategyProgress realtime delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    getStrategyMock.mockResolvedValue({ status: 'generating' } as never)
    getStrategyProgressMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('joins the strategy room and merges snapshots/live events by seq', async () => {
    let connectCallback: (() => void) | undefined
    let snapshotCallback:
      | ((events: StrategyProgressEvent[]) => void)
      | undefined
    let progressCallback: ((event: StrategyProgressEvent) => void) | undefined

    mockSocketOn.mockImplementation((event: string, callback: unknown) => {
      if (event === 'connect') connectCallback = callback as () => void
      if (event === 'strategy.progress.snapshot') {
        snapshotCallback = callback as (events: StrategyProgressEvent[]) => void
      }
      if (event === 'strategy.progress') {
        progressCallback = callback as (event: StrategyProgressEvent) => void
      }
    })

    const { result } = renderHook(() => useStrategyProgress('strategy-1'))

    await waitFor(() => expect(result.current.status).toBe('generating'))

    act(() => {
      connectCallback?.()
      snapshotCallback?.([makeEvent(2), makeEvent(1, 'complete')])
      progressCallback?.(makeEvent(3))
      progressCallback?.(makeEvent(2, 'complete'))
    })

    expect(mockSocketEmit).toHaveBeenCalledWith('strategy.join', {
      strategy_id: 'strategy-1',
    })
    expect(result.current.progress.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(
      result.current.progress.find((event) => event.seq === 2)?.status,
    ).toBe('progress')
    expect(result.current.connectionState).toBe('connected')
  })

  it('rehydrates status and events after reconnect', async () => {
    let reconnectCallback: (() => void) | undefined
    mockManagerOn.mockImplementation((event: string, callback: () => void) => {
      if (event === 'reconnect') reconnectCallback = callback
    })
    getStrategyProgressMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeEvent(4, 'complete')])

    renderHook(() => useStrategyProgress('strategy-1'))
    await waitFor(() => expect(getStrategyMock).toHaveBeenCalledTimes(1))

    act(() => reconnectCallback?.())

    await waitFor(() => expect(getStrategyMock).toHaveBeenCalledTimes(2))
    expect(getStrategyProgressMock).toHaveBeenCalledTimes(2)
  })

  it('optimistically enters an active phase when a live run starts', async () => {
    let progressCallback: ((event: StrategyProgressEvent) => void) | undefined
    getStrategyMock.mockResolvedValue({ status: 'ready' } as never)
    mockSocketOn.mockImplementation((event: string, callback: unknown) => {
      if (event === 'strategy.progress') {
        progressCallback = callback as (event: StrategyProgressEvent) => void
      }
    })

    const { result } = renderHook(() => useStrategyProgress('strategy-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() =>
      progressCallback?.({
        ...makeEvent(1),
        stage: 'retrieval',
        status: 'started',
      }),
    )

    expect(result.current.status).toBe('retrieving')
    expect(result.current.isActive).toBe(true)
  })

  it('refreshes once and reconnects when the socket rejects the access token', async () => {
    let connectErrorCallback:
      | ((error: Error & { data?: { status?: number } }) => Promise<void>)
      | undefined
    mockSocketOn.mockImplementation((event: string, callback: unknown) => {
      if (event === 'connect_error') {
        connectErrorCallback = callback as typeof connectErrorCallback
      }
    })
    refreshAccessTokenMock.mockResolvedValue('fresh-token')

    renderHook(() => useStrategyProgress('strategy-1'))

    await act(async () => {
      await connectErrorCallback?.(new Error('Authentication error'))
    })

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1)
    expect(mockSocketConnect).toHaveBeenCalledTimes(1)
  })

  it('uses status polling only while the strategy is active', async () => {
    vi.useFakeTimers()
    getStrategyMock
      .mockResolvedValueOnce({ status: 'generating' } as never)
      .mockResolvedValueOnce({ status: 'draft' } as never)

    renderHook(() => useStrategyProgress('strategy-1'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getStrategyMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(getStrategyMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(getStrategyMock).toHaveBeenCalledTimes(2)
    expect(getStrategyProgressMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the strategy room when unmounted', () => {
    const { unmount } = renderHook(() => useStrategyProgress('strategy-1'))

    unmount()

    expect(mockSocketEmit).toHaveBeenCalledWith('strategy.leave', {
      strategy_id: 'strategy-1',
    })
    expect(mockSocketDisconnect).toHaveBeenCalledTimes(1)
  })
})

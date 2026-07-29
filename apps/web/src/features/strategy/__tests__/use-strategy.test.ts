import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useStrategy } from '../hooks/use-strategy'
import { setAccessToken } from '@/lib/api/token-store'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

const mockStrategy = {
  id: 'strat-1',
  businessId: 'biz-1',
  status: 'draft',
  ownerUserId: 'user-1',
  currentVersionId: 'ver-1',
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
  brief: {
    id: 'brief-1',
    strategyId: 'strat-1',
    businessProfileVersionId: 'profile-1',
    primaryObjective: 'awareness',
    startDate: '2026-08-01T00:00:00.000Z',
    planLanguage: 'ar-EG',
    paidMediaAllowed: false,
    externalBudgetMode: 'organic_only',
    externalBudgetEgp: null,
    teamCapacity: 'Owner only',
    constraints: null,
    clarificationAnswers: null,
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-28T10:00:00.000Z',
  },
}

describe('useStrategy', () => {
  it('loads strategy on mount and returns data', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockStrategy), { status: 200 }),
    )

    const { result } = renderHook(() => useStrategy('strat-1'))

    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.strategy?.id).toBe('strat-1')
    expect(result.current.strategy?.status).toBe('draft')
    expect(result.current.error).toBeNull()
  })

  it('returns null strategy when strategyId is null', () => {
    const { result } = renderHook(() => useStrategy(null))

    expect(result.current.loading).toBe(false)
    expect(result.current.strategy).toBeNull()
  })

  it('sets error when API call fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Strategy not found' }), {
        status: 404,
      }),
    )

    const { result } = renderHook(() => useStrategy('strat-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Strategy not found')
    expect(result.current.strategy).toBeNull()
  })

  it('refresh reloads data', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...mockStrategy, status: 'needs_brief' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...mockStrategy, status: 'draft' }), { status: 200 }),
      )

    const { result } = renderHook(() => useStrategy('strat-1'))

    await waitFor(() => expect(result.current.strategy?.status).toBe('needs_brief'))

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => expect(result.current.strategy?.status).toBe('draft'))
  })
})

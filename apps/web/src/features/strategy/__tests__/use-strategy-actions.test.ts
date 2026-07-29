import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStrategyActions } from '../hooks/use-strategy-actions'
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
  status: 'needs_brief',
  ownerUserId: 'user-1',
  currentVersionId: null,
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
  brief: null,
}

describe('useStrategyActions', () => {
  it('create sends POST /strategies and returns strategy', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockStrategy), { status: 201 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const strategy = await result.current.create('biz-1')

    expect(strategy?.id).toBe('strat-1')
    expect(strategy?.status).toBe('needs_brief')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies')
    expect(init.method).toBe('POST')
  })

  it('saveBrief sends PUT /strategies/:id/brief', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'brief-1' }), { status: 200 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const brief = await result.current.saveBrief('strat-1', {
      businessProfileVersionId: 'profile-1',
      primaryObjective: 'awareness',
      startDate: '2026-08-01T00:00:00.000Z',
      planLanguage: 'ar-EG',
      paidMediaAllowed: false,
      externalBudgetMode: 'organic_only',
      teamCapacity: 'Owner only',
    })

    expect(brief?.id).toBe('brief-1')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/brief')
    expect(init.method).toBe('PUT')
  })

  it('generate sends POST /strategies/:id/generate', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'queued', correlationId: 'corr-1' }), { status: 202 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const res = await result.current.generate('strat-1')

    expect(res?.status).toBe('queued')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/generate')
    expect(init.method).toBe('POST')
  })

  it('decide sends POST /strategies/:id/decisions', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ decision: { id: 'dec-1' }, nextStatus: 'approved' }), { status: 200 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const res = await result.current.decide('strat-1', { versionId: 'ver-1', action: 'approve' })

    expect(res?.nextStatus).toBe('approved')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/decisions')
    expect(init.method).toBe('POST')
  })

  it('retry sends POST /strategies/:id/retry', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'queued' }), { status: 200 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const res = await result.current.retry('strat-1')

    expect(res?.status).toBe('queued')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/retry')
    expect(init.method).toBe('POST')
  })

  it('prevents duplicate concurrent actions', async () => {
    fetchMock.mockResolvedValue(
      new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(mockStrategy), { status: 201 })), 100)),
    )

    const { result } = renderHook(() => useStrategyActions())

    const [first, second] = await Promise.all([
      result.current.create('biz-1'),
      result.current.create('biz-1'),
    ])

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

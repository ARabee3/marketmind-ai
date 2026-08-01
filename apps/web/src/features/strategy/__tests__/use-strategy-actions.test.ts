import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useStrategyActions } from '../hooks/use-strategy-actions'
import { setAccessToken } from '@/lib/api/token-store'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

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

async function runAction<T>(action: () => Promise<T>): Promise<T> {
  let value: T | undefined
  await act(async () => {
    value = await action()
  })
  if (value === undefined) {
    throw new Error('Action did not resolve')
  }
  return value
}

describe('useStrategyActions', () => {
  it('create sends POST /strategies and returns strategy', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockStrategy), { status: 201 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const strategy = await runAction(() => result.current.create('profile-1'))

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

    const brief = await runAction(() => result.current.saveBrief('strat-1', {
      businessProfileVersionId: 'profile-1',
      primaryObjective: 'awareness',
      startDate: '2026-08-01T00:00:00.000Z',
      planLanguage: 'ar-EG',
      paidMediaAllowed: false,
      externalBudgetMode: 'organic_only',
      teamCapacity: 'Owner only',
    }))

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

    const res = await runAction(() => result.current.generate('strat-1'))

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

    const res = await runAction(() => result.current.decide('strat-1', { versionId: 'ver-1', action: 'approve' }))

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

    const res = await runAction(() => result.current.retry('strat-1'))

    expect(res?.status).toBe('queued')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/retry')
    expect(init.method).toBe('POST')
  })

  it('localizes a stale-version conflict with a specific recovery message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        code: 'STRATEGY_VERSION_CONFLICT',
        message: 'raw server conflict copy',
      }), { status: 409 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const response = await runAction(() => result.current.decide('strat-1', {
      versionId: 'ver-1',
      action: 'approve',
    }))

    expect(response).toBeNull()
    expect(result.current.error).toBe('strategyVersionConflict')
    expect(result.current.error).not.toContain('raw server')
  })

  it('never exposes unexpected server internals', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        code: 'PRISMA_BOOM',
        message: 'Invalid prisma.strategyBrief.upsert invocation',
      }), { status: 500 }),
    )

    const { result } = renderHook(() => useStrategyActions())

    const response = await runAction(() => result.current.generate('strat-1'))

    expect(response).toBeNull()
    expect(result.current.error).toBe('serverError')
    expect(result.current.error).not.toContain('prisma')
  })

  it('prevents duplicate concurrent actions', async () => {
    fetchMock.mockResolvedValue(
      new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(mockStrategy), { status: 201 })), 100)),
    )

    const { result } = renderHook(() => useStrategyActions())

    const [first, second] = await runAction(() => Promise.all([
        result.current.create('profile-1'),
        result.current.create('profile-1'),
      ]))

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

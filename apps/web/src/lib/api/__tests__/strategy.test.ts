import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAccessToken } from '../token-store'
import {
  createStrategy,
  upsertBrief,
  generateStrategy,
  getStrategy,
  getStrategyVersion,
  getStrategyProgress,
  submitDecision,
  retryStrategy,
} from '../strategy'

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

const mockStrategyResponse = {
  id: 'strat-1',
  businessId: 'biz-1',
  status: 'needs_brief',
  ownerUserId: 'user-1',
  currentVersionId: null,
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
  brief: null,
}

describe('Strategy API client', () => {
  it('createStrategy POSTs to /strategies with businessProfileVersionId', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockStrategyResponse), { status: 201 }),
    )

    const result = await createStrategy('profile-1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ businessProfileVersionId: 'profile-1' })
    expect(result.status).toBe('needs_brief')
  })

  it('upsertBrief PUTs to /strategies/:id/brief with camelCase payload', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...mockStrategyResponse, status: 'ready' }), { status: 200 }),
    )

    await upsertBrief('strat-1', {
      businessProfileVersionId: 'profile-1',
      primaryObjective: 'awareness',
      startDate: '2026-08-01T00:00:00.000Z',
      planLanguage: 'ar-EG',
      paidMediaAllowed: false,
      externalBudgetMode: 'organic_only',
      teamCapacity: 'Owner only',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/brief')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body as string)
    expect(body.businessProfileVersionId).toBe('profile-1')
    expect(body.primaryObjective).toBe('awareness')
    expect(body.paidMediaAllowed).toBe(false)
    expect(body.planLanguage).toBe('ar-EG')
  })

  it('generateStrategy POSTs to /strategies/:id/generate', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'queued', correlationId: 'corr-1' }), { status: 202 }),
    )

    const result = await generateStrategy('strat-1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/generate')
    expect(init.method).toBe('POST')
    expect(result.status).toBe('queued')
    expect(result.correlationId).toBe('corr-1')
  })

  it('getStrategy GETs /strategies/:id', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockStrategyResponse), { status: 200 }),
    )

    const result = await getStrategy('strat-1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1')
    expect(result.id).toBe('strat-1')
  })

  it('getStrategyVersion GETs /strategies/:id/versions/:version', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'plan-1', version: 1 }), { status: 200 }),
    )

    const result = await getStrategyVersion('strat-1', 1)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/versions/1')
    expect(result.version).toBe(1)
  })

  it('getStrategyProgress GETs /strategies/:id/progress', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([{ seq: 1, stage: 'retrieval' }]), { status: 200 }),
    )

    const result = await getStrategyProgress('strat-1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/progress')
    expect(result[0]?.stage).toBe('retrieval')
  })

  it('submitDecision POSTs to /strategies/:id/decisions with action payload', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ decision: { id: 'dec-1' }, nextStatus: 'approved' }), { status: 200 }),
    )

    const result = await submitDecision('strat-1', {
      versionId: 'ver-1',
      action: 'approve',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/decisions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.versionId).toBe('ver-1')
    expect(body.action).toBe('approve')
    expect(result.nextStatus).toBe('approved')
  })

  it('retryStrategy POSTs to /strategies/:id/retry', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'queued' }), { status: 200 }),
    )

    const result = await retryStrategy('strat-1')

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/strategies/strat-1/retry')
    expect(init.method).toBe('POST')
    expect(result.status).toBe('queued')
  })

  it('throws ApiError on non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'STRATEGY_NOT_FOUND', message: 'Strategy not found' }), {
        status: 404,
        statusText: 'Not Found',
      }),
    )

    await expect(getStrategy('strat-1')).rejects.toEqual({
      status: 404,
      code: 'STRATEGY_NOT_FOUND',
      message: 'Strategy not found',
    })
  })
})

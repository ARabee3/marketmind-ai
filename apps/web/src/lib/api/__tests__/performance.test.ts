import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PerformanceOverviewV1 } from '@marketmind/contracts'
import { apiRequest } from '../client'
import {
  getPerformanceOverview,
  refreshPerformancePost,
} from '../performance'

vi.mock('../client', () => ({
  apiRequest: vi.fn(),
}))

const mockedApiRequest = vi.mocked(apiRequest)

const OVERVIEW: PerformanceOverviewV1 = {
  contract_version: 'performance-v1',
  business_id: 'a1000000-0000-4000-8000-000000000001',
  provider: 'facebook',
  generated_at: '2026-08-18T12:00:00.000Z',
  posts: [],
  baseline: {
    status: 'not_ready',
    observed_snapshot_count: 0,
    required_snapshot_count: 3,
    reason: 'no_published_posts',
  },
  capability: {
    status: 'blocked',
    blockers: ['no_facebook_connection'],
    last_successful_sync: null,
  },
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('performance API adapter', () => {
  afterEach(() => vi.clearAllMocks())

  it('validates and returns the frozen overview contract', async () => {
    mockedApiRequest.mockResolvedValue(response(OVERVIEW))

    await expect(getPerformanceOverview()).resolves.toEqual(OVERVIEW)
    expect(mockedApiRequest).toHaveBeenCalledWith('/performance/facebook/overview', undefined)
  })

  it('fails closed when the API returns a malformed overview', async () => {
    mockedApiRequest.mockResolvedValue(response({ ...OVERVIEW, provider: 'instagram' }))

    await expect(getPerformanceOverview()).rejects.toThrow()
  })

  it('keeps API status and code available for safe retry messaging', async () => {
    mockedApiRequest.mockResolvedValue(
      response({ code: 'PERFORMANCE_PROVIDER_RATE_LIMITED', message: 'wait' }, 429),
    )

    await expect(
      refreshPerformancePost('a1000000-0000-4000-8000-000000000003'),
    ).rejects.toMatchObject({
      status: 429,
      code: 'PERFORMANCE_PROVIDER_RATE_LIMITED',
    })
  })
})

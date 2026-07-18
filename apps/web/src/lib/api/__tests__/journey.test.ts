// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentJourney } from '../journey'
import { setAccessToken } from '../token-store'

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

describe('Journey API client', () => {
  it('loads the current journey through the authenticated API client', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          owner: {
            user_id: 'owner-id',
            full_name: 'Ahmed Hassan',
            email: 'owner@example.com',
            email_verified: true,
          },
          journey: { state: 'no_journey', discovery: null, profile: null },
          future_phase: {
            phase: 'strategy',
            availability: 'locked',
            status: 'needs_brief',
            reason: 'discovery_required',
            destination: null,
          },
          primary_action: {
            type: 'start_discovery',
            destination: '/discovery/new',
          },
          generated_at: '2026-07-17T10:00:00.000Z',
        }),
        { status: 200 },
      ),
    )

    const response = await getCurrentJourney()

    expect(response.primary_action.type).toBe('start_discovery')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/journey/current')
    expect(init.credentials).toBe('include')
  })

  it('throws a stable API error when the journey endpoint fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Could not load journey' },
        }),
        { status: 500, statusText: 'Server error' },
      ),
    )

    await expect(getCurrentJourney()).rejects.toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Could not load journey',
    })
  })
})

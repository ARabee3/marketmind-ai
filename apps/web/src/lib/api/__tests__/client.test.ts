import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../client'
import { setAccessToken } from '../token-store'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(null)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  // Ensure any in-flight refresh promise has settled before the next test.
  await Promise.resolve()
})

describe('apiRequest', () => {
  it('sends credentials and JSON content type by default', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    await apiRequest('/test', { method: 'POST', body: { value: 1 } })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(init.headers.get('Content-Type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ value: 1 }))
  })

  it('adds the Authorization header when an access token exists', async () => {
    setAccessToken('token-123')
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    await apiRequest('/test')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.get('Authorization')).toBe('Bearer token-123')
  })

  it('retries a 401 request once after refreshing the token', async () => {
    setAccessToken('expired')

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'fresh' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )

    const response = await apiRequest('/test')

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    const [, retryInit] = fetchMock.mock.calls[2]
    expect(retryInit.headers.get('Authorization')).toBe('Bearer fresh')
  })

  it('returns the original 401 response when refresh fails', async () => {
    setAccessToken('expired')

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 }),
      )

    const response = await apiRequest('/test')

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry non-401 errors', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Server error' }), { status: 500 }),
    )

    const response = await apiRequest('/test')

    expect(response.status).toBe(500)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('triggers exactly one refresh for concurrent 401 requests', async () => {
    setAccessToken('expired')

    let refreshCount = 0
    fetchMock.mockImplementation(async (url: string | Request | URL) => {
      const path = typeof url === 'string' ? url : url.toString()

      if (path.includes('/auth/refresh')) {
        refreshCount += 1
        // Simulate a slow refresh so concurrent requests queue up.
        await new Promise((resolve) => setTimeout(resolve, 50))
        return new Response(JSON.stringify({ accessToken: 'fresh' }), {
          status: 200,
        })
      }

      // First call for each endpoint returns 401; retry returns 200.
      const callIndex = fetchMock.mock.calls.length
      if (callIndex <= 2) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    const [first, second] = await Promise.all([
      apiRequest('/first'),
      apiRequest('/second'),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(refreshCount).toBe(1)
  })

  it('does not infinite-loop when the retry also returns 401', async () => {
    setAccessToken('expired')

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'fresh' }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      )

    const response = await apiRequest('/test')

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

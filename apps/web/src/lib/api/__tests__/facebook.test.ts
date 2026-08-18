import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiRequest } from '../client'
import { getFacebookConnection } from '../facebook'

vi.mock('../client', () => ({
  apiRequest: vi.fn(),
}))

const mockedApiRequest = vi.mocked(apiRequest)

const CONNECTED = {
  provider: 'facebook',
  pageName: 'Koshary Corner',
  isValid: true,
  connectedAt: '2026-08-01T12:00:00.000Z',
  lastTestedAt: null,
  expiresAt: null,
}

describe('Facebook connection API adapter', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('treats a successful empty response as a disconnected connection', async () => {
    mockedApiRequest.mockResolvedValue(new Response(null, { status: 200 }))

    await expect(getFacebookConnection()).resolves.toBeNull()
  })

  it('keeps a JSON connection response intact', async () => {
    mockedApiRequest.mockResolvedValue(
      new Response(JSON.stringify(CONNECTED), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(getFacebookConnection()).resolves.toEqual(CONNECTED)
  })

  it('treats no-content responses as a disconnected connection', async () => {
    mockedApiRequest.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(getFacebookConnection()).resolves.toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDiscoveryStream } from '../discovery'
import { setAccessToken } from '../token-store'

const fetchMock = vi.fn()

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setAccessToken(null)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  setAccessToken(null)
  await Promise.resolve()
})

describe('connectDiscoveryStream', () => {
  it('sends the access token in the Authorization header and parses chunked SSE events', async () => {
    setAccessToken('access-token')
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        'data: {"type":"thinking","session_id":"session-1"}\n',
        '\ndata: {"type":"token","session_id":"session-1","delta":"أهلاً"}\n\n',
      ]),
    )
    const onEvent = vi.fn()

    const cleanup = connectDiscoveryStream('session-1', onEvent)

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3001/api/v1/discovery/session-1/stream')
    expect(url).not.toContain('token=')
    expect(init.credentials).toBe('include')
    expect(init.headers.get('Authorization')).toBe('Bearer access-token')
    expect(init.headers.get('Accept')).toBe('text/event-stream')
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'thinking',
      session_id: 'session-1',
    })
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'token',
      session_id: 'session-1',
      delta: 'أهلاً',
    })

    cleanup()
  })

  it('uses the refreshed access token after a stream 401', async () => {
    setAccessToken('expired-token')
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'fresh-token' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        streamResponse(['data: {"type":"done","session_id":"session-1"}\n\n']),
      )
    const onEvent = vi.fn()

    const cleanup = connectDiscoveryStream('session-1', onEvent)

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [firstUrl, firstInit] = fetchMock.mock.calls[0]
    const [refreshUrl] = fetchMock.mock.calls[1]
    const [retryUrl, retryInit] = fetchMock.mock.calls[2]
    expect(firstUrl).not.toContain('token=')
    expect(firstInit.headers.get('Authorization')).toBe('Bearer expired-token')
    expect(refreshUrl).toBe('http://localhost:3001/api/v1/auth/refresh')
    expect(retryUrl).not.toContain('token=')
    expect(retryInit.headers.get('Authorization')).toBe('Bearer fresh-token')

    cleanup()
  })
})

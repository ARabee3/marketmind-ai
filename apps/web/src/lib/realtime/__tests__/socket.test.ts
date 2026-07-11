import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type MockSocket = {
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function createMockSocket(): MockSocket {
  return {
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
}

let activeSocket = createMockSocket()

const io = vi.fn(() => {
  activeSocket = createMockSocket()
  return activeSocket
})

vi.mock('socket.io-client', () => ({
  io,
}))

const getAccessToken = vi.fn()
const setAccessToken = vi.fn()
const refreshAccessToken = vi.fn()

vi.mock('@/lib/api/token-store', () => ({
  getAccessToken: () => getAccessToken(),
  setAccessToken: (token: string | null) => setAccessToken(token),
}))

vi.mock('@/lib/api/client', () => ({
  refreshAccessToken: () => refreshAccessToken(),
}))

function findConnectErrorHandler():
  | ((error: Error & { data?: { status?: number } }) => void)
  | undefined {
  const call = (activeSocket.on.mock.calls as unknown[][]).find(
    (args) => args[0] === 'connect_error',
  )
  return call?.[1] as ((error: Error & { data?: { status?: number } }) => void) | undefined
}

function createError(message: string, status?: number): Error & { data?: { status?: number } } {
  const error = new Error(message)
  if (status !== undefined) {
    Object.assign(error, { data: { status } })
  }
  return error as Error & { data?: { status?: number } }
}

describe('socket manager', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    activeSocket = createMockSocket()
    getAccessToken.mockReturnValue('initial-token')
    refreshAccessToken.mockResolvedValue('refreshed-token')
  })

  afterEach(async () => {
    const { disconnectSocket } = await import('../socket')
    disconnectSocket()
  })

  it('creates a singleton socket instance', async () => {
    const { getSocket } = await import('../socket')
    const first = getSocket()
    const second = getSocket()
    expect(first).toBe(second)
    expect(io).toHaveBeenCalledTimes(1)
  })

  it('passes the current access token via the auth callback', async () => {
    const { getSocket } = await import('../socket')
    getSocket()
    expect(io).toHaveBeenCalledTimes(1)

    const options = (io.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(typeof options.auth).toBe('function')

    const cb = vi.fn()
    ;(options.auth as (cb: (payload: { token: string | null }) => void) => void)(cb)
    expect(cb).toHaveBeenCalledWith({ token: 'initial-token' })
  })

  it('re-reads the latest access token on each connection/reconnection attempt', async () => {
    const { getSocket } = await import('../socket')
    getSocket()
    const options = (io.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    const auth = options.auth as (cb: (payload: { token: string | null }) => void) => void

    const first = vi.fn()
    auth(first)
    expect(first).toHaveBeenCalledWith({ token: 'initial-token' })

    getAccessToken.mockReturnValue('rotated-token')

    const second = vi.fn()
    auth(second)
    expect(second).toHaveBeenCalledWith({ token: 'rotated-token' })
  })

  it('refreshes the token and reconnects on 401 connect_error', async () => {
    const { getSocket } = await import('../socket')
    getSocket()
    const handler = findConnectErrorHandler()
    expect(handler).toBeDefined()

    await handler?.(createError('Authentication error', 401))

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(activeSocket.connect).toHaveBeenCalledTimes(1)
  })

  it('does not refresh on non-auth connect_error', async () => {
    const { getSocket } = await import('../socket')
    getSocket()
    const handler = findConnectErrorHandler()

    await handler?.(createError('Network error', 500))

    expect(refreshAccessToken).not.toHaveBeenCalled()
    expect(activeSocket.connect).not.toHaveBeenCalled()
  })

  it('does not reconnect when refresh fails on a 401 connect_error', async () => {
    refreshAccessToken.mockResolvedValueOnce(null)

    const { getSocket } = await import('../socket')
    getSocket()
    const handler = findConnectErrorHandler()

    await handler?.(createError('Authentication error', 401))

    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(activeSocket.connect).not.toHaveBeenCalled()
  })

  it('disconnects and clears the singleton', async () => {
    const { getSocket, disconnectSocket } = await import('../socket')
    const first = getSocket()
    disconnectSocket()
    expect(activeSocket.disconnect).toHaveBeenCalledTimes(1)

    const second = getSocket()
    expect(second).not.toBe(first)
    expect(io).toHaveBeenCalledTimes(2)
  })

  it('clears the token and disconnects on resetSocketAuth', async () => {
    const { getSocket, resetSocketAuth } = await import('../socket')
    getSocket()
    resetSocketAuth()
    expect(setAccessToken).toHaveBeenCalledWith(null)
    expect(activeSocket.disconnect).toHaveBeenCalledTimes(1)
  })
})

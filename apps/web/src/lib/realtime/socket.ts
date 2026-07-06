'use client'

import { io, type Socket, type ManagerOptions, type SocketOptions } from 'socket.io-client'
import { getAccessToken, setAccessToken } from '@/lib/api/token-store'
import { refreshAccessToken } from '@/lib/api/client'

export type SocketAuthPayload = { token: string | null }

export type SocketClient = Socket

export type SocketConnectionOptions = Partial<ManagerOptions & SocketOptions>

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL ?? ''

let socket: SocketClient | null = null
let connectionOptions: SocketConnectionOptions | undefined

/**
 * Returns the shared Socket.IO client instance, creating it if necessary.
 *
 * The socket is configured to:
 * - Send the current in-memory access token during the handshake.
 * - Include cookies (HttpOnly refresh token) via `withCredentials`.
 * - Re-read the access token on every connection/reconnection attempt.
 * - Attempt a single token refresh on 401 handshake errors, then reconnect.
 */
export function getSocket(): SocketClient {
  if (socket) return socket
  return createSocket(connectionOptions)
}

/**
 * Replaces the active socket with a new instance using the supplied options.
 * Disconnects any existing socket first. Useful for tests or runtime reconfiguration.
 */
export function configureSocket(options: SocketConnectionOptions): SocketClient {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  connectionOptions = options
  return getSocket()
}

/**
 * Disconnects the shared socket and clears the singleton so the next call to
 * `getSocket()` creates a fresh connection.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

function createSocket(options?: SocketConnectionOptions): SocketClient {
  socket = io(SOCKET_URL, {
    withCredentials: true,
    autoConnect: true,
    auth: (cb: (payload: SocketAuthPayload) => void) => {
      cb({ token: getAccessToken() })
    },
    ...options,
  })

  socket.on('connect_error', handleConnectError)

  return socket
}

async function handleConnectError(
  error: Error & { data?: { status?: number } },
): Promise<void> {
  const activeSocket = socket
  if (!activeSocket) return

  const isAuthError =
    error.message === 'Authentication error' || error.data?.status === 401
  if (!isAuthError) return

  const token = await refreshAccessToken()
  if (token && activeSocket === socket) {
    activeSocket.connect()
  }
}

/**
 * Clears the stored access token and disconnects the socket.
 *
 * Call this after logout to ensure the realtime connection cannot be reused.
 */
export function resetSocketAuth(): void {
  setAccessToken(null)
  disconnectSocket()
}

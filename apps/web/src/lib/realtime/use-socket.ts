'use client'

import { useState } from 'react'
import { getSocket, type SocketClient } from './socket'

/**
 * React hook that returns the shared Socket.IO client.
 *
 * The hook only accesses the socket singleton; it does not disconnect on
 * unmount so that multiple components can share one connection.
 */
export function useSocket(): SocketClient {
  const [client] = useState<SocketClient>(() => getSocket())
  return client
}

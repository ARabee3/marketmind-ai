'use client'

import { useEffect } from 'react'
import { useSocket } from './use-socket'

/**
 * Subscribes to a Socket.IO event and cleans up on unmount or dependency change.
 *
 * The handler is wrapped so the latest closure is always used without
 * re-attaching the listener on every render.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const socket = useSocket()

  useEffect(() => {
    if (!socket) return

    const listener = (data: T): void => handler(data)
    socket.on(event, listener as (...args: unknown[]) => void)

    return () => {
      socket.off(event, listener as (...args: unknown[]) => void)
    }
  }, [socket, event, handler])
}

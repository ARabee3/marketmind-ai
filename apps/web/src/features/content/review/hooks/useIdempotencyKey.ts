import { useCallback, useRef } from 'react'
import { generateIdempotencyKey } from '../utils/idempotency'

/**
 * Hook to manage idempotency keys per logical owner decision.
 * Generates a new key on demand or retrieves the current pending key for retries.
 */
export function useIdempotencyKey() {
  const currentKeyRef = useRef<string | null>(null)

  const getKey = useCallback(() => {
    if (!currentKeyRef.current) {
      currentKeyRef.current = generateIdempotencyKey()
    }
    return currentKeyRef.current
  }, [])

  const renewKey = useCallback(() => {
    const newKey = generateIdempotencyKey()
    currentKeyRef.current = newKey
    return newKey
  }, [])

  const resetKey = useCallback(() => {
    currentKeyRef.current = null
  }, [])

  return {
    getKey,
    renewKey,
    resetKey,
  }
}

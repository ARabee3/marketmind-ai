import { useCallback, useRef } from 'react'
import { generateIdempotencyKey } from '../utils/idempotency'

/**
 * Hook to manage idempotency keys per logical owner decision.
 * Generates a fresh key for each new decision submission.
 */
export function useIdempotencyKey() {
  const currentKeyRef = useRef<string | null>(null)

  const renewKey = useCallback(() => {
    const newKey = generateIdempotencyKey()
    currentKeyRef.current = newKey
    return newKey
  }, [])

  return {
    renewKey,
  }
}

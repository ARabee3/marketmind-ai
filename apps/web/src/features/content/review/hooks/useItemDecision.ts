import { useCallback, useState } from 'react'
import { submitItemDecision } from '@/lib/api/content-review'
import { useIdempotencyKey } from './useIdempotencyKey'
import type {
  DecisionRequestState,
  SingleDecisionRequest,
} from '../types/review.types'

export function useItemDecision(packId: string, onItemUpdated?: () => void) {
  const [decisionState, setDecisionState] = useState<DecisionRequestState>({
    status: 'idle',
  })

  const { renewKey } = useIdempotencyKey()

  const submitDecision = useCallback(
    async (
      itemId: string,
      versionId: string,
      checksum: string,
      decision: 'approve' | 'reject' | 'revise',
      notes?: string | null,
    ) => {
      // Duplicate submission protection guard
      if (decisionState.status === 'submitting') {
        return
      }

      const idempotencyKey = renewKey()

      setDecisionState({
        status: 'submitting',
        decision,
      })

      const request: SingleDecisionRequest = {
        item_id: itemId,
        version_id: versionId,
        checksum,
        decision,
        notes: notes ?? null,
        idempotency_key: idempotencyKey,
      }

      try {
        await submitItemDecision(packId, itemId, request)
        setDecisionState({ status: 'success' })
        if (onItemUpdated) {
          onItemUpdated()
        }
      } catch (err: unknown) {
        const error = err as Error & { code?: string; latestVersionId?: string }
        if (error.code === 'CONTENT_VERSION_CONFLICT' && error.latestVersionId) {
          // Refetch authoritative state before the owner decides again; the
          // rail announces the change and returns focus to the updated heading.
          if (onItemUpdated) {
            onItemUpdated()
          }
          setDecisionState({
            status: 'conflict',
            latestVersionId: error.latestVersionId,
          })
        } else {
          setDecisionState({
            status: 'error',
            code: error.code || 'CONTENT_APPROVAL_BLOCKED',
            message: error.message,
          })
        }
      }
    },
    [decisionState.status, packId, renewKey, onItemUpdated],
  )

  const resetDecisionState = useCallback(() => {
    setDecisionState({ status: 'idle' })
  }, [])

  return {
    decisionState,
    submitDecision,
    resetDecisionState,
  }
}

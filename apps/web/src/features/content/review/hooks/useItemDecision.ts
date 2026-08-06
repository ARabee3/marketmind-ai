import { useCallback, useState } from 'react'
import { submitItemDecision } from '@/lib/api/content-review'
import { useIdempotencyKey } from './useIdempotencyKey'
import type {
  DecisionRequestState,
  SingleDecisionRequest,
} from '../types/review.types'

export function useItemDecision(
  packId: string,
  onItemUpdated?: () => void | Promise<void>,
) {
  const [decisionState, setDecisionState] = useState<DecisionRequestState>({
    status: 'idle',
  })

  const { renewKey } = useIdempotencyKey()

  // Refresh authoritative state without letting a refetch failure turn a
  // successful (or conflicted) decision into a generic error.
  const refreshAfterDecision = useCallback(async () => {
    if (!onItemUpdated) return
    try {
      await onItemUpdated()
    } catch {
      // Refetch is best-effort here; the decision outcome is authoritative.
    }
  }, [onItemUpdated])

  const submitDecision = useCallback(
    async (
      itemId: string,
      versionId: string,
      checksum: string,
      decision: 'approve' | 'reject' | 'revise',
      notes?: string | null,
    ) => {
      // Duplicate submission protection guard
      if (
        decisionState.status === 'submitting' ||
        decisionState.status === 'refreshing'
      ) {
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
      } catch (err: unknown) {
        const error = err as Error & { code?: string; latestVersionId?: string }
        if (error.code === 'CONTENT_VERSION_CONFLICT' && error.latestVersionId) {
          // Refetch authoritative state before the owner decides again; the
          // rail announces the change and returns focus to the updated heading
          // only after the fresh data has landed.
          setDecisionState({
            status: 'refreshing',
            decision,
          })
          await refreshAfterDecision()
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
        return
      }

      // The decision was accepted. Await the authoritative refetch so the rail
      // never re-enables on stale data (e.g. before the created candidate is
      // visible); a refetch failure keeps the success state instead of
      // misleading the owner into thinking the decision itself failed.
      await refreshAfterDecision()
      setDecisionState({ status: 'success' })
    },
    [decisionState.status, packId, renewKey, refreshAfterDecision],
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

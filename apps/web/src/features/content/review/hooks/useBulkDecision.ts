import { useCallback, useState } from 'react'
import { submitBulkDecisions } from '@/lib/api/content-review'
import { useIdempotencyKey } from './useIdempotencyKey'
import { isItemActionable } from '../utils/eligibility'
import type {
  BulkDecisionRequest,
  BulkDecisionResponse,
  ContentPackWorkspaceItem,
} from '../types/review.types'

export type BulkState =
  | { status: 'idle'; selectedItemIds: string[]; result: null; error: null }
  | { status: 'submitting'; selectedItemIds: string[]; result: null; error: null }
  | { status: 'success'; selectedItemIds: string[]; result: BulkDecisionResponse; error: null }
  | { status: 'error'; selectedItemIds: string[]; result: null; error: Error }

export function useBulkDecision(
  packId: string,
  items: readonly ContentPackWorkspaceItem[],
  onSuccess?: () => void,
) {
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [state, setState] = useState<BulkState>({
    status: 'idle',
    selectedItemIds: [],
    result: null,
    error: null,
  })

  const { renewKey } = useIdempotencyKey()

  const toggleSelectItem = useCallback((itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId)
        ? prev.filter((id) => id !== itemId)
        : [...prev, itemId],
    )
  }, [])

  const selectAllEligible = useCallback(() => {
    const eligibleIds = items
      .filter((item) => isItemActionable(item))
      .map((item) => item.item.id)
    setSelectedItemIds(eligibleIds)
  }, [items])

  const deselectAll = useCallback(() => {
    setSelectedItemIds([])
  }, [])

  const submitBulk = useCallback(async () => {
    if (selectedItemIds.length === 0 || state.status === 'submitting') {
      return
    }

    // Filter selected items and build the decisions payload with actionable
    // items only; each decision carries its own idempotency key so retries
    // stay independent per item (backend ContentDecisionDto contract).
    const payloadItems = items
      .filter((item) => selectedItemIds.includes(item.item.id))
      .filter((item) => isItemActionable(item))
      .map((item) => ({
        content_item_id: item.item.id,
        content_item_version_id: item.current_version.id,
        content_item_version_checksum: item.current_version.version_checksum,
        decision: 'approved' as const,
        revision_notes: null,
        idempotency_key: renewKey(),
      }))

    if (payloadItems.length === 0) {
      return
    }

    setState({
      status: 'submitting',
      selectedItemIds,
      result: null,
      error: null,
    })

    const request: BulkDecisionRequest = {
      decisions: payloadItems,
    }

    try {
      const res = await submitBulkDecisions(packId, request)
      setState({
        status: 'success',
        selectedItemIds: [],
        result: res,
        error: null,
      })
      setSelectedItemIds([])
      if (onSuccess) {
        onSuccess()
      }
    } catch (err) {
      setState({
        status: 'error',
        selectedItemIds,
        result: null,
        error: err instanceof Error ? err : new Error('Bulk decision failed'),
      })
    }
  }, [selectedItemIds, state.status, items, renewKey, packId, onSuccess])

  const resetBulkState = useCallback(() => {
    setState({
      status: 'idle',
      selectedItemIds: [],
      result: null,
      error: null,
    })
    setSelectedItemIds([])
  }, [])

  return {
    selectedItemIds,
    toggleSelectItem,
    selectAllEligible,
    deselectAll,
    submitBulk,
    resetBulkState,
    bulkState: state,
  }
}

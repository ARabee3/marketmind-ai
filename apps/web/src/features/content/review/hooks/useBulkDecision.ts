import { useCallback, useState } from 'react'
import { submitBulkDecisions } from '@/lib/api/content-review'
import { useIdempotencyKey } from './useIdempotencyKey'
import { checkItemEligibility } from '../utils/eligibility'
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
      .filter((item) => checkItemEligibility(item).eligible)
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

    // Filter selected items and build payload with eligible items only
    const payloadItems = items
      .filter((item) => selectedItemIds.includes(item.item.id))
      .filter((item) => checkItemEligibility(item).eligible)
      .map((item) => ({
        item_id: item.item.id,
        version_id: item.current_version.id,
        checksum: item.current_version.version_checksum,
      }))

    if (payloadItems.length === 0) {
      return
    }

    const idempotencyKey = renewKey()

    setState({
      status: 'submitting',
      selectedItemIds,
      result: null,
      error: null,
    })

    const request: BulkDecisionRequest = {
      items: payloadItems,
      idempotency_key: idempotencyKey,
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

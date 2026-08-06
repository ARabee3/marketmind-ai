import { useCallback, useEffect, useRef, useState } from 'react'
import { getPackWorkspace } from '@/lib/api/content-review'
import { mockPackWorkspace } from '../fixtures/pack.fixtures'
import type {
  ContentPackWorkspace,
  ContentPackWorkspaceItem,
} from '../types/review.types'

export type PackWorkspaceState =
  | { status: 'loading'; workspace: null; error: null; isFixture: false }
  | {
      status: 'success'
      workspace: ContentPackWorkspace
      error: null
      isFixture: boolean
    }
  | { status: 'error'; workspace: null; error: Error; isFixture: false }

function resolveSelectedItem(
  items: readonly ContentPackWorkspaceItem[],
  previousId: string | null,
): string | null {
  if (previousId && items.some((i) => i.item.id === previousId)) {
    return previousId
  }
  return items[0]?.item.id ?? null
}

export function usePackWorkspace(packId: string) {
  const [state, setState] = useState<PackWorkspaceState>({
    status: 'loading',
    workspace: null,
    error: null,
    isFixture: false,
  })

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const packIdRef = useRef(packId)

  useEffect(() => {
    packIdRef.current = packId
  }, [packId])

  const loadWorkspace = useCallback(async () => {
    const requestedPackId = packIdRef.current
    const stillCurrent = () => packIdRef.current === requestedPackId

    try {
      const data = await getPackWorkspace(requestedPackId)
      if (!stillCurrent()) return
      setState({
        status: 'success',
        workspace: data,
        error: null,
        isFixture: false,
      })
      setSelectedItemId((prevId) => resolveSelectedItem(data.items, prevId))
    } catch (err) {
      if (!stillCurrent()) return
      const status = (err as Error & { status?: number }).status
      if (status === 404) {
        // The aggregate pack-workspace read model is not integrated yet; show
        // the clearly-labeled contract-aligned fixture proof while it is missing.
        setState({
          status: 'success',
          workspace: mockPackWorkspace,
          error: null,
          isFixture: true,
        })
        setSelectedItemId((prevId) =>
          resolveSelectedItem(mockPackWorkspace.items, prevId),
        )
        return
      }
      setState({
        status: 'error',
        workspace: null,
        error: err instanceof Error ? err : new Error('Failed to load pack workspace'),
        isFixture: false,
      })
    }
  }, [])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const selectedItem: ContentPackWorkspaceItem | null =
    state.workspace?.items.find((i) => i.item.id === selectedItemId) ??
    state.workspace?.items[0] ??
    null

  return {
    ...state,
    selectedItemId,
    selectedItem,
    setSelectedItemId,
    refetch: loadWorkspace,
  }
}

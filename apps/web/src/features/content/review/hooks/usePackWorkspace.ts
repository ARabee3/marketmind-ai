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

  const loadWorkspace = useCallback(async (requestedPackId: string) => {
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
    // Track the latest requested pack so in-flight responses from a previous
    // pack are discarded instead of rendering under the new URL. The previous
    // pack's data is masked via the derived state below rather than being
    // reset synchronously, so navigating between packs never renders one
    // pack's content beneath another pack's URL.
    packIdRef.current = packId
    const timer = setTimeout(() => {
      void loadWorkspace(packId)
    }, 0)
    return () => clearTimeout(timer)
  }, [packId, loadWorkspace])

  const refetch = useCallback(
    () => loadWorkspace(packIdRef.current),
    [loadWorkspace],
  )

  // While a load for the current packId is in flight, the stored workspace
  // belongs to a previous pack; surface that as a fresh loading state so the
  // UI never shows one pack under another pack's URL.
  const effectiveState: PackWorkspaceState =
    state.status === 'success' && state.workspace.pack.id !== packId
      ? { status: 'loading', workspace: null, error: null, isFixture: false }
      : state

  const selectedItem: ContentPackWorkspaceItem | null =
    effectiveState.workspace?.items.find((i) => i.item.id === selectedItemId) ??
    effectiveState.workspace?.items[0] ??
    null

  return {
    ...effectiveState,
    selectedItemId,
    selectedItem,
    setSelectedItemId,
    refetch,
  }
}

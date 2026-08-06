import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePackWorkspace } from '../usePackWorkspace'
import * as api from '@/lib/api/content-review'
import { mockPackWorkspace } from '../../fixtures/pack.fixtures'
import type {
  ContentPackWorkspace,
  ContentPackWorkspaceItem,
} from '../../types/review.types'

vi.mock('@/lib/api/content-review', () => ({
  getPackWorkspace: vi.fn(),
  submitItemDecision: vi.fn(),
  submitBulkDecisions: vi.fn(),
  fetchAuthenticatedAssetBlob: vi.fn(),
}))

function cloneWorkspaceWithIds(
  packId: string,
  itemIds: string[],
): ContentPackWorkspace {
  const clone = JSON.parse(
    JSON.stringify(mockPackWorkspace),
  ) as ContentPackWorkspace
  clone.pack = { ...clone.pack, id: packId }
  clone.items = clone.items.map((item, idx) => {
    const itemClone: ContentPackWorkspaceItem = {
      ...item,
      item: { ...item.item, id: itemIds[idx] ?? item.item.id },
    }
    return itemClone
  })
  return clone
}

describe('usePackWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the requested pack and selects the first item', async () => {
    vi.mocked(api.getPackWorkspace).mockResolvedValue(mockPackWorkspace)

    const { result } = renderHook(() =>
      usePackWorkspace(mockPackWorkspace.pack.id),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })
    expect(api.getPackWorkspace).toHaveBeenCalledWith(mockPackWorkspace.pack.id)
    expect(result.current.selectedItem?.item.id).toBe(
      mockPackWorkspace.items[0].item.id,
    )
  })

  it('reloads on packId change and never renders the previous pack beneath the new URL', async () => {
    const packA = mockPackWorkspace
    const packB = cloneWorkspaceWithIds('pack-b-id', [
      'item-b-1',
      'item-b-2',
      'item-b-3',
      'item-b-4',
    ])

    let resolvePackA!: (value: ContentPackWorkspace) => void
    let resolvePackB!: (value: ContentPackWorkspace) => void
    vi.mocked(api.getPackWorkspace).mockImplementationOnce(
      () =>
        new Promise<ContentPackWorkspace>((resolve) => {
          resolvePackA = resolve
        }),
    )
    vi.mocked(api.getPackWorkspace).mockImplementationOnce(
      () =>
        new Promise<ContentPackWorkspace>((resolve) => {
          resolvePackB = resolve
        }),
    )

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => usePackWorkspace(id),
      { initialProps: { id: packA.pack.id } },
    )

    // Pack A's request is in flight when the owner navigates to pack B.
    await waitFor(() => {
      expect(api.getPackWorkspace).toHaveBeenCalledTimes(1)
    })
    rerender({ id: packB.pack.id })

    await waitFor(() => {
      expect(api.getPackWorkspace).toHaveBeenCalledTimes(2)
    })

    // The late pack-A response must be discarded, not rendered.
    resolvePackA(packA)
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Pack A's data may not appear; pack B is still loading.
    expect(result.current.status).toBe('loading')
    expect(result.current.selectedItem).toBeNull()

    await waitFor(() => {
      expect(api.getPackWorkspace).toHaveBeenCalledTimes(2)
    })
    resolvePackB(packB)
    await waitFor(() => {
      expect(result.current.status).toBe('success')
    })
    expect(result.current.workspace?.pack.id).toBe('pack-b-id')
    expect(result.current.selectedItem?.item.id).toBe('item-b-1')
  })
})

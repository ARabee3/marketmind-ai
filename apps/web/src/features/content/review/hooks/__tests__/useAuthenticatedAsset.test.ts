import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAuthenticatedAsset } from '../useAuthenticatedAsset'
import { fetchAuthenticatedAssetBlob } from '@/lib/api/content-review'

vi.mock('@/lib/api/content-review', () => ({
  fetchAuthenticatedAssetBlob: vi.fn(),
}))

describe('useAuthenticatedAsset', () => {
  const createObjectUrl = vi.fn(() => 'blob:created-url')
  const revokeObjectUrl = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns idle without an asset id', () => {
    const { result } = renderHook(() => useAuthenticatedAsset(null))
    expect(result.current.status).toBe('idle')
    expect(fetchAuthenticatedAssetBlob).not.toHaveBeenCalled()
  })

  it('loads protected bytes into an object URL without exposing the API URL', async () => {
    vi.mocked(fetchAuthenticatedAssetBlob).mockResolvedValue(
      new Blob(['bytes'], { type: 'image/png' }),
    )
    const { result, unmount } = renderHook(() => useAuthenticatedAsset('asset-1'))

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(fetchAuthenticatedAssetBlob).toHaveBeenCalledWith('asset-1')
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(result.current.objectUrl).toBe('blob:created-url')
    expect(result.current.objectUrl).not.toContain('api/v1')
    unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:created-url')
  })

  it('surfaces a load failure without a URL', async () => {
    vi.mocked(fetchAuthenticatedAssetBlob).mockRejectedValue(
      new Error('Forbidden'),
    )
    const { result } = renderHook(() => useAuthenticatedAsset('asset-1'))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.objectUrl).toBeNull()
    expect(revokeObjectUrl).not.toHaveBeenCalled()
  })

  it('revokes the object URL on unmount', async () => {
    vi.mocked(fetchAuthenticatedAssetBlob).mockResolvedValue(
      new Blob(['bytes'], { type: 'image/png' }),
    )
    const { result, unmount } = renderHook(() => useAuthenticatedAsset('asset-1'))
    await waitFor(() => expect(result.current.status).toBe('success'))
    unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:created-url')
  })

  it('revokes the replaced URL when the asset id changes', async () => {
    vi.mocked(fetchAuthenticatedAssetBlob).mockResolvedValue(
      new Blob(['bytes'], { type: 'image/png' }),
    )
    const { result, rerender, unmount } = renderHook(
      ({ assetId }) => useAuthenticatedAsset(assetId),
      { initialProps: { assetId: 'asset-1' } },
    )
    await waitFor(() => expect(result.current.status).toBe('success'))
    createObjectUrl.mockReturnValueOnce('blob:second-url')
    rerender({ assetId: 'asset-2' })
    await waitFor(() => expect(result.current.objectUrl).toBe('blob:second-url'))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:created-url')
    unmount()
  })
})

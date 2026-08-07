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

  it('clears the previous URL and shows loading while a new asset loads', async () => {
    vi.mocked(fetchAuthenticatedAssetBlob).mockResolvedValue(
      new Blob(['bytes'], { type: 'image/png' }),
    )
    const { result, rerender, unmount } = renderHook(
      ({ assetId }) => useAuthenticatedAsset(assetId),
      { initialProps: { assetId: 'asset-1' } },
    )
    await waitFor(() => expect(result.current.status).toBe('success'))

    // Hold the second fetch open so the interim state is observable.
    let resolveSecond!: (blob: Blob) => void
    vi.mocked(fetchAuthenticatedAssetBlob).mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          resolveSecond = resolve
        }),
    )
    createObjectUrl.mockReturnValueOnce('blob:second-url')
    rerender({ assetId: 'asset-2' })

    // The previous item's image must not linger during the switch.
    expect(result.current.status).toBe('loading')
    expect(result.current.objectUrl).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:created-url')

    resolveSecond(new Blob(['bytes2'], { type: 'image/png' }))
    await waitFor(() => expect(result.current.objectUrl).toBe('blob:second-url'))
    expect(createObjectUrl).toHaveBeenCalledTimes(2)
    unmount()
  })
})

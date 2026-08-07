import { useEffect, useState } from 'react'
import { fetchAuthenticatedAssetBlob } from '@/lib/api/content-review'

export type AuthenticatedAssetResult =
  | { status: 'idle'; objectUrl: null; error: null }
  | { status: 'loading'; objectUrl: null; error: null }
  | { status: 'success'; objectUrl: string; error: null }
  | { status: 'error'; objectUrl: null; error: Error }

export function useAuthenticatedAsset(assetId?: string | null): AuthenticatedAssetResult {
  const [asset, setAsset] = useState<{
    assetId: string
    objectUrl: string
  } | null>(null)
  const [failure, setFailure] = useState<{
    assetId: string
    error: Error
  } | null>(null)

  useEffect(() => {
    if (!assetId) {
      return
    }

    let active = true
    let createdUrl: string | null = null

    fetchAuthenticatedAssetBlob(assetId)
      .then((blob) => {
        if (!active) return
        createdUrl = URL.createObjectURL(blob)
        setAsset({ assetId, objectUrl: createdUrl })
        setFailure(null)
      })
      .catch((err) => {
        if (!active) return
        setFailure({
          assetId,
          error: err instanceof Error ? err : new Error('Failed to load asset'),
        })
      })

    return () => {
      active = false
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [assetId])

  if (!assetId) {
    return { status: 'idle', objectUrl: null, error: null }
  }
  if (failure && failure.assetId === assetId) {
    return { status: 'error', objectUrl: null, error: failure.error }
  }
  // The requested asset has changed: report loading with no URL instead of
  // showing the previous item's image while the new fetch is in flight.
  if (!asset || asset.assetId !== assetId) {
    return { status: 'loading', objectUrl: null, error: null }
  }
  return { status: 'success', objectUrl: asset.objectUrl, error: null }
}

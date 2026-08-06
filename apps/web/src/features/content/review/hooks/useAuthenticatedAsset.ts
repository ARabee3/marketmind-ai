import { useEffect, useState } from 'react'
import { fetchAuthenticatedAssetBlob } from '@/lib/api/content-review'

export type AuthenticatedAssetResult =
  | { status: 'idle'; objectUrl: null; error: null }
  | { status: 'loading'; objectUrl: null; error: null }
  | { status: 'success'; objectUrl: string; error: null }
  | { status: 'error'; objectUrl: null; error: Error }

export function useAuthenticatedAsset(assetId?: string | null): AuthenticatedAssetResult {
  const [state, setState] = useState<AuthenticatedAssetResult>(() =>
    assetId
      ? { status: 'loading', objectUrl: null, error: null }
      : { status: 'idle', objectUrl: null, error: null },
  )

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
        setState({ status: 'success', objectUrl: createdUrl, error: null })
      })
      .catch((err) => {
        if (!active) return
        setState({
          status: 'error',
          objectUrl: null,
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

  return state
}

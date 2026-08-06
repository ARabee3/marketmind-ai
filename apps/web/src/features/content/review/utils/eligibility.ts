import type { ContentErrorCode } from '@marketmind/contracts'
import type { ContentPackWorkspaceItem } from '../types/review.types'

export type ItemEligibilityResult = {
  eligible: boolean
  blockers: readonly ContentErrorCode[]
  warnings: readonly ContentErrorCode[]
  reasons: readonly string[]
}

/**
 * Eligibility source of truth is the server-provided read model
 * (`workspaceItem.eligibility`). Only when that read model is absent (API not
 * integrated yet) do we fall back to deriving it from the version payload.
 */
export function checkItemEligibility(
  workspaceItem: ContentPackWorkspaceItem,
): ItemEligibilityResult {
  const { current_version, assets, eligibility } = workspaceItem

  if (eligibility) {
    return {
      eligible: eligibility.eligible_for_approval,
      blockers: [...eligibility.blockers],
      warnings: [...eligibility.warnings],
      reasons: [...eligibility.blockers],
    }
  }

  const blockers: ContentErrorCode[] = [...(current_version.blockers ?? [])]
  const warnings: ContentErrorCode[] = [...(current_version.warnings ?? [])]
  const reasons: string[] = []

  if (current_version.asset_required) {
    const requiredAsset = assets.find(
      (a) => a.content_item_version_id === current_version.id,
    )
    if (!requiredAsset || requiredAsset.status !== 'ready') {
      if (!blockers.includes('CONTENT_ASSET_REQUIRED')) {
        blockers.push('CONTENT_ASSET_REQUIRED')
      }
      if (!reasons.includes('CONTENT_ASSET_REQUIRED')) {
        reasons.push('CONTENT_ASSET_REQUIRED')
      }
    }
  }

  for (const b of blockers) {
    if (!reasons.includes(b)) {
      reasons.push(b)
    }
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    reasons,
  }
}

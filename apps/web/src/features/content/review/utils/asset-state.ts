import type { ContentAssetKind, ContentAssetStatus } from '@marketmind/contracts'

export type AssetStateTreatment = {
  kindLabelKey: string
  statusLabelKey: string
  statusBadgeVariant: 'default' | 'success' | 'warning' | 'danger' | 'neutral'
  iconName: 'image' | 'video' | 'alert-triangle' | 'loader' | 'x-circle' | 'lock' | 'file-text'
}

export function getAssetStateTreatment(
  kind: ContentAssetKind,
  status: ContentAssetStatus,
): AssetStateTreatment {
  const kindLabelKey = `ContentReview.asset.kind.${kind}`
  const statusLabelKey = `ContentReview.asset.status.${status}`

  let statusBadgeVariant: AssetStateTreatment['statusBadgeVariant'] = 'neutral'
  let iconName: AssetStateTreatment['iconName'] = 'image'

  if (kind === 'prompt_only') {
    return {
      kindLabelKey,
      statusLabelKey: 'ContentReview.asset.kind.prompt_only',
      statusBadgeVariant: 'neutral',
      iconName: 'file-text',
    }
  }

  switch (status) {
    case 'ready':
      statusBadgeVariant = 'success'
      iconName = 'image'
      break
    case 'generating':
      statusBadgeVariant = 'warning'
      iconName = 'loader'
      break
    case 'missing':
      statusBadgeVariant = 'neutral'
      iconName = 'alert-triangle'
      break
    case 'failed':
      statusBadgeVariant = 'danger'
      iconName = 'x-circle'
      break
    case 'blocked':
      statusBadgeVariant = 'danger'
      iconName = 'lock'
      break
  }

  return {
    kindLabelKey,
    statusLabelKey,
    statusBadgeVariant,
    iconName,
  }
}

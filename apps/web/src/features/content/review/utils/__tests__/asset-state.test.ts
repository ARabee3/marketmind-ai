import { describe, expect, it } from 'vitest'
import { getAssetStateTreatment } from '../asset-state'

describe('getAssetStateTreatment', () => {
  it('maps every asset status to a distinct truthful treatment', () => {
    const ready = getAssetStateTreatment('generated_static', 'ready')
    expect(ready.statusBadgeVariant).toBe('success')
    expect(ready.statusLabelKey).toBe('ContentReview.asset.status.ready')

    const generating = getAssetStateTreatment('generated_static', 'generating')
    expect(generating.statusBadgeVariant).toBe('warning')
    expect(generating.iconName).toBe('loader')

    const missing = getAssetStateTreatment('generated_static', 'missing')
    expect(missing.statusBadgeVariant).toBe('neutral')
    expect(missing.iconName).toBe('alert-triangle')

    const failed = getAssetStateTreatment('generated_static', 'failed')
    expect(failed.statusBadgeVariant).toBe('danger')
    expect(failed.iconName).toBe('x-circle')

    const blocked = getAssetStateTreatment('generated_static', 'blocked')
    expect(blocked.statusBadgeVariant).toBe('danger')
    expect(blocked.iconName).toBe('lock')
  })

  it('never claims a prompt-only asset is a ready image', () => {
    const treatment = getAssetStateTreatment('prompt_only', 'ready')
    expect(treatment.iconName).toBe('file-text')
    expect(treatment.statusLabelKey).toBe('ContentReview.asset.kind.prompt_only')
  })

  it('preserves the owner-supplied kind label', () => {
    const treatment = getAssetStateTreatment('owner_supplied', 'ready')
    expect(treatment.kindLabelKey).toBe('ContentReview.asset.kind.owner_supplied')
    expect(treatment.statusLabelKey).toBe('ContentReview.asset.status.ready')
  })
})

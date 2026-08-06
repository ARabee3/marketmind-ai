import { describe, expect, it } from 'vitest'
import { checkItemEligibility } from '../eligibility'
import type { ContentPackWorkspaceItem } from '../../types/review.types'
import { mockPackWorkspace } from '../../fixtures/pack.fixtures'

function itemAt(index: number): ContentPackWorkspaceItem {
  return mockPackWorkspace.items[index]
}

describe('checkItemEligibility', () => {
  it('treats the server read model as the source of truth', () => {
    const eligible = checkItemEligibility(itemAt(0))
    expect(eligible.eligible).toBe(true)
    expect(eligible.blockers).toEqual([])
    expect(eligible.reasons).toEqual([])

    const blocked = checkItemEligibility(itemAt(3))
    expect(blocked.eligible).toBe(false)
    expect(blocked.blockers).toEqual([
      'CONTENT_ASSET_REQUIRED',
      'CONTENT_OFFER_UNAPPROVED',
    ])
    expect(blocked.reasons).toEqual(blocked.blockers)
  })

  it('surfaces warnings separately from blockers', () => {
    const result = checkItemEligibility(itemAt(3))
    expect(result.warnings).toContain('CONTENT_UNSUPPORTED_CLAIM')
    expect(result.blockers).not.toContain('CONTENT_UNSUPPORTED_CLAIM')
  })

  it('derives eligibility locally when the server read model is absent', () => {
    const item = {
      ...itemAt(0),
      eligibility: undefined,
    } as unknown as ContentPackWorkspaceItem
    expect(item.eligibility).toBeUndefined()
    const result = checkItemEligibility(item)
    expect(result.eligible).toBe(true)
  })

  it('reports a missing required asset as a blocker in the fallback path', () => {
    const item = {
      ...itemAt(0),
      eligibility: undefined,
      assets: [],
    } as unknown as ContentPackWorkspaceItem
    const result = checkItemEligibility(item)
    expect(result.eligible).toBe(false)
    expect(result.blockers).toContain('CONTENT_ASSET_REQUIRED')
  })

  it('never mutates the workspace item payload', () => {
    const before = JSON.stringify(mockPackWorkspace)
    checkItemEligibility(itemAt(3))
    checkItemEligibility(itemAt(0))
    expect(JSON.stringify(mockPackWorkspace)).toBe(before)
  })
})

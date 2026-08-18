import { describe, expect, it } from 'vitest'
import {
  getPerformanceDemoWorkspace,
  PERFORMANCE_DEMO_OVERVIEW,
} from '../performance-demo'

describe('performance demo evidence', () => {
  it('matches the monitoring and optimization contracts without live identifiers', () => {
    const overview = PERFORMANCE_DEMO_OVERVIEW
    const workspace = getPerformanceDemoWorkspace('en')
    const sevenDaySnapshotIds = overview.posts.map(
      (post) => post.snapshots.find((snapshot) => snapshot.window === '7d')?.snapshot_id,
    )

    expect(overview.posts).toHaveLength(3)
    expect(overview.posts.every((post) => post.provider === 'facebook')).toBe(true)
    expect(
      overview.posts.every((post) => post.snapshots.some((snapshot) => snapshot.window === '7d')),
    ).toBe(true)
    expect(overview.baseline).toMatchObject({
      status: 'ready',
      observed_snapshot_count: 3,
      required_snapshot_count: 3,
    })
    expect(workspace.proposal.basis_snapshot_ids).toEqual(sevenDaySnapshotIds)
    expect(workspace.proposal.status).toBe('PENDING_OWNER_DECISION')
    expect(workspace.decision).toBeNull()
    expect(workspace.instruction).toBeNull()
  })

  it('localizes the proposal copy for the Arabic walkthrough', () => {
    const workspace = getPerformanceDemoWorkspace('ar')

    expect(workspace.proposal.summary).toContain('افتتاحية')
    expect(workspace.proposal.instruction).toContain('مسودة مستقبلية')
  })
})

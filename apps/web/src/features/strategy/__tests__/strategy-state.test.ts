// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { StrategyStatus } from '@marketmind/contracts'
import { getStrategyDemoFixture } from '../lib/strategy-fixtures'
import {
  getStrategyReadiness,
  ownerProgressLabel,
  strategyCanBeApproved,
} from '../lib/strategy-state'

describe('strategy frontend state', () => {
  it('uses owner-facing progress labels instead of technical wording', () => {
    const statuses = [
      'ready',
      'retrieving',
      'queued',
      'generating',
      'validating',
      'rejected',
    ] satisfies StrategyStatus[]
    const labels = statuses.map(ownerProgressLabel)

    expect(labels).toEqual([
      'ready_to_prepare',
      'checking_guidance',
      'organizing_plan',
      'writing_draft',
      'checking_plan',
      'revision_needed',
    ])
    expect(labels.join(' ')).not.toMatch(/rag|qdrant|retriev|llm|embedding|schema|validator/i)
  })

  it('keeps the ready demo fixture in the ready lifecycle state', () => {
    const fixture = getStrategyDemoFixture('ready')

    expect(fixture.resource.status).toBe('ready')
    expect(fixture.resource.latest_plan).toBeNull()
  })

  it('blocks approval when paid execution has no confirmed budget', () => {
    const fixture = getStrategyDemoFixture('draftNeedsBudget')
    const readiness = getStrategyReadiness(fixture.resource)

    expect(readiness.ready).toBe(false)
    expect(strategyCanBeApproved(fixture.resource)).toBe(false)
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'budget_required', severity: 'blocking' }),
      ]),
    )
  })

  it('keeps previous versions visible after a failed revision', () => {
    const fixture = getStrategyDemoFixture('revisionFailed')

    expect(fixture.versions).toHaveLength(2)
    expect(fixture.versions[0]).toEqual(
      expect.objectContaining({ version: 2, status: 'failed' }),
    )
    expect(fixture.versions[1]).toEqual(
      expect.objectContaining({ version: 1, status: 'approved' }),
    )
  })

  it('marks every progress stage complete when a draft is ready', () => {
    const fixture = getStrategyDemoFixture('draftReady')

    expect(fixture.progress).toHaveLength(4)
    expect(fixture.progress.every((event) => event.status === 'complete')).toBe(true)
  })
})

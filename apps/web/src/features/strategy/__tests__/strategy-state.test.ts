// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { CurrentJourneyResponse, StrategyStatus } from '@marketmind/contracts'
import { getStrategyDemoFixture } from '../lib/strategy-fixtures'
import {
  getStrategyReadiness,
  ownerProgressLabel,
  strategyCanBeApproved,
  strategyDiscoveryAction,
} from '../lib/strategy-state'

describe('strategy frontend state', () => {
  it('uses owner-facing progress labels instead of technical wording', () => {
    const statuses = [
      'ready',
      'retrieving',
      'queued',
      'generating',
      'validating',
      'approved',
      'rejected',
    ] satisfies StrategyStatus[]
    const labels = statuses.map(ownerProgressLabel)

    expect(labels).toEqual([
      'ready_to_prepare',
      'checking_guidance',
      'organizing_plan',
      'writing_draft',
      'checking_plan',
      'approved',
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

  describe('strategyDiscoveryAction', () => {
    const baseJourney = {
      owner: { email: 'owner@example.com', email_verified: true },
      journey: { state: 'discovery_not_started', profile: null },
      future_phase: { availability: 'unavailable', strategy_id: null },
    } as unknown as CurrentJourneyResponse

    it('maps a start_discovery action to the new discovery route', () => {
      const journey: CurrentJourneyResponse = {
        ...baseJourney,
        primary_action: { type: 'start_discovery', destination: '/discovery/new' },
      }

      expect(strategyDiscoveryAction(journey)).toEqual({
        destination: '/discovery/new',
        labelKey: 'startDiscovery',
      })
    })

    it('maps a continue_discovery action to the active session', () => {
      const journey: CurrentJourneyResponse = {
        ...baseJourney,
        primary_action: {
          type: 'continue_discovery',
          session_id: 'session-1',
          destination: '/discovery/session-1',
        },
      }

      expect(strategyDiscoveryAction(journey)).toEqual({
        destination: '/discovery/session-1',
        labelKey: 'continueDiscovery',
      })
    })

    it('maps a review_profile action to the profile review route', () => {
      const journey: CurrentJourneyResponse = {
        ...baseJourney,
        primary_action: {
          type: 'review_profile',
          session_id: 'session-1',
          destination: '/discovery/session-1/review',
        },
      }

      expect(strategyDiscoveryAction(journey)).toEqual({
        destination: '/discovery/session-1/review',
        labelKey: 'reviewProfile',
      })
    })

    it('falls back to a new discovery journey when no primary action exists', () => {
      expect(strategyDiscoveryAction(baseJourney)).toEqual({
        destination: '/discovery/new',
        labelKey: 'startDiscovery',
      })
    })

    it('falls back when the primary action is not discovery related', () => {
      const journey: CurrentJourneyResponse = {
        ...baseJourney,
        primary_action: { type: 'none', destination: null },
      }

      expect(strategyDiscoveryAction(journey)).toEqual({
        destination: '/discovery/new',
        labelKey: 'startDiscovery',
      })
    })
  })
})

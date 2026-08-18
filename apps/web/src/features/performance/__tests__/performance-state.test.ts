import { describe, expect, it } from 'vitest'
import type {
  PerformanceErrorCode,
  PerformancePostProjectionV1,
} from '@marketmind/contracts'
import {
  baselineProgress,
  metricValueFor,
  stageStatus,
} from '../performance-state'

const BUSINESS_ID = 'a1000000-0000-4000-8000-000000000001'
const CANDIDATE_ID = 'a1000000-0000-4000-8000-000000000002'
const RESULT_ID = 'a1000000-0000-4000-8000-000000000003'

function post(
  overrides: Partial<PerformancePostProjectionV1> = {},
): PerformancePostProjectionV1 {
  return {
    contract_version: 'performance-v1',
    business_id: BUSINESS_ID,
    candidate_id: CANDIDATE_ID,
    publishing_result_id: RESULT_ID,
    provider: 'facebook',
    provider_object_id: 'page-1_post-1',
    published_at: '2026-08-18T08:00:00.000Z',
    snapshots: [],
    sync_windows: [],
    ...overrides,
  }
}

function window(
  state: 'queued' | 'leased' | 'succeeded' | 'retryable' | 'terminal',
  lastErrorCode: PerformanceErrorCode | null = null,
) {
  return {
    contract_version: 'performance-v1' as const,
    sync_window_id: 'a1000000-0000-4000-8000-000000000010',
    business_id: BUSINESS_ID,
    publishing_result_id: RESULT_ID,
    provider: 'facebook' as const,
    window: '24h' as const,
    due_at: '2026-08-18T12:00:00.000Z',
    state,
    attempt_count: 1,
    next_attempt_at: null,
    lease_owner: null,
    lease_expires_at: null,
    last_error_code: lastErrorCode,
    created_at: '2026-08-18T08:00:00.000Z',
    updated_at: '2026-08-18T08:00:00.000Z',
  }
}

describe('performance state mapping', () => {
  it('keeps an absent window scheduled and a due queued window collecting', () => {
    expect(stageStatus(post(), '24h', new Date('2026-08-18T09:00:00.000Z'))).toBe('scheduled')
    expect(
      stageStatus(
        post({ sync_windows: [window('queued')] }),
        '24h',
        new Date('2026-08-18T13:00:00.000Z'),
      ),
    ).toBe('collecting')
  })

  it.each([
    ['retryable', null, 'retrying'],
    ['terminal', 'PERFORMANCE_PERMISSION_REQUIRED', 'blocked'],
    ['terminal', 'PERFORMANCE_PROVIDER_UNAVAILABLE', 'unavailable'],
    ['succeeded', null, 'unavailable'],
  ] as const)('maps %s/%s to %s', (state, code, expected) => {
    expect(stageStatus(post({ sync_windows: [window(state, code)] }), '24h')).toBe(expected)
  })

  it('prioritizes an immutable snapshot over mutable collection state', () => {
    const current = post({
      sync_windows: [window('terminal', 'PERFORMANCE_PROVIDER_UNAVAILABLE')],
      snapshots: [
        {
          contract_version: 'performance-v1',
          snapshot_id: 'a1000000-0000-4000-8000-000000000011',
          business_id: BUSINESS_ID,
          publishing_result_id: RESULT_ID,
          provider: 'facebook',
          provider_object_id: 'page-1_post-1',
          window: '24h',
          published_at: '2026-08-18T08:00:00.000Z',
          observed_at: '2026-08-19T08:00:00.000Z',
          fetched_at: '2026-08-19T08:00:01.000Z',
          metrics: {
            post_media_view: { status: 'available', value: 0 },
            post_total_media_view_unique: { status: 'available', value: 5 },
            post_clicks: { status: 'unavailable', reason: 'not_returned' },
          },
        },
      ],
    })

    expect(stageStatus(current, '24h')).toBe('complete')
    expect(metricValueFor(current, '24h', 'post_media_view')).toEqual({
      status: 'available',
      value: 0,
    })
    expect(metricValueFor(current, '7d', 'post_clicks')).toEqual({
      status: 'unavailable',
      reason: 'not_yet_observed',
    })
  })

  it('caps visual baseline progress without changing the contract counts', () => {
    expect(baselineProgress(0, 3)).toBe(0)
    expect(baselineProgress(2, 3)).toBe(67)
    expect(baselineProgress(5, 3)).toBe(100)
  })
})

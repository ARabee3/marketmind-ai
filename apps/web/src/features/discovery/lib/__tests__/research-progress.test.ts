import { describe, expect, it } from 'vitest'
import type { DiscoveryProgressEvent } from '@marketmind/contracts'
import { getResearchProgress, getStageState } from '../research-progress'

function event(
  seq: number,
  stage: DiscoveryProgressEvent['stage'],
  status: DiscoveryProgressEvent['status'],
  messageKey = `discovery.${stage}.${status}`,
): DiscoveryProgressEvent {
  return {
    type: 'progress',
    session_id: 'session-1',
    seq,
    stage,
    status,
    message_key: messageKey,
    message_text: '',
    payload: {},
    created_at: '2026-07-17T12:00:00.000Z',
  }
}

describe('research progress', () => {
  it('derives progress and stage state from real events', () => {
    const events = [
      event(1, 'queued', 'complete'),
      event(2, 'query_planning', 'complete'),
      event(3, 'metadata', 'progress'),
    ]

    expect(getResearchProgress(events, 'researching')).toEqual({
      currentStage: 'metadata',
      progressPercent: 22,
      estimatedMinutes: 2,
      complete: false,
    })
    expect(getStageState('query_planning', events, 'metadata')).toBe('complete')
    expect(getStageState('metadata', events, 'metadata')).toBe('current')
  })

  it('ignores wrapper events and completes from authoritative session state', () => {
    const events = [
      event(1, 'queued', 'complete'),
      event(2, 'search', 'progress', 'discovery.intelligence.started'),
    ]

    expect(getResearchProgress(events, 'researching').currentStage).toBe('queued')
    expect(getResearchProgress(events, 'ready_for_chat')).toEqual({
      currentStage: 'ready',
      progressPercent: 100,
      estimatedMinutes: 0,
      complete: true,
    })
  })
})

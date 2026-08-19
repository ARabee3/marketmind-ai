import { describe, expect, it, vi } from 'vitest'
import type { StrategyProgressEvent } from '@marketmind/contracts'
import {
  strategyFailureTranslationKey,
  strategyProgressPercent,
} from '../strategy-progress'
import { ownerProgressLabel } from '../../lib/strategy-state'

vi.mock('@/i18n/navigation', () => ({
  Link: () => null,
}))

const baseEvent = {
  type: 'strategy_progress',
  strategy_id: '11111111-1111-4111-8111-111111111111',
  message_key: 'strategy.progress',
  message_text: 'Progress update',
  payload: {},
  created_at: '2026-07-28T10:00:00.000Z',
} satisfies Omit<StrategyProgressEvent, 'seq' | 'stage' | 'status'>

describe('strategyProgressPercent', () => {
  it('derives progress from persisted event states', () => {
    const progress = [
      { ...baseEvent, seq: 1, stage: 'queued', status: 'complete' },
      { ...baseEvent, seq: 2, stage: 'retrieval', status: 'progress' },
    ] satisfies StrategyProgressEvent[]

    expect(strategyProgressPercent('generating', progress)).toBe(75)
  })

  it('keeps active work below complete until the draft is ready', () => {
    const progress = [
      { ...baseEvent, seq: 1, stage: 'queued', status: 'complete' },
    ] satisfies StrategyProgressEvent[]

    expect(strategyProgressPercent('generating', progress)).toBe(99)
    expect(strategyProgressPercent('draft', progress)).toBe(100)
  })
})

describe('ownerProgressLabel for approved plans', () => {
  it('labels an approved strategy distinctly from a ready draft', () => {
    expect(ownerProgressLabel('approved')).toBe('approved')
    expect(ownerProgressLabel('draft')).toBe('ready')
  })
})

describe('strategyFailureTranslationKey', () => {
  it('keeps provider diagnostics out of owner-facing failure copy', () => {
    expect(strategyFailureTranslationKey('STRATEGY_LANGUAGE_MISMATCH')).toBe(
      'failureBody',
    )
    expect(strategyFailureTranslationKey('STRATEGY_INVALID_CITATION')).toBe(
      'failureBody',
    )
  })

  it('preserves the safe knowledge-unavailable guidance', () => {
    expect(
      strategyFailureTranslationKey('STRATEGY_KNOWLEDGE_UNAVAILABLE'),
    ).toBe('knowledgeUnavailable')
  })
})

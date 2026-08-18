import { describe, it, expect } from 'vitest'
import type { BillingPointLedgerEntry } from '@marketmind/contracts'
import { entryLabel } from '../billing-home'

type TranslateFn = Parameters<typeof entryLabel>[0]

function fakeT(): TranslateFn {
  const dict: Record<string, string> = {
    ledgerTopup: 'Points purchased',
    ledgerTrialGrant: 'Welcome bonus',
    ledgerRefund: 'Refund',
    ledgerSpend: 'Used for AI work',
    ledgerSpendStrategy: 'Used for creating strategy',
    ledgerSpendStrategyRevision: 'Used for strategy revision',
    ledgerSpendContent: 'Used for generating content',
    ledgerSpendContentRevision: 'Used for revising content',
    ledgerSpendImage: 'Used for generating an image',
  }
  return ((key: string) => dict[key] ?? key) as unknown as TranslateFn
}

describe('entryLabel', () => {
  const t = fakeT()
  type Reason = BillingPointLedgerEntry['reason']
  type Metric = BillingPointLedgerEntry['metric']

  it('labels credit reasons', () => {
    expect(entryLabel(t, 'topup' as Reason, null, 150)).toBe('Points purchased')
    expect(entryLabel(t, 'trial_grant' as Reason, null, 65)).toBe(
      'Welcome bonus',
    )
    expect(entryLabel(t, 'refund' as Reason, null, 50)).toBe('Refund')
  })

  it('labels spends with the specific metric action', () => {
    expect(entryLabel(t, 'spend', 'strategy_cycle', 50)).toBe(
      'Used for creating strategy',
    )
    expect(entryLabel(t, 'spend', 'strategy_revision', 10)).toBe(
      'Used for strategy revision',
    )
    expect(entryLabel(t, 'spend', 'content_item', 2)).toBe(
      'Used for generating content',
    )
    expect(entryLabel(t, 'spend', 'content_revision', 1)).toBe(
      'Used for revising content',
    )
    expect(entryLabel(t, 'spend', 'static_image', 8)).toBe(
      'Used for generating an image',
    )
  })

  it('falls back to the generic label when a spend has no metric', () => {
    expect(entryLabel(t, 'spend', null, 2)).toBe('Used for AI work')
  })

  it('does not mistake unknown metrics for credit labels', () => {
    expect(
      entryLabel(t, 'spend', 'publication_target' as Metric, 0),
    ).toBe('Used for AI work')
  })
})

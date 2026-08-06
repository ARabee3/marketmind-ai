import { describe, expect, it } from 'vitest'
import { getProvenanceLabelTreatment } from '../provenance-labels'

describe('getProvenanceLabelTreatment', () => {
  it('maps every provenance category to its label key', () => {
    const cases: Array<[Parameters<typeof getProvenanceLabelTreatment>[0], string]> = [
      ['fact', 'ContentReview.provenance.sourceTypes.fact'],
      ['context', 'ContentReview.provenance.sourceTypes.context'],
      ['strategy', 'ContentReview.provenance.sourceTypes.strategy'],
      ['model', 'ContentReview.provenance.sourceTypes.model'],
      ['assumption', 'ContentReview.provenance.sourceTypes.assumption'],
      ['warning', 'ContentReview.provenance.sourceTypes.warning'],
      ['blocker', 'ContentReview.provenance.sourceTypes.blocker'],
    ]
    for (const [category, key] of cases) {
      const treatment = getProvenanceLabelTreatment(category)
      expect(treatment.category).toBe(category)
      expect(treatment.translationKey).toBe(key)
      expect(treatment.badgeClass).toContain('border-')
    }
  })

  it('distinguishes fact, context, strategy, model, warning, and blocker visually', () => {
    const classes = (['fact', 'context', 'strategy', 'model', 'assumption', 'warning', 'blocker'] as const).map(
      (category) => getProvenanceLabelTreatment(category).badgeClass,
    )
    expect(new Set(classes).size).toBe(classes.length)
  })
})

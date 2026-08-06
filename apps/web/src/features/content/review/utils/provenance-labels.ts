export type ProvenanceCategory =
  | 'fact'
  | 'context'
  | 'strategy'
  | 'model'
  | 'assumption'
  | 'warning'
  | 'blocker'

export type ProvenanceLabelTreatment = {
  category: ProvenanceCategory
  translationKey: string
  badgeClass: string
  iconName: 'check-circle' | 'user' | 'target' | 'sparkles' | 'help-circle' | 'alert-triangle' | 'octagon-alert'
}

export function getProvenanceLabelTreatment(
  category: ProvenanceCategory,
): ProvenanceLabelTreatment {
  switch (category) {
    case 'fact':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.fact',
        badgeClass: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200',
        iconName: 'check-circle',
      }
    case 'context':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.context',
        badgeClass: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200',
        iconName: 'user',
      }
    case 'strategy':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.strategy',
        badgeClass: 'bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-950 dark:text-teal-200',
        iconName: 'target',
      }
    case 'model':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.model',
        badgeClass: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200',
        iconName: 'sparkles',
      }
    case 'assumption':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.assumption',
        badgeClass: 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200',
        iconName: 'help-circle',
      }
    case 'warning':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.warning',
        badgeClass: 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900 dark:text-amber-100',
        iconName: 'alert-triangle',
      }
    case 'blocker':
      return {
        category,
        translationKey: 'ContentReview.provenance.sourceTypes.blocker',
        badgeClass: 'bg-red-100 text-red-900 border-red-400 dark:bg-red-950 dark:text-red-200',
        iconName: 'octagon-alert',
      }
  }
}

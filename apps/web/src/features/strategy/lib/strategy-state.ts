import type {
  StrategyBlocker,
  StrategyResource,
  StrategyStatus,
} from '@marketmind/contracts'

export type StrategyOwnerProgressLabel =
  | 'ready_to_prepare'
  | 'checking_guidance'
  | 'organizing_plan'
  | 'writing_draft'
  | 'checking_plan'
  | 'ready'
  | 'approved'
  | 'failed'
  | 'needs_choices'
  | 'revision_needed'

export function ownerProgressLabel(status: StrategyStatus): StrategyOwnerProgressLabel {
  if (status === 'ready') return 'ready_to_prepare'
  if (status === 'retrieving') return 'checking_guidance'
  if (status === 'queued') return 'organizing_plan'
  if (status === 'generating') return 'writing_draft'
  if (status === 'validating') return 'checking_plan'
  if (status === 'approved') return 'approved'
  if (status === 'draft') return 'ready'
  if (status === 'failed') return 'failed'
  if (status === 'rejected') return 'revision_needed'
  return 'needs_choices'
}

export type StrategyReadinessView = {
  readonly ready: boolean
  readonly blockers: readonly StrategyBlocker[]
}

export function getStrategyReadiness(resource: StrategyResource): StrategyReadinessView {
  const blockers = resource.latest_plan?.blockers ?? []
  return {
    ready: blockers.every((blocker) => blocker.severity !== 'blocking'),
    blockers,
  }
}

export function strategyCanBeApproved(resource: StrategyResource): boolean {
  return resource.status === 'draft' && getStrategyReadiness(resource).ready
}

export type StrategyReadinessItemData = {
  readonly id: string
  readonly labelKey: 'readiness.profile' | 'readiness.objective' | 'readiness.budget'
  readonly state: 'complete' | 'missing' | 'warning'
}

export function getReadinessItems(
  resource: StrategyResource,
  hasProfile: boolean,
): StrategyReadinessItemData[] {
  return [
    { id: 'profile', labelKey: 'readiness.profile', state: hasProfile ? 'complete' : 'missing' },
    { id: 'objective', labelKey: 'readiness.objective', state: resource.brief ? 'complete' : 'missing' },
    {
      id: 'budget',
      labelKey: 'readiness.budget',
      state: resource.latest_plan?.blockers.some((b) => b.severity === 'blocking')
        ? 'missing'
        : 'warning',
    },
  ]
}

import type { StrategyPlan, StrategyPlanV2 } from '@marketmind/contracts'

/**
 * Local, type-only v2 plan guard.
 *
 * Web CI resolves `@marketmind/contracts` from its unbuilt TypeScript source,
 * so runtime value imports from that package cannot be relied on in
 * `apps/web`. The check itself only needs the discriminated `contract_version`
 * field, which is identical to the contracts export.
 */
export function isStrategyPlanV2(
  plan: StrategyPlan | StrategyPlanV2 | null | undefined,
): plan is StrategyPlanV2 {
  return (
    plan !== null
    && plan !== undefined
    && typeof plan === 'object'
    && (plan as StrategyPlanV2).contract_version === 'strategy-v2'
  )
}

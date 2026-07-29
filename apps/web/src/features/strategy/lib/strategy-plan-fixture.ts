import type { StrategyPlan, StrategyResource, SourcedClaim } from '@marketmind/contracts'

type StrategyPlanFixtureInput = {
  readonly idSuffix: string
  readonly brief: NonNullable<StrategyResource['brief']>
  readonly retrievalRunId: string
  readonly blockers: StrategyPlan['blockers']
}

export function createStrategyPlanFixture({
  idSuffix,
  brief,
  retrievalRunId,
  blockers,
}: StrategyPlanFixtureInput): StrategyPlan {
  const claim: SourcedClaim = {
    text: idSuffix,
    source: 'model_synthesis',
    citation_ids: ['77777777-7777-4777-8777-777777777777'],
  }

  return {
    id: `88888888-8888-4888-8888-88888888888${idSuffix === 'draftReady' ? '8' : '9'}`,
    strategy_id: brief.strategy_id,
    version: idSuffix === 'revisionFailed' ? 2 : 1,
    contract_version: 'strategy-v1',
    brief_id: brief.id,
    profile_version: brief.business_profile_version,
    retrieval_run_id: retrievalRunId,
    channel_score_rule_version: 'strategy-channel-score-v1',
    executive_summary: claim,
    situation_diagnosis: claim,
    primary_objective: 'conversion',
    funnel_stage: 'conversion',
    target_audience: claim,
    positioning: claim,
    selected_channels: [],
    all_channel_scores: [],
    tone: claim,
    plan_language: 'ar-EG',
    content_strategy: {
      pillars: [claim],
      format_mix: [claim],
      weekly_cadence: '3 posts per week',
      weeks: [],
      experiments: [],
    },
    budget_mode: brief.external_budget_mode,
    budget_scenarios: null,
    kpi_targets: [],
    assumptions: [claim],
    risks: [claim],
    knowledge_gaps: blockers.map((blocker) => ({
      category: blocker.field ?? blocker.code,
      description: blocker.message,
      severity: blocker.severity === 'blocking' ? 'blocking' : 'non_critical',
    })),
    blockers,
    citations: [
      {
        citation_id: '77777777-7777-4777-8777-777777777777',
        chunk_id: '99999999-9999-4999-8999-999999999999',
        entry_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        entry_version: 1,
        title: 'Reviewed marketing guidance',
        excerpt: 'Use recent owner-confirmed evidence before approving the plan.',
        evidence_tier: 'reviewed_guidance',
        relevance_score: 0.82,
      },
    ],
    created_at: brief.created_at,
  }
}

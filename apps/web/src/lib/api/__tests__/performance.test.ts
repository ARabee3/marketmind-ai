import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  OptimizationDecisionResponseV1,
  OptimizationProposalWorkspaceV1,
  PerformanceOverviewV1,
} from '@marketmind/contracts'
import { apiRequest } from '../client'
import {
  decideOptimizationProposal,
  getOptimizationProposals,
  getPerformanceOverview,
  refreshPerformancePost,
} from '../performance'

vi.mock('../client', () => ({
  apiRequest: vi.fn(),
}))

const mockedApiRequest = vi.mocked(apiRequest)

const OVERVIEW: PerformanceOverviewV1 = {
  contract_version: 'performance-v1',
  business_id: 'a1000000-0000-4000-8000-000000000001',
  provider: 'facebook',
  generated_at: '2026-08-18T12:00:00.000Z',
  posts: [],
  baseline: {
    status: 'not_ready',
    observed_snapshot_count: 0,
    required_snapshot_count: 3,
    reason: 'no_published_posts',
  },
  capability: {
    status: 'blocked',
    blockers: ['no_facebook_connection'],
    last_successful_sync: null,
  },
}

const WORKSPACE: OptimizationProposalWorkspaceV1 = {
  contract_version: 'optimization-v1',
  proposal: {
    contract_version: 'optimization-v1',
    proposal_id: 'a4000000-0000-4000-8000-000000000001',
    business_id: OVERVIEW.business_id,
    strategy_id: 'a4000000-0000-4000-8000-000000000002',
    strategy_version: 2,
    content_cycle_id: 'a4000000-0000-4000-8000-000000000003',
    format_cohort: 'text_post',
    basis_snapshot_ids: [
      'a4000000-0000-4000-8000-000000000004',
      'a4000000-0000-4000-8000-000000000005',
      'a4000000-0000-4000-8000-000000000006',
    ],
    evidence_checksum:
      'b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0',
    deterministic_comparison: [
      {
        metric: 'post_media_view',
        baseline_median: 10,
        values: [5, 10, 20],
        best_snapshot_id: 'a4000000-0000-4000-8000-000000000006',
        best_value: 20,
        delta_from_median: 10,
        delta_percent: 100,
        direction: 'higher_is_better',
      },
    ],
    change_kind: 'hook_style',
    summary: 'Lead with a concrete situation.',
    rationale: 'The strongest observed post used a direct opening.',
    uncertainty: 'Small cohort; no causal claim.',
    instruction: 'Try a concrete situation in one future hook only.',
    model_version: 'mock',
    prompt_version: 'optimization-prompt-v1',
    generation_fingerprint:
      'c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0',
    status: 'PENDING_OWNER_DECISION',
    created_at: '2026-08-18T12:00:00.000Z',
  },
  state: 'PENDING_OWNER_DECISION',
  decision: null,
  instruction: null,
}

const DECISION_RESPONSE: OptimizationDecisionResponseV1 = {
  contract_version: 'optimization-decision-v1',
  workspace: {
    ...WORKSPACE,
    state: 'DISMISSED',
    decision: {
      contract_version: 'optimization-decision-v1',
      decision_id: 'a4000000-0000-4000-8000-000000000007',
      proposal_id: WORKSPACE.proposal.proposal_id,
      business_id: WORKSPACE.proposal.business_id,
      strategy_id: WORKSPACE.proposal.strategy_id,
      strategy_version: WORKSPACE.proposal.strategy_version,
      content_cycle_id: WORKSPACE.proposal.content_cycle_id,
      format_cohort: WORKSPACE.proposal.format_cohort,
      evidence_checksum: WORKSPACE.proposal.evidence_checksum,
      action: 'dismiss',
      owner_user_id: 'a4000000-0000-4000-8000-000000000008',
      request_fingerprint:
        'c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0',
      note: null,
      decided_at: '2026-08-18T12:01:00.000Z',
    },
    instruction: null,
  },
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('performance API adapter', () => {
  afterEach(() => vi.clearAllMocks())

  it('validates and returns the frozen overview contract', async () => {
    mockedApiRequest.mockResolvedValue(response(OVERVIEW))

    await expect(getPerformanceOverview()).resolves.toEqual(OVERVIEW)
    expect(mockedApiRequest).toHaveBeenCalledWith('/performance/facebook/overview', undefined)
  })

  it('fails closed when the API returns a malformed overview', async () => {
    mockedApiRequest.mockResolvedValue(response({ ...OVERVIEW, provider: 'instagram' }))

    await expect(getPerformanceOverview()).rejects.toThrow()
  })

  it('keeps API status and code available for safe retry messaging', async () => {
    mockedApiRequest.mockResolvedValue(
      response({ code: 'PERFORMANCE_PROVIDER_RATE_LIMITED', message: 'wait' }, 429),
    )

    await expect(
      refreshPerformancePost('a1000000-0000-4000-8000-000000000003'),
    ).rejects.toMatchObject({
      status: 429,
      code: 'PERFORMANCE_PROVIDER_RATE_LIMITED',
    })
  })

  it('validates proposal workspaces and owner decision responses', async () => {
    mockedApiRequest
      .mockResolvedValueOnce(response([WORKSPACE]))
      .mockResolvedValueOnce(response(DECISION_RESPONSE))

    await expect(getOptimizationProposals()).resolves.toEqual([WORKSPACE])
    await expect(
      decideOptimizationProposal(WORKSPACE.proposal.proposal_id, {
        action: 'dismiss',
        evidence_checksum: WORKSPACE.proposal.evidence_checksum,
        idempotency_key: 'optimization-test-1',
      }),
    ).resolves.toEqual(DECISION_RESPONSE)
    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      2,
      `/performance/optimization/proposals/${WORKSPACE.proposal.proposal_id}/decisions`,
      expect.objectContaining({ method: 'POST', body: expect.any(Object) }),
    )
  })
})

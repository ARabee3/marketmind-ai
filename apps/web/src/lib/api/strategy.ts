import type {
  OwnerDecision,
  StrategyPlan,
  StrategyPlanV2,
  StrategyProgressEvent,
  StrategyStatus,
  StrategyResource,
  StrategyBrief,
  StrategyBriefV2,
  StrategyVersionSummary,
  RetrievedKnowledgePack,
} from '@marketmind/contracts'
import { apiRequest, type ApiRequestOptions } from '@/lib/api/client'

export interface ApiError {
  status: number
  code: string
  message: string
}

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const res = await apiRequest(path, init)

  if (!res.ok) {
    let code = 'api_error'
    let message = res.statusText
    try {
      const body = await res.json()
      code = body?.code ?? body?.error?.code ?? code
      message = body?.message ?? body?.error?.message ?? message
    } catch {
      // ignore
    }
    const err: ApiError = { status: res.status, code, message }
    throw err
  }

  return res.json() as Promise<T>
}

export interface UpsertBriefPayload {
  businessProfileVersionId: string
  primaryObjective: string
  startDate: string
  planLanguage: 'ar-EG' | 'en' | 'mixed'
  paidMediaAllowed: boolean
  externalBudgetMode: string
  externalBudgetEgpAmount?: number
  externalBudgetEgpRange?: { min_egp?: number; max_egp?: number }
  teamCapacity?: string
  /** strategy-v2 only: plain-language weekly-capacity preset. */
  weeklyCapacity?: string
  weeklyCapacityNote?: string
  /** strategy-v2 only: owner-selected channels (1-3, exactly one primary). */
  channelChoices?: ChannelChoicePayload[]
  constraints?: string
  clarificationAnswers?: {
    question_id: string
    question_text: string
    answer_text: string
    answered_at: string
  }[]
}

export interface ChannelChoicePayload {
  channel: string
  role: 'primary' | 'supporting'
  setupState: 'connected' | 'existing_link' | 'setup_later'
  publicUrl?: string
  publishingTargetId?: string
  note?: string
}

export interface OwnerDecisionPayload {
  versionId: string
  action: 'approve' | 'reject' | 'revision_requested'
  feedback?: string
}

export interface StrategyApiResponse {
  id: string
  businessId: string
  status: string
  ownerUserId: string
  currentVersionId: string | null
  createdAt: string
  updatedAt: string
  brief: BriefApiResponse | null
  latestPlan: StrategyPlan | StrategyPlanV2 | null
}

export function toStrategyResource(api: StrategyApiResponse): StrategyResource {
  return {
    strategy_id: api.id,
    status: api.status as StrategyStatus,
    brief: api.brief ? buildContractBrief(api.brief) : null,
    latest_plan: api.latestPlan ?? null,
  }
}

function buildContractBrief(
  api: BriefApiResponse,
): StrategyBrief | StrategyBriefV2 {
  const base = {
    id: api.id,
    strategy_id: api.strategyId,
    business_profile_version: {
      business_profile_version_id: api.businessProfileVersionId,
      confirmed_at: api.businessProfileVersion.confirmedAt,
      version: api.businessProfileVersion.version,
    },
    primary_objective: api.primaryObjective as StrategyBrief['primary_objective'],
    start_date: api.startDate,
    plan_language: api.planLanguage as StrategyBrief['plan_language'],
    paid_media_allowed: api.paidMediaAllowed,
    external_budget_mode: api.externalBudgetMode as StrategyBrief['external_budget_mode'],
    external_budget_egp: api.externalBudgetEgp as StrategyBrief['external_budget_egp'],
    constraints: typeof api.constraints === 'string' ? [api.constraints] : (api.constraints ?? []),
    clarification_answers: [],
    created_at: api.createdAt,
    updated_at: api.updatedAt,
  }
  if (Array.isArray(api.channelChoices) && api.channelChoices.length > 0) {
    return {
      ...base,
      weekly_capacity: (api.weeklyCapacity ?? 'one_to_two_hours') as StrategyBriefV2['weekly_capacity'],
      weekly_capacity_note: api.weeklyCapacityNote ?? undefined,
      channel_choices: api.channelChoices.map((choice) => ({
        channel: choice.channel as StrategyBriefV2['channel_choices'][number]['channel'],
        role: choice.role as 'primary' | 'supporting',
        setup_state: (choice.setupState ?? choice.setup_state) as StrategyBriefV2['channel_choices'][number]['setup_state'],
        ...((choice.publicUrl ?? choice.public_url)
          ? { public_url: choice.publicUrl ?? choice.public_url }
          : {}),
        ...((choice.publishingTargetId ?? choice.publishing_target_id)
          ? {
              publishing_target_id:
                choice.publishingTargetId ?? choice.publishing_target_id,
            }
          : {}),
        ...(choice.note ? { note: choice.note } : {}),
      })),
    } satisfies StrategyBriefV2
  }
  return {
    ...base,
    team_capacity: api.teamCapacity ?? '',
  } satisfies StrategyBrief
}

export interface BriefApiResponse {
  id: string
  strategyId: string
  businessProfileVersionId: string
  businessProfileVersion: {
    id: string
    confirmedAt: string
    version: number
  }
  primaryObjective: string
  startDate: string
  planLanguage: string
  paidMediaAllowed: boolean
  externalBudgetMode: string
  externalBudgetEgp: unknown
  teamCapacity: string | null
  weeklyCapacity?: string | null
  weeklyCapacityNote?: string | null
  channelChoices?: Array<{
    channel: string
    role: string
    setupState: string
    publicUrl?: string
    publishingTargetId?: string
    setup_state?: string
    public_url?: string
    publishing_target_id?: string
    note?: string
  }> | null
  constraints: string | null
  clarificationAnswers: unknown
  createdAt: string
  updatedAt: string
}

export function createStrategy(businessProfileVersionId: string): Promise<StrategyApiResponse> {
  return request<StrategyApiResponse>('/strategies', {
    method: 'POST',
    body: JSON.stringify({ businessProfileVersionId }),
  })
}

export function upsertBrief(id: string, payload: UpsertBriefPayload): Promise<BriefApiResponse> {
  return request<BriefApiResponse>(`/strategies/${id}/brief`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function generateStrategy(id: string): Promise<{ status: string; correlationId: string }> {
  return request(`/strategies/${id}/generate`, { method: 'POST' })
}

export function getStrategy(id: string): Promise<StrategyApiResponse> {
  return request<StrategyApiResponse>(`/strategies/${id}`)
}

export function getStrategyVersions(
  id: string,
): Promise<StrategyVersionSummary[]> {
  return request<StrategyVersionSummary[]>(`/strategies/${id}/versions`)
}

export function getStrategyProgress(id: string): Promise<StrategyProgressEvent[]> {
  return request<StrategyProgressEvent[]>(`/strategies/${id}/progress`)
}

export function getStrategyRetrieval(id: string): Promise<RetrievedKnowledgePack> {
  return request<RetrievedKnowledgePack>(`/strategies/${id}/retrieval`)
}

export function getStrategyVersion(
  id: string,
  version: number,
): Promise<StrategyPlan> {
  return request<StrategyPlan>(`/strategies/${id}/versions/${version}`)
}

export function submitDecision(
  id: string,
  payload: OwnerDecisionPayload,
): Promise<{ decision: OwnerDecision; nextStatus?: string }> {
  return request(`/strategies/${id}/decisions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function retryStrategy(id: string): Promise<{ status: string }> {
  return request(`/strategies/${id}/retry`, { method: 'POST' })
}

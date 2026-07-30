import type {
  OwnerDecision,
  StrategyPlan,
  StrategyProgressEvent,
  StrategyStatus,
  StrategyResource,
  StrategyBrief,
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
  teamCapacity: string
  constraints?: string
  clarificationAnswers?: {
    question_id: string
    question_text: string
    answer_text: string
    answered_at: string
  }[]
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
  latestPlan: StrategyPlan | null
}

export function toStrategyResource(api: StrategyApiResponse): StrategyResource {
  return {
    strategy_id: api.id,
    status: api.status as StrategyStatus,
    brief: api.brief
      ? {
          id: api.brief.id,
          strategy_id: api.brief.strategyId,
          business_profile_version: {
            business_profile_version_id: api.brief.businessProfileVersionId,
            confirmed_at: api.brief.businessProfileVersion.confirmedAt,
            version: api.brief.businessProfileVersion.version,
          },
          primary_objective: api.brief.primaryObjective as StrategyBrief['primary_objective'],
          start_date: api.brief.startDate,
          plan_language: api.brief.planLanguage as StrategyBrief['plan_language'],
          paid_media_allowed: api.brief.paidMediaAllowed,
          external_budget_mode: api.brief.externalBudgetMode as StrategyBrief['external_budget_mode'],
          external_budget_egp: api.brief.externalBudgetEgp as StrategyBrief['external_budget_egp'],
          team_capacity: api.brief.teamCapacity,
          constraints: typeof api.brief.constraints === 'string' ? [api.brief.constraints] : (api.brief.constraints ?? []),
          clarification_answers: [],
          created_at: api.brief.createdAt,
          updated_at: api.brief.updatedAt,
        }
      : null,
    latest_plan: api.latestPlan ?? null,
  }
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
  teamCapacity: string
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

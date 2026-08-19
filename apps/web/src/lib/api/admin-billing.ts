import { apiRequest, type ApiRequestOptions } from "./client"

export type BillingAccountRow = {
  id: string
  ownerUserId: string
  ownerEmail: string | null
  ownerFullName: string | null
  status: string
  pausedReason: string | null
  pausedAt: string | null
  createdAt: string
}

export type BillingAccountListResponse = {
  items: BillingAccountRow[]
  total: number
  page: number
  pageSize: number
}

export type CostAlert = {
  billingAccountId: string
  ownerEmail: string | null
  ownerFullName: string | null
  billingPeriodStart: string
  totalEgpCost: number | null
  artifactCount: number
  highRetryArtifacts: number
  reason: string
}

export type CostAlertSummary = {
  alerts: CostAlert[]
  cohort95thPercentileEgp: number | null
  totalAccountsAboveEgp50: number
  totalHighRetryArtifacts: number
}

export type ReconciliationMismatch = {
  billingAccountId: string
  ownerEmail: string | null
  mismatchType:
    | "succeeded_attempt_no_transaction"
    | "processed_event_no_transaction"
    | "transaction_no_event"
  attemptId: string | null
  eventId: string | null
  transactionId: string | null
  providerCheckoutRef: string | null
  occurredAt: string | null
}

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const response = await apiRequest(path, init)
  if (!response.ok) {
    throw Object.assign(new Error("Admin billing request failed"), {
      status: response.status,
    })
  }
  return (await response.json()) as T
}

export async function listBillingAccounts(
  params: { page?: number; pageSize?: number; search?: string; status?: string } = {},
): Promise<BillingAccountListResponse> {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))
  if (params.search) searchParams.set("search", params.search)
  if (params.status) searchParams.set("status", params.status)

  const qs = searchParams.toString()
  return request(`/admin/billing/accounts${qs ? `?${qs}` : ""}`)
}

export function pauseBillingAccount(
  id: string,
  reason: string,
): Promise<BillingAccountRow> {
  return request(`/admin/billing/accounts/${id}/pause`, {
    method: "POST",
    body: { reason },
  })
}

export function resumeBillingAccount(
  id: string,
): Promise<BillingAccountRow> {
  return request(`/admin/billing/accounts/${id}/resume`, {
    method: "POST",
  })
}

export function listBillingCostAlerts(): Promise<CostAlertSummary> {
  return request("/admin/billing/cost-alerts")
}

export function listBillingReconciliationMismatches(): Promise<
  ReconciliationMismatch[]
> {
  return request("/admin/billing/reconciliation")
}

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

export type WalletOverview = {
  totalAccounts: number
  activeAccounts: number
  pausedAccounts: number
  totalPointsOutstanding: number
  totalLifetimeGranted: number
  totalLifetimeSpent: number
  totalTopUpEgp: number
  totalTopUpCount: number
}

export type WalletBalanceRow = {
  accountId: string
  ownerUserId: string
  ownerEmail: string | null
  ownerFullName: string | null
  status: string
  balance: number
  lifetimeGranted: number
  lifetimeSpent: number
  createdAt: string
}

export type WalletBalanceListResponse = {
  items: WalletBalanceRow[]
  total: number
  page: number
  pageSize: number
}

export type WalletLedgerRow = {
  id: string
  direction: string
  reason: string
  metric: string | null
  points: number
  balanceAfter: number
  claimKey: string
  expiresAt: string | null
  createdAt: string
}

export type WalletTransactionRow = {
  id: string
  accountId: string
  ownerEmail: string | null
  ownerFullName: string | null
  provider: string
  providerTransactionId: string
  kind: string
  status: string
  amountEgp: number
  currency: string
  paymentMode: string | null
  occurredAt: string
}

export type WalletTransactionListResponse = {
  items: WalletTransactionRow[]
  total: number
  page: number
  pageSize: number
}

export function getWalletOverview(): Promise<WalletOverview> {
  return request("/admin/billing/wallets/overview")
}

export function listWalletBalances(
  params: { page?: number; pageSize?: number; search?: string; status?: string } = {},
): Promise<WalletBalanceListResponse> {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))
  if (params.search) searchParams.set("search", params.search)
  if (params.status) searchParams.set("status", params.status)

  const qs = searchParams.toString()
  return request(`/admin/billing/wallets${qs ? `?${qs}` : ""}`)
}

export function getWalletLedger(accountId: string): Promise<WalletLedgerRow[]> {
  return request(`/admin/billing/wallets/${accountId}/ledger`)
}

export function listWalletTransactions(
  params: { page?: number; pageSize?: number } = {},
): Promise<WalletTransactionListResponse> {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))

  const qs = searchParams.toString()
  return request(`/admin/billing/transactions${qs ? `?${qs}` : ""}`)
}

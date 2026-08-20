import { apiRequest, type ApiRequestOptions } from "./client"

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const response = await apiRequest(path, init)
  if (!response.ok) {
    throw Object.assign(new Error("Admin billing request failed"), {
      status: response.status,
    })
  }
  return (await response.json()) as T
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

export type TopUpWalletResult = {
  balance: number
  lifetimeGranted: number
}

export function topUpWallet(
  accountId: string,
  points: number,
  reason: string,
): Promise<TopUpWalletResult> {
  return request(`/admin/billing/wallets/${accountId}/top-up`, {
    method: "POST",
    body: { points, reason },
  })
}

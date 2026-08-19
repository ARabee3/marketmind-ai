import { apiRequest } from "./client"

export type AdminUserRow = {
  id: string
  fullName: string | null
  email: string
  isEmailVerified: boolean
  roles: string[]
  loginMethod: string
  status: string
  createdAt: string
  lastLoginAt: string | null
  businessCount: number
  activeSessionCount: number
}

export type AdminPaginatedResponse<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type AdminFederatedIdentity = {
  id: string
  provider: string
  displayName: string | null
  email: string | null
}

export type AdminActiveSession = {
  id: string
  userAgent: string | null
  ipAddress: string | null
  expiresAt: string
  createdAt: string
}

export type AdminBusiness = {
  id: string
  displayName: string
  status: string
  createdAt: string
}

export type AdminUserDetail = {
  user: AdminUserRow
  federatedIdentities: AdminFederatedIdentity[]
  activeSessions: AdminActiveSession[]
  businesses: AdminBusiness[]
}

export type AdminRevenueSummary = {
  activeBusinesses: number
  activeSubscriptions: number
  trialingCount: number
  mrrEgp: number
  pastDueSubscriptions: number
  expiredSubscriptions: number
  unverifiedUsers: number
}

export type AdminSubscriptionRow = {
  id: string
  state: string
  paidThroughAt: string | null
  createdAt: string
  ownerEmail: string
  ownerName: string | null
  priceDisplayNameEn: string
  priceDisplayNameAr: string
  planCode: string
  amountEgp: number
  interval: string
}

export type GetUsersParams = {
  page?: number
  pageSize?: number
  search?: string
  verified?: boolean
}

export async function getAdminUsers(
  params: GetUsersParams = {},
): Promise<AdminPaginatedResponse<AdminUserRow>> {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))
  if (params.search) searchParams.set("search", params.search)
  if (params.verified !== undefined) {
    searchParams.set("verified", String(params.verified))
  }

  const qs = searchParams.toString()
  const response = await apiRequest(`/admin/users${qs ? `?${qs}` : ""}`)
  if (!response.ok) {
    throw Object.assign(new Error("Failed to fetch users"), {
      status: response.status,
    })
  }
  return response.json()
}

export async function getAdminUser(
  id: string,
): Promise<AdminUserDetail> {
  const response = await apiRequest(`/admin/users/${id}`)
  if (!response.ok) {
    throw Object.assign(new Error("Failed to fetch user"), {
      status: response.status,
    })
  }
  return response.json()
}

export async function getAdminRevenueSummary(): Promise<AdminRevenueSummary> {
  const response = await apiRequest("/admin/revenue/summary")
  if (!response.ok) {
    throw Object.assign(new Error("Failed to fetch revenue summary"), {
      status: response.status,
    })
  }
  return response.json()
}

export async function getAdminSubscriptions(
  page = 1,
  pageSize = 20,
  state?: string,
): Promise<AdminPaginatedResponse<AdminSubscriptionRow>> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (state) query.set("state", state)
  const response = await apiRequest(`/admin/subscriptions?${query.toString()}`)
  if (!response.ok) {
    throw Object.assign(new Error("Failed to fetch subscriptions"), {
      status: response.status,
    })
  }
  return response.json()
}

export type AdminAuditRow = {
  id: string
  actorUserId: string
  actorEmail: string | null
  action: string
  targetType: string
  targetId: string | null
  reason: string | null
  beforeState: unknown
  afterState: unknown
  createdAt: string
}

export type GetAdminAuditParams = {
  page?: number
  pageSize?: number
  actor?: string
  action?: string
  from?: string
  to?: string
}

export async function getAdminAudit(
  params: GetAdminAuditParams = {},
): Promise<AdminPaginatedResponse<AdminAuditRow>> {
  const searchParams = new URLSearchParams()
  if (params.page) searchParams.set("page", String(params.page))
  if (params.pageSize) searchParams.set("pageSize", String(params.pageSize))
  if (params.actor) searchParams.set("actor", params.actor)
  if (params.action) searchParams.set("action", params.action)
  if (params.from) searchParams.set("from", params.from)
  if (params.to) searchParams.set("to", params.to)

  const qs = searchParams.toString()
  const response = await apiRequest(`/admin/audit${qs ? `?${qs}` : ""}`)
  if (!response.ok) {
    throw Object.assign(new Error("Failed to fetch audit logs"), {
      status: response.status,
    })
  }
  return response.json()
}

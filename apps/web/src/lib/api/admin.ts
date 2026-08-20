import { apiRequest } from "./client"

export type AdminUserRow = {
  id: string
  fullName: string | null
  email: string
  isEmailVerified: boolean
  roles: string[]
  loginMethod: string
  status: string
  suspensionReason?: string | null
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
  role?: string
  status?: string
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
  if (params.role) searchParams.set("role", params.role)
  if (params.status) searchParams.set("status", params.status)

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

export type UpdateAdminUserPayload = {
  status?: "ACTIVE" | "SUSPENDED" | "DISABLED"
  roles?: string[]
  reason?: string
}

export type UpdateAdminUserResult = {
  id: string
  email: string
  fullName: string | null
  roles: string[]
  status: string
  suspensionReason?: string | null
  isEmailVerified: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export async function updateAdminUser(
  id: string,
  payload: UpdateAdminUserPayload,
): Promise<UpdateAdminUserResult> {
  const response = await apiRequest(`/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw Object.assign(new Error("Failed to update user"), {
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

/**
 * Shared API base configuration.
 *
 * NEXT_PUBLIC_API_URL should include the full API path prefix, e.g.
 * http://localhost:3001/api/v1. This keeps Auth and Discovery on the same
 * contract and avoids silent fallback drift between modules.
 */
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'

export const API_BASE_URL = rawApiUrl.replace(/\/$/, '')

/**
 * WebSocket base URL derived from the API base by stripping the /api/v1 suffix.
 * Used for Socket.IO connections to the realtime gateway.
 */
export const WS_BASE_URL = API_BASE_URL.replace(/\/api\/v1\/?$/, '')

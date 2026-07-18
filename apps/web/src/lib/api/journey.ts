import type { CurrentJourneyResponse, ErrorCode } from '@marketmind/contracts'
import { apiRequest } from '@/lib/api/client'

export interface JourneyApiError {
  status: number
  code: ErrorCode | string
  message: string
}

export async function getCurrentJourney(): Promise<CurrentJourneyResponse> {
  const response = await apiRequest('/journey/current')

  if (!response.ok) {
    throw await journeyApiError(response)
  }

  return response.json() as Promise<CurrentJourneyResponse>
}

async function journeyApiError(response: Response): Promise<JourneyApiError> {
  let code: ErrorCode | string = 'api_error'
  let message = response.statusText

  try {
    const body = await response.json()
    code = body?.code ?? body?.error?.code ?? code
    message = body?.message ?? body?.error?.message ?? message
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) {
      throw error
    }
  }

  return { status: response.status, code, message }
}

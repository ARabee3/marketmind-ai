/**
 * Maps stable backend error codes to translation keys.
 *
 * The backend is expected to return errors in the shape:
 *   { code: 'INVALID_CREDENTIALS' | 'EMAIL_EXISTS' | ... }
 *
 * Unknown codes fall back to a generic message so the UI never leaks raw
 * server text or invents copy.
 */

export type BackendErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_EXISTS'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'

export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorLoginFailed',
): 'errorInvalidCredentials' | 'errorLoginFailed'
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorRegistrationFailed',
): 'errorEmailExists' | 'errorRegistrationFailed'
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorLoginFailed' | 'errorRegistrationFailed',
):
  | 'errorInvalidCredentials'
  | 'errorEmailExists'
  | 'errorLoginFailed'
  | 'errorRegistrationFailed' {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'errorInvalidCredentials'
    case 'EMAIL_EXISTS':
      return 'errorEmailExists'
    default:
      return fallback
  }
}

export async function parseBackendErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    const data = (await response.json()) as { code?: string }
    return data.code
  } catch {
    return undefined
  }
}

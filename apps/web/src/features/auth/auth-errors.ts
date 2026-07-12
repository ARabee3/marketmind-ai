/**
 * Maps stable backend error codes to translation keys.
 *
 * The backend is expected to return errors in the shape:
 *   { code: 'INVALID_CREDENTIALS' | 'EMAIL_EXISTS' | ... }
 * or, defensively, the contract envelope:
 *   { error: { code: '...', message: '...' } }
 *
 * Unknown codes fall back to a generic message so the UI never leaks raw
 * server text or invents copy.
 */

export type BackendErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_EXISTS'
  | 'EMAIL_NOT_VERIFIED'
  | 'VALIDATION_ERROR'
  | 'SERVER_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'ACTION_TOKEN_INVALID'
  | 'ACTION_TOKEN_CONSUMED'
  | 'ACTION_TOKEN_EXPIRED'
  | 'MAIL_DELIVERY_FAILED'

/** Translation keys the auth forms may resolve to, grouped by flow. */
export type LoginErrorKey =
  | 'errorInvalidCredentials'
  | 'errorEmailNotVerified'
  | 'errorLoginFailed'

export type RegistrationErrorKey =
  | 'errorEmailExists'
  | 'errorRegistrationFailed'

export type ForgotPasswordErrorKey =
  | 'errorRateLimited'
  | 'errorRecoveryFailed'

export type ResetPasswordErrorKey =
  | 'errorTokenExpired'
  | 'errorTokenInvalid'
  | 'errorTokenConsumed'
  | 'errorRateLimited'
  | 'errorResetFailed'

export type VerifyEmailErrorKey =
  | 'errorTokenExpired'
  | 'errorTokenInvalid'
  | 'errorTokenConsumed'
  | 'errorRateLimited'
  | 'errorVerifyFailed'

export type ResendVerificationErrorKey =
  | 'errorRateLimited'
  | 'errorResendFailed'

export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorLoginFailed',
): LoginErrorKey
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorRegistrationFailed',
): RegistrationErrorKey
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorRecoveryFailed',
): ForgotPasswordErrorKey
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorResetFailed',
): ResetPasswordErrorKey
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorVerifyFailed',
): VerifyEmailErrorKey
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback: 'errorResendFailed',
): ResendVerificationErrorKey
export function mapBackendErrorToKey(
  code: string | undefined,
  fallback:
    | 'errorLoginFailed'
    | 'errorRegistrationFailed'
    | 'errorRecoveryFailed'
    | 'errorResetFailed'
    | 'errorVerifyFailed'
    | 'errorResendFailed',
):
  | LoginErrorKey
  | RegistrationErrorKey
  | ForgotPasswordErrorKey
  | ResetPasswordErrorKey
  | VerifyEmailErrorKey
  | ResendVerificationErrorKey {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'errorInvalidCredentials'
    case 'EMAIL_NOT_VERIFIED':
      return 'errorEmailNotVerified'
    case 'EMAIL_EXISTS':
      return 'errorEmailExists'
    case 'RATE_LIMIT_EXCEEDED':
      return 'errorRateLimited'
    case 'ACTION_TOKEN_EXPIRED':
      return 'errorTokenExpired'
    case 'ACTION_TOKEN_INVALID':
      return 'errorTokenInvalid'
    case 'ACTION_TOKEN_CONSUMED':
      return 'errorTokenConsumed'
    default:
      return fallback
  }
}

export async function parseBackendErrorCode(
  response: Response,
): Promise<string | undefined> {
  try {
    const data = (await response.json()) as
      | { code?: string }
      | { error?: { code?: string } }
      | undefined
    if (data && typeof data === 'object') {
      if ('code' in data && typeof data.code === 'string') return data.code
      if (
        'error' in data &&
        data.error &&
        typeof data.error.code === 'string'
      ) {
        return data.error.code
      }
    }
    return undefined
  } catch {
    return undefined
  }
}
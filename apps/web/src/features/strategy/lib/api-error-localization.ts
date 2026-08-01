/**
 * Maps Strategy-facing API errors to typed translation keys, mirroring the
 * Discovery error-localization contract. Stable codes map directly; unknown
 * codes fall back by HTTP status to typed generic keys so the user never sees
 * raw server text (e.g. Prisma "Internal Server Error").
 */

import type { TranslationKey } from '@/i18n/types'
import type { ApiError } from '@/lib/api/strategy'

const STRATEGY_ERROR_CODE_TO_TRANSLATION: Partial<Record<string, TranslationKey>> = {
  INVALID_CREDENTIALS: 'Errors.unauthorized',
  EMAIL_EXISTS: 'Errors.generic',
  VALIDATION_ERROR: 'Errors.validationError',
  STALE_PROFILE: 'Errors.validationError',
  STRATEGY_RATE_LIMITED: 'Errors.generic',
  STRATEGY_NOT_FOUND: 'Errors.notFound',
}

export function getStrategyErrorTranslationKey(err: ApiError): TranslationKey {
  const known = STRATEGY_ERROR_CODE_TO_TRANSLATION[err.code]
  if (known) return known

  if (err.status >= 400 && err.status < 500) {
    if (err.status === 401) return 'Errors.unauthorized'
    if (err.status === 403) return 'Errors.forbidden'
    if (err.status === 404) return 'Errors.notFound'
    if (err.status === 422) return 'Errors.validationError'
    return 'Errors.generic'
  }

  if (err.status >= 500) {
    return 'Errors.serverError'
  }

  return 'Errors.networkError'
}

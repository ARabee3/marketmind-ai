import { describe, expect, it } from 'vitest'
import { getStrategyErrorTranslationKey } from '../lib/api-error-localization'
import type { ApiError } from '@/lib/api/strategy'

function err(overrides: Partial<ApiError> = {}): ApiError {
  return { status: 500, code: 'SERVER_ERROR', message: 'boom', ...overrides }
}

describe('getStrategyErrorTranslationKey', () => {
  it('maps known strategy codes to their translation keys', () => {
    expect(getStrategyErrorTranslationKey(err({ code: 'VALIDATION_ERROR', status: 400 }))).toBe('Errors.validationError')
    expect(getStrategyErrorTranslationKey(err({ code: 'STRATEGY_NOT_FOUND', status: 404 }))).toBe('Errors.notFound')
    expect(getStrategyErrorTranslationKey(err({ code: 'STALE_PROFILE', status: 409 }))).toBe('Errors.validationError')
    expect(getStrategyErrorTranslationKey(err({ code: 'STRATEGY_VERSION_CONFLICT', status: 409 }))).toBe('Errors.strategyVersionConflict')
  })

  it('never surfaces the raw server message for unknown 5xx errors', () => {
    expect(getStrategyErrorTranslationKey(err({ code: 'PRISMA_BOOM', status: 500 }))).toBe('Errors.serverError')
  })

  it('falls back by HTTP status for unknown codes', () => {
    expect(getStrategyErrorTranslationKey(err({ code: 'X', status: 401 }))).toBe('Errors.unauthorized')
    expect(getStrategyErrorTranslationKey(err({ code: 'X', status: 403 }))).toBe('Errors.forbidden')
    expect(getStrategyErrorTranslationKey(err({ code: 'X', status: 404 }))).toBe('Errors.notFound')
    expect(getStrategyErrorTranslationKey(err({ code: 'X', status: 422 }))).toBe('Errors.validationError')
    expect(getStrategyErrorTranslationKey(err({ code: 'X', status: 400 }))).toBe('Errors.generic')
  })

  it('maps transport-level failures to the network error key', () => {
    expect(getStrategyErrorTranslationKey(err({ status: 0, code: 'NETWORK' }))).toBe('Errors.networkError')
  })
})

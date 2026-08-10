import { describe, expect, it } from 'vitest'
import {
  isGuestOnlyPath,
  isWorkspacePath,
  safeWorkspaceReturnPath,
} from '../route-policy'

describe('route policy', () => {
  it.each([
    '/dashboard',
    '/en/discovery/new',
    '/ar/strategy/strategy-1/review',
    '/content/cycle-1/studio',
    '/en/publishing',
    '/ar/billing',
    '/en/connections',
  ])('classifies %s as a workspace route', (pathname) => {
    expect(isWorkspacePath(pathname)).toBe(true)
  })

  it.each(['/en', '/ar/login', '/register', '/en/oauth/callback', '/en/dashboard-preview'])(
    'does not classify %s as a workspace route',
    (pathname) => {
      expect(isWorkspacePath(pathname)).toBe(false)
    },
  )

  it.each([
    '/login',
    '/en/register',
    '/ar/forgot-password',
    '/resend-verification',
    '/en/auth',
  ])('classifies %s as a guest-only route', (pathname) => {
    expect(isGuestOnlyPath(pathname)).toBe(true)
  })

  it.each(['/en/reset-password', '/ar/verify-email', '/oauth/callback', '/en'])(
    'keeps callback, recovery, and landing route %s outside the guest-only policy',
    (pathname) => {
      expect(isGuestOnlyPath(pathname)).toBe(false)
    },
  )

  it('normalizes safe post-login workspace destinations', () => {
    expect(safeWorkspaceReturnPath('/en/content/cycle-1/studio?week=2')).toBe(
      '/content/cycle-1/studio?week=2',
    )
    expect(safeWorkspaceReturnPath('/ar/dashboard')).toBe('/dashboard')
  })

  it.each([
    null,
    '',
    'https://example.com',
    '//example.com/dashboard',
    '/\\example.com/dashboard',
    '/en/login',
    '/en/not-a-workspace',
  ])('rejects unsafe post-login destination %s', (value) => {
    expect(safeWorkspaceReturnPath(value)).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { signInWithGoogle } from '../google-auth'
import { API_BASE_URL } from '@/lib/api/config'

describe('signInWithGoogle', () => {
  let assignedHref: string | undefined

  beforeEach(() => {
    assignedHref = undefined
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        set href(value: string) {
          assignedHref = value
        },
        get href() {
          return assignedHref ?? ''
        },
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('navigates the browser to the backend Google OAuth endpoint', () => {
    signInWithGoogle()

    expect(assignedHref).toBe(`${API_BASE_URL}/auth/google`)
  })

  it('does not use fetch', () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    )

    signInWithGoogle()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

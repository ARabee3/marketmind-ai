import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { getCurrentJourney } from '@/lib/api/journey'
import { DiscoveryEntryGate } from '../discovery-entry-gate'

const mockRouterReplace = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn() }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/api/journey', () => ({
  getCurrentJourney: vi.fn(),
}))

vi.mock('../intake-form', () => ({
  IntakeForm: () => <div>INTAKE_FORM_RENDERED</div>,
}))

const SESSION_ID = '11111111-1111-4111-8111-111111111111'

function journeyWith(state: string, sessionId: string | null = SESSION_ID) {
  return {
    owner: { user_id: 'u1', full_name: null, email: 'o@e.com', email_verified: true },
    journey: {
      state,
      discovery: sessionId
        ? { session_id: sessionId, status: 'confirmed', language_mode: 'en', business_summary: {}, readiness: {}, profile_draft_id: null, confirmed_profile_version_id: null, updated_at: '', completed_at: null }
        : null,
      profile: state === 'discovery_confirmed' ? { business_profile_version_id: 'v1', business_id: 'b1', version: 1, business_name: 'Cafe', business_type: 'Cafe', city: 'Cairo', area: null, confirmed_at: '' } : null,
    },
    future_phase: { phase: 'strategy', availability: 'locked', status: 'needs_brief', reason: 'discovery_required', destination: null },
    primary_action: { type: 'start_discovery', destination: '/discovery/new' },
    generated_at: '',
  } as never
}

describe('DiscoveryEntryGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCurrentJourney).mockResolvedValue(journeyWith('no_journey', null))
  })

  it('redirects a confirmed user to their saved discovery result', async () => {
    vi.mocked(getCurrentJourney).mockResolvedValueOnce(journeyWith('discovery_confirmed'))

    render(<DiscoveryEntryGate />)

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith(`/discovery/${SESSION_ID}`)
    })
    expect(screen.queryByText('INTAKE_FORM_RENDERED')).toBeNull()
  })

  it('redirects a user with an active session to continue it', async () => {
    vi.mocked(getCurrentJourney).mockResolvedValueOnce(journeyWith('discovery_active'))

    render(<DiscoveryEntryGate />)

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith(`/discovery/${SESSION_ID}`)
    })
    expect(screen.queryByText('INTAKE_FORM_RENDERED')).toBeNull()
  })

  it('redirects a user awaiting profile review to their session', async () => {
    vi.mocked(getCurrentJourney).mockResolvedValueOnce(journeyWith('discovery_summary_review'))

    render(<DiscoveryEntryGate />)

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith(`/discovery/${SESSION_ID}`)
    })
  })

  it('shows the intake form for a new user with no journey', async () => {
    vi.mocked(getCurrentJourney).mockResolvedValueOnce(journeyWith('no_journey', null))

    render(<DiscoveryEntryGate />)

    expect(await screen.findByText('INTAKE_FORM_RENDERED')).toBeDefined()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })

  it('shows the intake form for a failed/cancelled user without a profile', async () => {
    vi.mocked(getCurrentJourney).mockResolvedValueOnce(journeyWith('discovery_unavailable'))

    render(<DiscoveryEntryGate />)

    expect(await screen.findByText('INTAKE_FORM_RENDERED')).toBeDefined()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })

  it('falls back to the intake form when the journey cannot be loaded', async () => {
    vi.mocked(getCurrentJourney).mockRejectedValueOnce(new Error('network'))

    render(<DiscoveryEntryGate />)

    expect(await screen.findByText('INTAKE_FORM_RENDERED')).toBeDefined()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })
})

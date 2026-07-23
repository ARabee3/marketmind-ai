import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntakeForm } from '../intake-form'
import { startDiscovery } from '@/lib/api/discovery'

const mockRouterPush = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

// Mock useTranslations to just return the key
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/api/discovery', () => ({
  startDiscovery: vi.fn(),
}))

describe('IntakeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates required fields', async () => {
    render(<IntakeForm />)
    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))

    // First missing field is business name
    expect(await screen.findByText('DiscoveryIntake.validationNameRequired')).toBeDefined()
    expect(startDiscovery).not.toHaveBeenCalled()
  })

  it('validates URLs', async () => {
    render(<IntakeForm />)

    // Fill required
    fireEvent.change(screen.getByPlaceholderText('businessNamePlaceholder'), { target: { value: 'Test' } })
    fireEvent.change(screen.getByPlaceholderText('businessTypePlaceholder'), { target: { value: 'Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('cityPlaceholder'), { target: { value: 'Cairo' } })

    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))
    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))

    // Add invalid social link
    fireEvent.click(screen.getByRole('button', { name: 'addSocialLink' }))
    const urlInput = await screen.findByPlaceholderText('socialLinkUrlPlaceholder')
    fireEvent.change(urlInput, { target: { value: 'invalid-url' } })

    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    expect(await screen.findByText('DiscoveryIntake.validationUrlInvalid')).toBeDefined()
    expect(startDiscovery).not.toHaveBeenCalled()
  })

  it('submits valid data and navigates to session page', async () => {
    vi.mocked(startDiscovery).mockResolvedValueOnce({
      session_id: 'test-session-123',
      status: 'researching',
      progress_ws_url: '',
      status_url: '',
      accepted_at: new Date().toISOString(),
    })

    render(<IntakeForm />)

    fireEvent.change(screen.getByPlaceholderText('businessNamePlaceholder'), { target: { value: 'Test Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('businessTypePlaceholder'), { target: { value: 'Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('cityPlaceholder'), { target: { value: 'Cairo' } })

    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))
    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))

    // Select Arabic language mode explicitly
    fireEvent.click(screen.getByLabelText('languageModeAr'))

    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    await waitFor(() => {
      expect(startDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({
          language_mode: 'ar-EG',
          intake: expect.objectContaining({
            business_name: 'Test Cafe',
            business_type: 'Cafe',
            city: 'Cairo',
          }),
        }),
      )
      expect(mockRouterPush).toHaveBeenCalledWith('/discovery/test-session-123')
    })
  })

  it('maps API errors to typed translation keys', async () => {
    vi.mocked(startDiscovery).mockRejectedValueOnce({ status: 422, code: 'VALIDATION_FAILED', message: 'bad' })

    render(<IntakeForm />)

    fireEvent.change(screen.getByPlaceholderText('businessNamePlaceholder'), { target: { value: 'Test Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('businessTypePlaceholder'), { target: { value: 'Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('cityPlaceholder'), { target: { value: 'Cairo' } })

    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))
    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))

    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    expect(await screen.findByText('Errors.validationError')).toBeDefined()
  })

  it('maps queue failures to localized UI copy', async () => {
    vi.mocked(startDiscovery).mockRejectedValueOnce({
      status: 503,
      code: 'DISCOVERY_QUEUE_UNAVAILABLE',
      message: 'Queue unavailable',
    })

    render(<IntakeForm />)

    fireEvent.change(screen.getByPlaceholderText('businessNamePlaceholder'), { target: { value: 'Test Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('businessTypePlaceholder'), { target: { value: 'Cafe' } })
    fireEvent.change(screen.getByPlaceholderText('cityPlaceholder'), { target: { value: 'Cairo' } })
    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))
    fireEvent.click(screen.getByRole('button', { name: 'nextStep' }))
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))

    expect(await screen.findByText('DiscoveryProgress.errorRedisFailure')).toBeDefined()
  })

  it('shows field guidance with an example', () => {
    render(<IntakeForm />)

    fireEvent.click(screen.getByLabelText('fieldHelpLabel: businessNameLabel'))

    expect(screen.getByText('businessNameHelp')).toBeDefined()
    expect(screen.getByText(/businessNameExample/)).toBeDefined()
  })
})

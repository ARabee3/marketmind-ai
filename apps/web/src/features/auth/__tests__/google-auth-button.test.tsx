import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GoogleAuthButton } from '../google-auth-button'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      continueWithGoogle: 'Continue with Google',
      orDivider: 'or',
    }
    return messages[key] ?? key
  },
}))

describe('GoogleAuthButton', () => {
  it('renders Google auth link with rel="noopener noreferrer"', () => {
    render(<GoogleAuthButton />)

    const link = screen.getByRole('link', { name: /continue with google/i })
    expect(link).toBeDefined()
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders divider without role="separator"', () => {
    render(<GoogleAuthButton showDivider />)

    expect(screen.getByText('or')).toBeDefined()
    expect(screen.queryByRole('separator')).toBeNull()
  })
})

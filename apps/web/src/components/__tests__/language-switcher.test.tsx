import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { LanguageSwitcher } from '../language-switcher'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => {
    const t: Record<string, string> = { english: 'English', arabic: 'Arabic', language: 'Language' }
    return t[key] ?? key
  },
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/en',
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/i18n/routing', () => ({
  routing: { locales: ['en', 'ar'], defaultLocale: 'ar' },
}))

describe('LanguageSwitcher', () => {
  it('renders a button', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByRole('button')).toBeDefined()
  })

  it('shows the other locale label', () => {
    render(<LanguageSwitcher />)
    expect(screen.getByText('Arabic')).toBeDefined()
  })

  it('has an accessible label', () => {
    render(<LanguageSwitcher />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-label')).toBe('Language: Arabic')
  })
})

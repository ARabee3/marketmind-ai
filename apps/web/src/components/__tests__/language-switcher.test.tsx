import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageSwitcher } from '../language-switcher'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const t: Record<string, string> = {
      english: 'English',
      arabic: 'Arabic',
      language: 'Language',
      languageSwitchedTo: 'Language switched to {lang}',
    }
    let text = t[key] ?? key
    if (values) {
      Object.entries(values).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v))
      })
    }
    return text
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

  it('updates aria-live region on click', () => {
    render(<LanguageSwitcher />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    const liveRegion = screen.getByText('Language switched to Arabic')
    expect(liveRegion).toBeDefined()
    expect(liveRegion.getAttribute('aria-live')).toBe('polite')
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { AppShell } from '../layout/app-shell'

const t = (key: string) => {
  const dict: Record<string, string> = {
    appName: 'MarketMind AI',
    navHome: 'Home',
    navDiscovery: 'Discovery',
    navDashboard: 'Dashboard',
    primaryNavLabel: 'Primary',
    mobileNavLabel: 'Mobile primary',
    loginSubmit: 'Sign in',
    registerSubmit: 'Create account',
    logout: 'Sign out',
  }
  return dict[key] ?? key
}

vi.mock('next-intl', () => ({
  useTranslations: () => t,
  useLocale: () => 'en',
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => <button type="button" aria-label="Language: Arabic">AR</button>,
}))

let authenticated = false

vi.mock('@/features/auth/session-provider', () => ({
  useSession: () => ({ isAuthenticated: authenticated }),
}))

vi.mock('@/features/auth/logout-button', () => ({
  LogoutButton: ({ size }: { size?: string }) => (
    <button type="button" data-size={size}>Sign out</button>
  ),
}))

describe('AppShell', () => {
  it('renders brand in both mobile top bar and desktop sidebar', () => {
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )
    const brands = screen.getAllByText('MarketMind AI')
    expect(brands).toHaveLength(2)
  })

  it('renders primary desktop sidebar and mobile bottom nav with all destinations', () => {
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const primaryNavs = screen.getAllByLabelText('Primary')
    expect(primaryNavs).toHaveLength(1)
    expect(primaryNavs[0].closest('aside')?.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(primaryNavs[0].closest('aside')?.className).toMatch(/md:flex/)

    const mobileNavs = screen.getAllByLabelText('Mobile primary')
    expect(mobileNavs).toHaveLength(1)
    expect(mobileNavs[0].className).toMatch(/md:hidden/)

    expect(screen.getAllByRole('link', { name: 'Home' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Discovery' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(2)
  })

  it('marks the home link as current in both navs', () => {
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )
    const homeLinks = screen.getAllByRole('link', { name: 'Home' })
    for (const link of homeLinks) {
      expect(link.getAttribute('aria-current')).toBe('page')
    }
  })

  it('keeps content inside a max-width 1200 container', () => {
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <p data-testid="copy">body</p>
      </AppShell>,
    )
    const main = container.querySelector('main#main-content')
    expect(main?.parentElement?.className).toMatch(/md:ms-\[240px\]/)
    expect(main?.className).toMatch(/max-w-\[1200px\]/)
    expect(main?.className).not.toMatch(/md:ms-\[240px\]/)
    expect(main?.textContent).toMatch(/body/)
  })

  it('renders login and register actions in the desktop sidebar when unauthenticated', () => {
    authenticated = false
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const desktopSidebar = screen.getByLabelText('Primary').closest('aside')!
    expect(desktopSidebar.textContent).toMatch(/Sign in/)
    expect(desktopSidebar.textContent).toMatch(/Create account/)
  })

  it('renders logout action in the desktop sidebar when authenticated', () => {
    authenticated = true
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const desktopSidebar = screen.getByLabelText('Primary').closest('aside')!
    expect(desktopSidebar.textContent).toMatch(/Sign out/)
  })

  it('renders equivalent auth actions in the mobile top bar', () => {
    authenticated = false
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const mobileHeader = container.querySelector('header')!
    expect(mobileHeader.textContent).toMatch(/Sign in/)
    expect(mobileHeader.textContent).toMatch(/Create account/)
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { AppShell } from '../layout/app-shell'

const t = (key: string) => {
  const dict: Record<string, string> = {
    appName: 'MarketMind AI',
    navHome: 'Home',
    navDiscovery: 'Discovery',
    primaryNavLabel: 'Primary',
    mobileNavLabel: 'Mobile primary',
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

  it('renders primary desktop sidebar and mobile bottom nav with both destinations', () => {
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
    expect(main?.className).toMatch(/max-w-\[1200px\]/)
    expect(main?.textContent).toMatch(/body/)
  })
})
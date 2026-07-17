'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import {
  AppShellCloseIcon,
  AppShellMenuIcon,
  AppShellNavIcon,
  type AppShellIconName,
} from './app-shell-icons'

export type AppShellMobileNavItem = {
  readonly href: '/discovery' | '/dashboard'
  readonly labelKey: 'navDiscovery' | 'navDashboard'
  readonly iconName: AppShellIconName
}

type Props = {
  readonly brandName: string
  readonly navItems: readonly AppShellMobileNavItem[]
  readonly topActions: ReactNode
  readonly drawerActions: ReactNode
}

export function AppShellMobileNav({
  brandName,
  navItems,
  topActions,
  drawerActions,
}: Props) {
  const t = useTranslations('Common')
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
        <button
          type="button"
          aria-label={t('openNavigation')}
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="grid size-9 place-items-center rounded-lg border border-border bg-background text-navy shadow-sm"
        >
          <AppShellMenuIcon />
        </button>
        <span className="text-lg font-semibold text-navy">{brandName}</span>
        <div className="flex items-center gap-2">{topActions}</div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 bg-navy/45 md:hidden" role="presentation">
          <aside className="flex h-full w-[min(84vw,320px)] flex-col border-e border-border bg-surface p-4 shadow-header">
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 text-navy"
              >
                <span className="grid size-11 place-items-center rounded-lg border-2 border-navy bg-primary text-base font-bold text-primary-foreground shadow-tactile">
                  M
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-lg font-bold">{brandName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t('tagline')}
                  </span>
                </span>
              </Link>
              <button
                type="button"
                aria-label={t('closeNavigation')}
                onClick={() => setOpen(false)}
                className="grid size-9 place-items-center rounded-lg border border-border bg-background text-navy"
              >
                <AppShellCloseIcon />
              </button>
            </div>

            <nav aria-label={t('mobileNavLabel')} className="mt-7 flex-1">
              <ul className="grid gap-2">
                {navItems.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`)

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold',
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-soft-teal hover:text-primary',
                        )}
                      >
                        <AppShellNavIcon name={item.iconName} />
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="border-t border-border pt-4">{drawerActions}</div>
          </aside>
        </div>
      ) : null}
    </>
  )
}

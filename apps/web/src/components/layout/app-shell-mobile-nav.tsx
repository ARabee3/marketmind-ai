'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow

    // Move focus to the first control in the drawer (the close button, which
    // is the first focusable element in the rendered order).
    const focusables = getFocusable(dialog)
    focusables[0]?.focus()

    // Lock background scrolling while the drawer is open.
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }

      if (event.key !== 'Tab') return

      const focusable = getFocusable(dialog)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      // Restore focus to the trigger that opened the drawer.
      previouslyFocused?.focus?.()
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
        <button
          ref={triggerRef}
          type="button"
          aria-label={t('openNavigation')}
          aria-expanded={open}
          aria-controls="app-shell-mobile-drawer"
          onClick={() => setOpen(true)}
          className="grid size-9 place-items-center rounded-lg border border-border bg-background text-navy shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          <AppShellMenuIcon />
        </button>
        <span className="text-lg font-semibold text-navy">{brandName}</span>
        <div className="flex items-center gap-2">{topActions}</div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-navy/45"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <aside
            id="app-shell-mobile-drawer"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('mobileNavLabel')}
            className="relative flex h-full w-[min(84vw,320px)] flex-col border-e border-border bg-surface p-4 shadow-header"
          >
            <div className="flex items-center justify-between gap-3">
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded text-navy outline-none focus-visible:ring-2 focus-visible:ring-action"
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
                className="grid size-9 place-items-center rounded-lg border border-border bg-background text-navy outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                <AppShellCloseIcon />
              </button>
            </div>

            <nav className="mt-7 flex-1">
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
                          'flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-action',
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
'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AnimatePresence, motion } from 'framer-motion'
import { MenuIcon, XIcon } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { EASE, useReducedMotion } from '../lib/motion'

type NavLink = { href: string; label: string }

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

export function Nav() {
  const t = useTranslations('Landing.nav')
  const locale = useLocale()
  const isRtl = locale === 'ar'
  const targetLocale = isRtl ? 'en' : 'ar'
  const links = t.raw('links') as NavLink[]

  const reduced = useReducedMotion()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const drawerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // a11y for the mobile drawer: focus first control, trap Tab, close on
  // Escape, lock background scroll, and restore focus to the trigger on close.
  useEffect(() => {
    if (!drawerOpen) return

    const drawer = drawerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow

    const focusable = getFocusable(drawer)
    focusable[0]?.focus()
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawerOpen(false)
        return
      }

      if (event.key !== 'Tab') return
      const items = getFocusable(drawer)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [drawerOpen])

  // Logical slide direction: drawer opens from the inline-start edge, which
  // is the left in LTR and the right in RTL.
  const slideFrom = isRtl ? '100%' : '-100%'

  return (
    <motion.header
      initial={reduced ? false : { y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE.decel }}
      className="fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4 sm:px-4"
    >
      <nav
        aria-label={t('aria')}
        className={`mobile-drawer-nav relative z-20 flex w-full max-w-[920px] items-center justify-between gap-3 rounded-full border border-border/80 bg-surface/90 px-2 py-2 text-navy backdrop-blur-md transition-shadow duration-200 ${scrolled ? 'shadow-[0_8px_24px_rgb(16_42_67_/_12%)]' : 'shadow-header'}`}
      >
        <a
          href="#top"
          translate="no"
          onClick={() => setDrawerOpen(false)}
          className="flex items-center gap-2 rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          <span className="h-3 w-3 rounded-full border-[3px] border-soft-teal bg-primary" aria-hidden />
          <span className="font-latin text-[17px] font-bold text-navy">MarketMind</span>
        </a>

        <ul className="hidden items-center justify-center gap-[5px] md:flex">
          {links.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-full px-2 py-2 text-[13px] text-muted transition-colors hover:bg-soft-teal hover:text-navy outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <Link
          href="/"
          locale={targetLocale}
          className="hidden rounded-full border border-border px-3 py-2 text-[12px] font-bold text-muted outline-none focus-visible:ring-2 focus-visible:ring-action md:inline"
        >
          {t('language')}
        </Link>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="rounded-full border border-border px-4 py-2 text-[13px] font-bold text-muted transition-colors hover:bg-soft-teal hover:text-navy outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {t('login')}
          </Link>
          <Link
            href="/register"
            className="cta-solid px-4 py-2 text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {t('signup')}
          </Link>
        </div>

        <button
          type="button"
          aria-controls="mobile-menu"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? t('closeMenu') : t('openMenu')}
          onClick={() => setDrawerOpen((open) => !open)}
          className="grid h-11 w-11 place-items-center rounded-full bg-primary text-white shadow-[0_5px_0_var(--navy)] ring-1 ring-navy/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-action md:hidden"
        >
          {drawerOpen ? <XIcon className="h-6 w-6" aria-hidden /> : <MenuIcon className="h-6 w-6" aria-hidden />}
        </button>
      </nav>

      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            id="mobile-menu"
            initial={reduced ? { opacity: 0 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE.micro }}
            className="fixed inset-0 z-10 bg-navy/70 backdrop-blur-[2px] md:hidden"
            onClick={() => setDrawerOpen(false)}
          >
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('aria')}
              initial={reduced ? { opacity: 0 } : { x: slideFrom }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: slideFrom }}
              transition={{ duration: 0.24, ease: EASE.decel }}
              className="mobile-drawer-panel fixed inset-y-0 start-0 w-[min(78vw,320px)] border-e border-white/10 bg-[#050807] px-8 pb-8 pt-28 text-white shadow-[28px_0_80px_rgb(0_0_0_/_35%)]"
              onClick={(event) => event.stopPropagation()}
            >
              <ul className="space-y-0 text-right">
                {links.map((link) => (
                  <li key={link.href} className="border-b border-white/10">
                    <a
                      href={link.href}
                      onClick={() => setDrawerOpen(false)}
                      className="block py-4 text-[1.55rem] font-bold leading-none text-white transition-colors hover:text-journey-mint outline-none focus-visible:ring-2 focus-visible:ring-journey-mint"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-7 grid gap-3">
                <Link
                  href="/register"
                  onClick={() => setDrawerOpen(false)}
                  className="cta-solid min-h-[42px] px-4 py-2 text-[13px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-journey-mint"
                >
                  {t('signup')}
                </Link>
                <Link
                  href="/login"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-3 text-center text-[13px] font-bold text-white transition-colors hover:bg-white/15 outline-none focus-visible:ring-2 focus-visible:ring-journey-mint"
                >
                  {t('login')}
                </Link>
                <Link
                  href="/"
                  locale={targetLocale}
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-full border border-white/15 bg-white/10 px-4 py-3 font-latin text-[13px] font-bold text-white outline-none focus-visible:ring-2 focus-visible:ring-journey-mint"
                >
                  {t('languageLabel')}
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
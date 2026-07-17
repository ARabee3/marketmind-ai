'use client'

import type { ReactNode } from 'react'
import { LandingCopyProvider, useLandingCopy } from './landing-copy-provider'
import { Footer } from './components/Footer'
import { Nav } from './components/Nav'

type Props = {
  children: ReactNode
  locale: string
}

function LandingShellContent({ children, locale }: Props) {
  const copy = useLandingCopy()
  const isArabic = locale !== 'en'

  return (
    <div
      dir={isArabic ? 'rtl' : 'ltr'}
      lang={isArabic ? 'ar' : 'en'}
      className="landing-page min-h-full w-full bg-bg font-sans text-navy"
    >
      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:absolute focus:right-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-surface focus:px-4 focus:py-2 focus:text-navy"
      >
        {copy.shell.skip}
      </a>
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  )
}

export function LandingShell({ children, locale }: Props) {
  return (
    <LandingCopyProvider locale={locale}>
      <LandingShellContent locale={locale}>{children}</LandingShellContent>
    </LandingCopyProvider>
  )
}

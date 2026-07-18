import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Footer } from './components/Footer'
import { Nav } from './components/Nav'

type Props = {
  children: ReactNode
  locale: string
}

export async function LandingShell({ children, locale }: Props) {
  const t = await getTranslations('Landing.shell')
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
        {t('skip')}
      </a>
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
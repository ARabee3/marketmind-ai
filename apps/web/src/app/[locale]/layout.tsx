import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { IBM_Plex_Sans, IBM_Plex_Sans_Arabic } from 'next/font/google'
import { routing } from '@/i18n/routing'
import { LanguageSwitcher } from '@/components/language-switcher'
import '../globals.css'

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
})

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-arabic',
  display: 'swap',
})

type Props = {
  children: ReactNode
  params: Promise<{ locale: string }>
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Common' })

  return {
    title: t('appName'),
  }
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params
  const messages = await getMessages()
  const direction = locale === 'ar' ? 'rtl' : 'ltr'

  return (
    <html
      lang={locale}
      dir={direction}
      className={`${ibmPlexSans.variable} ${ibmPlexSansArabic.variable}`}
    >
      <body className="min-h-dvh flex flex-col bg-background font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          <nav className="flex items-center justify-between px-6 py-3 border-b border-border bg-surface">
            <span className="text-lg font-semibold text-navy">MarketMind AI</span>
            <LanguageSwitcher />
          </nav>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}

'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '@/i18n/navigation'

export function LanguageSwitcher() {
  const t = useTranslations('Common')
  const locale = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const [announce, setAnnounce] = useState('')

  function switchLocale(nextLocale: string) {
    const nextLabel = nextLocale === 'en' ? t('english') : t('arabic')
    router.replace(pathname, { locale: nextLocale })
    setAnnounce(t('languageSwitchedTo', { lang: nextLabel }))
  }

  const otherLocale = locale === 'en' ? 'ar' : 'en'
  const label = otherLocale === 'en' ? t('english') : t('arabic')

  return (
    <>
      <button
        type="button"
        onClick={() => switchLocale(otherLocale)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-navy transition-colors hover:bg-background hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        aria-label={`${t('language')}: ${label}`}
      >
        <LanguageIcon dir={locale === 'ar' ? 'rtl' : 'ltr'} />
        <span>{label}</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
    </>
  )
}

function LanguageIcon({ dir }: { dir: 'ltr' | 'rtl' }) {
  const isRtl = dir === 'rtl'

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: isRtl ? 'scaleX(-1)' : undefined }}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

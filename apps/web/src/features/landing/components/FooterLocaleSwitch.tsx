'use client'

import { useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'

export function FooterLocaleSwitch({ label }: { readonly label: string }) {
  const locale = useLocale()
  const targetLocale = locale === 'ar' ? 'en' : 'ar'
  return (
    <Link
      href="/"
      locale={targetLocale}
      className="rounded hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      {label}
    </Link>
  )
}
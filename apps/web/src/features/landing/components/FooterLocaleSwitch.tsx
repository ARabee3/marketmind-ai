'use client'

import { useLocale } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'

export function FooterLocaleSwitch({ label }: { readonly label: string }) {
  const locale = useLocale()
  const pathname = usePathname()
  const targetLocale = locale === 'ar' ? 'en' : 'ar'
  return (
    <Link
      href={pathname}
      locale={targetLocale}
      className="rounded hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
    >
      {label}
    </Link>
  )
}

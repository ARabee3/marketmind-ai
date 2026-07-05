import { redirect } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { cookies, headers } from 'next/headers'

async function detectLocale(): Promise<string> {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value
  if (cookieLocale && routing.locales.includes(cookieLocale as 'en' | 'ar')) {
    return cookieLocale
  }

  const acceptLanguage = (await headers()).get('Accept-Language') || ''
  for (const locale of routing.locales) {
    if (acceptLanguage.startsWith(locale)) {
      return locale
    }
  }

  return routing.defaultLocale
}

export default async function RootPage() {
  redirect(`/${await detectLocale()}`)
}
